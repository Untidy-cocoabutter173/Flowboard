// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlowboardSnapshot } from '@flowboard/contracts'
import { FlowboardController } from '../src/client/controller.ts'
import { FlowboardRemoteClient, type FlowboardRemotePort } from '../src/client/remote.ts'

const snapshot = (cursor: number): FlowboardSnapshot => ({
  apiVersion: 3, cursor,
  actor: { id: 'user-1', tenantId: 'tenant-1', name: '用户', email: null },
  teams: [], teamMembers: [], people: [], projectMembers: [], workflowStatuses: [], fieldDefinitions: [], savedViews: [], categories: [], tasks: [], meetings: [], utterances: [], aiActions: [], meetingAgentBindings: [], meetingIntents: [], library: [], events: [], links: { projectMeetings: [], projectLibrary: [], meetingLibrary: [], taskMeetings: [], taskLibrary: [] },
  projects: [{ id: 'project-1', tenantId: 'tenant-1', teamId: 'team-1', parentId: null, key: 'FLOW', name: '项目', description: '', color: '#4D6BFE', role: 'owner', version: 1, createdAt: '', updatedAt: '' }],
})
const ok = (value: unknown) => ({ ok: true, value: JSON.stringify(value) })

describe('FlowboardController', () => {
  const controllers: FlowboardController[] = []
  afterEach(() => {
    controllers.splice(0).forEach(controller => controller.dispose())
    vi.useRealTimers()
  })

  it('初始加载后保持首页路由', async () => {
    const port = { snapshot: vi.fn(async () => ok(snapshot(2))) } as unknown as FlowboardRemotePort
    const controller = new FlowboardController(new FlowboardRemoteClient(port))
    controllers.push(controller)
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', route: { area: 'home' }, error: null })
  })

  it('命令成功后刷新快照并自动生成幂等键', async () => {
    let cursor = 1
    const command = vi.fn(async () => { cursor = 2; return ok({ cursor: 2, entityType: 'task', entityId: 'task-1', version: 1, replayed: false }) })
    const port = { snapshot: vi.fn(async () => ok(snapshot(cursor))), command } as unknown as FlowboardRemotePort
    const controller = new FlowboardController(new FlowboardRemoteClient(port))
    controllers.push(controller)
    await controller.refresh()
    await controller.command({ type: 'task.create', payload: { projectId: 'project-1', title: '新任务' } })
    expect(controller.getSnapshot().snapshot?.cursor).toBe(2)
    const request = JSON.parse(command.mock.calls[0]![0] as string) as { idempotencyKey: string }
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('长轮询失败后退避重试，不会永久停止', async () => {
    vi.useFakeTimers()
    let calls = 0
    const port = {
      snapshot: vi.fn(async () => ok(snapshot(1))),
      changes: vi.fn(async (_request: string, signal?: AbortSignal) => {
        calls += 1
        if (calls === 1) throw new Error('网络中断')
        return await new Promise(resolve => signal?.addEventListener('abort', () => resolve(ok({ cursor: 1, changed: false })), { once: true }))
      }),
    } as unknown as FlowboardRemotePort
    const controller = new FlowboardController(new FlowboardRemoteClient(port))
    controllers.push(controller)
    controller.start()
    await vi.waitFor(() => expect(calls).toBe(1))
    expect(controller.getSnapshot().error).toBe('网络中断')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(calls).toBe(2))
  })

  it('把浏览器已截流音频交给 Host，并在转写完成后立即刷新文字稿', async () => {
    const uploadAudio = vi.fn(async () => ok({ jobId: 'job-1' }))
    const transcription = vi.fn(async () => ok({
      id: 'job-1', meetingId: 'meeting-1', clientSegmentId: 'segment-1', state: 'completed',
      text: '立即写入文字稿', utteranceSequence: 1, error: null, createdAt: '', updatedAt: '',
    }))
    const snapshotRemote = vi.fn(async () => ok(snapshot(2)))
    const port = { snapshot: snapshotRemote, uploadAudio, transcription } as unknown as FlowboardRemotePort
    const controller = new FlowboardController(new FlowboardRemoteClient(port))
    controllers.push(controller)
    const blob = { type: 'audio/wav', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob

    await expect(controller.uploadMeetingAudio('meeting-1', blob, 'segment-1')).resolves.toMatchObject({ state: 'completed', text: '立即写入文字稿' })
    expect(uploadAudio).toHaveBeenCalledOnce()
    expect(JSON.parse(uploadAudio.mock.calls[0]![0] as string)).toMatchObject({ meetingId: 'meeting-1', size: 3, clientSegmentId: 'segment-1' })
    expect(uploadAudio.mock.calls[0]![1]).toBe('AQID')
    expect(transcription).toHaveBeenCalledOnce()
    expect(snapshotRemote).toHaveBeenCalledOnce()
  })
})
