import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { openDatabase } from '../src/database.ts'
import { SqliteFlowboardRepository } from '../src/repository.ts'
import { buildServer } from '../src/application.ts'

describe('Flowboard HTTP API', () => {
  let app: FastifyInstance
  let directory: string
  let repository: SqliteFlowboardRepository

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flowboard-http-'))
    const db = openDatabase({ path: ':memory:', bootstrapToken: 'http-token' })
    repository = new SqliteFlowboardRepository(db, 'http://flowboard.test')
    app = buildServer({ repository, uploadDirectory: directory })
  })
  afterEach(async () => {
    await app.close()
    repository.db.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('拒绝未授权请求并返回授权快照', async () => {
    const denied = await app.inject({ method: 'GET', url: '/v1/snapshot' })
    expect(denied.statusCode).toBe(401)
    expect(denied.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    const allowed = await app.inject({ method: 'GET', url: '/v1/snapshot', headers: { authorization: 'Bearer http-token' } })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json().projects).toHaveLength(1)
    const summary = await app.inject({ method: 'GET', url: '/v1/summary', headers: { authorization: 'Bearer http-token' } })
    expect(summary.json()).toMatchObject({ apiVersion: 2, counts: { projects: 1 } })
  })

  it('执行命令并通过游标读取变更', async () => {
    const command = await app.inject({ method: 'POST', url: '/v1/commands', headers: { authorization: 'Bearer http-token' }, payload: { idempotencyKey: 'http-task-create', type: 'task.create', payload: { projectId: 'project-local', title: 'HTTP 任务' } } })
    expect(command.statusCode).toBe(200)
    const result = command.json()
    const changes = await app.inject({ method: 'GET', url: '/v1/changes?cursor=0&waitMs=0', headers: { authorization: 'Bearer http-token' } })
    expect(changes.json()).toEqual({ cursor: result.cursor, changed: true })
  })

  it('音频票据只能使用一次并返回上传 CORS', async () => {
    const actor = repository.authenticate('http-token')
    const meeting = repository.execute(actor, { idempotencyKey: 'http-meeting-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '周会' } })
    repository.execute(actor, { idempotencyKey: 'http-meeting-start', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    const ticketResponse = await app.inject({ method: 'POST', url: '/v1/uploads/tickets', headers: { authorization: 'Bearer http-token' }, payload: { meetingId: meeting.entityId, contentType: 'audio/webm', size: 4, clientSegmentId: 'http-segment-1' } })
    const ticket = ticketResponse.json() as { uploadUrl: string }
    const path = new URL(ticket.uploadUrl).pathname
    const options = await app.inject({ method: 'OPTIONS', url: path })
    expect(options.statusCode).toBe(204)
    expect(options.headers['access-control-allow-methods']).toContain('PUT')
    const uploaded = await app.inject({ method: 'PUT', url: path, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('test') })
    expect(uploaded.statusCode).toBe(202)
    expect(uploaded.headers['access-control-allow-origin']).toBe('*')
    const repeated = await app.inject({ method: 'PUT', url: path, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('test') })
    expect(repeated.statusCode).toBe(401)
  })

  it('规范化 MediaRecorder 带 codecs 的音频类型', async () => {
    const actor = repository.authenticate('http-token')
    const meeting = repository.execute(actor, { idempotencyKey: 'codec-meeting-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '语音会议' } })
    repository.execute(actor, { idempotencyKey: 'codec-meeting-start', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    const ticketResponse = await app.inject({
      method: 'POST',
      url: '/v1/uploads/tickets',
      headers: { authorization: 'Bearer http-token' },
      payload: { meetingId: meeting.entityId, contentType: 'audio/webm;codecs=opus', size: 4, clientSegmentId: 'codec-segment-1' },
    })

    expect(ticketResponse.statusCode).toBe(200)
    const path = new URL((ticketResponse.json() as { uploadUrl: string }).uploadUrl).pathname
    const uploaded = await app.inject({ method: 'PUT', url: path, headers: { 'content-type': 'audio/webm;codecs=opus' }, payload: Buffer.from('test') })
    expect(uploaded.statusCode).toBe(202)
  })
})
