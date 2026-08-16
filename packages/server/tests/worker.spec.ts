import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/database.ts'
import { SqliteFlowboardRepository } from '../src/repository.ts'
import { processNextTranscription } from '../src/worker.ts'

describe('转写 worker', () => {
  let directory: string
  let repository: SqliteFlowboardRepository
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flowboard-worker-'))
    repository = new SqliteFlowboardRepository(openDatabase({ path: ':memory:', bootstrapToken: 'worker-token' }), 'http://localhost')
  })
  afterEach(async () => {
    repository.db.close()
    await rm(directory, { recursive: true, force: true })
  })

  async function job(): Promise<{ id: string; path: string }> {
    const actor = repository.authenticate('worker-token')
    const meeting = repository.execute(actor, { idempotencyKey: crypto.randomUUID(), type: 'meeting.create', payload: { projectId: 'project-local', title: '转写测试' } })
    const path = join(directory, `${meeting.entityId}.webm`)
    await writeFile(path, 'audio')
    const ticket = repository.createUploadTicket(actor, { meetingId: meeting.entityId, contentType: 'audio/webm', size: 5 })
    const token = decodeURIComponent(new URL(ticket.uploadUrl).pathname.split('/').at(-1)!)
    return { id: repository.consumeUploadTicket(token, 5, path, 'audio/webm'), path }
  }

  it('成功后写回会议记录并删除音频', async () => {
    const item = await job()
    expect(await processNextTranscription(repository, { transcribe: async () => '确认发布计划' })).toBe(true)
    expect(repository.transcription(repository.authenticate('worker-token'), item.id)).toMatchObject({ state: 'completed', text: '确认发布计划' })
    expect(repository.snapshot(repository.authenticate('worker-token'), {}).meetings[0]?.transcript).toContain('确认发布计划')
    await expect(access(item.path)).rejects.toThrow()
  })

  it('失败后记录原因、删除音频且队列可继续运行', async () => {
    const item = await job()
    await processNextTranscription(repository, { transcribe: async () => { throw new Error('转写服务不可用') } })
    expect(repository.transcription(repository.authenticate('worker-token'), item.id)).toMatchObject({ state: 'failed', error: '转写服务不可用' })
    await expect(access(item.path)).rejects.toThrow()
    expect(await processNextTranscription(repository, { transcribe: async () => '' })).toBe(false)
  })
})
