import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/database.ts'
import { SqliteFlowboardRepository } from '../src/repository.ts'
import { processNextTranscription, runTranscriptionWorkers } from '../src/worker.ts'

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

  async function job(priorText?: string): Promise<{ id: string; path: string }> {
    const actor = repository.authenticate('worker-token')
    const meeting = repository.execute(actor, { idempotencyKey: crypto.randomUUID(), type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '转写测试' } })
    repository.execute(actor, { idempotencyKey: crypto.randomUUID(), type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    if (priorText !== undefined) {
      repository.execute(actor, { idempotencyKey: crypto.randomUUID(), type: 'meeting.transcript.append', expectedVersion: 2, payload: { id: meeting.entityId, text: priorText } })
    }
    const path = join(directory, `${meeting.entityId}.webm`)
    await writeFile(path, 'audio')
    const ticket = repository.createUploadTicket(actor, { meetingId: meeting.entityId, contentType: 'audio/webm', size: 5, clientSegmentId: crypto.randomUUID() })
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

  it('不会把历史识别结果回灌给下一段 Whisper', async () => {
    const item = await job('项目代号天枢，负责人是张三。')
    const transcribe = vi.fn(async () => '继续确认发布时间。')
    await processNextTranscription(repository, { transcribe })
    expect(transcribe).toHaveBeenCalledWith(item.path, undefined)
  })

  it('并发识别短片段并按领取顺序写回', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const jobs = [
      { id: 'job-1', audioPath: join(directory, 'one.wav') },
      { id: 'job-2', audioPath: join(directory, 'two.wav') },
    ]
    const finished: string[] = []
    const fakeRepository = {
      claimTranscription: vi.fn(() => jobs.shift()),
      finishTranscription: vi.fn((id: string) => finished.push(id)),
      failTranscription: vi.fn(),
    }
    const transcribe = vi.fn((path: string) => path.endsWith('one.wav') ? first.promise : second.promise)
    const abort = new AbortController()
    const running = runTranscriptionWorkers(fakeRepository as never, { transcribe }, abort.signal, 2, 5)

    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2))
    second.resolve('第二段')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(finished).toEqual([])
    first.resolve('第一段')
    await vi.waitFor(() => expect(finished).toEqual(['job-1', 'job-2']))
    abort.abort()
    await running
  })
})
