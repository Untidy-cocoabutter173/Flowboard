import { describe, expect, it, vi } from 'vitest'
import { FlowboardHttpClient, FlowboardRemoteError } from '../src/http-client.ts'

describe('FlowboardHttpClient', () => {
  it('统一附加 Bearer Token 与 JSON 请求头', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cursor: 1, entityType: 'task', entityId: 'task-1', version: 1, replayed: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = new FlowboardHttpClient({ apiBase: 'http://flowboard.test/', token: 'host-secret' }, fetchImpl as typeof fetch)
    await client.command({ idempotencyKey: 'command-0001', type: 'task.create', payload: { projectId: 'project-local', title: '测试' } })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://flowboard.test/v1/commands')
    expect(init.headers).toEqual({ authorization: 'Bearer host-secret', 'content-type': 'application/json' })
  })

  it('把结构化上游错误映射成 Remote 错误', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'CONFLICT', message: '版本冲突', details: { currentVersion: 2 } } }), { status: 409, headers: { 'content-type': 'application/json' } }))
    const client = new FlowboardHttpClient({ apiBase: 'http://flowboard.test', token: 'secret' }, fetchImpl as typeof fetch)
    await expect(client.snapshot({})).rejects.toEqual(expect.objectContaining<Partial<FlowboardRemoteError>>({ code: 'CONFLICT', status: 409, message: '版本冲突' }))
  })

  it('由 Host 使用一次性票据上传音频并立即返回转写任务', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/v1/uploads/tickets')) {
        return new Response(JSON.stringify({ uploadUrl: 'http://flowboard.test/v1/uploads/ticket-1', expiresAt: '2026-08-17T00:05:00Z', maxBytes: 1024 }), { status: 200 })
      }
      expect(init?.body).toBeInstanceOf(ArrayBuffer)
      return new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 })
    })
    const client = new FlowboardHttpClient({ apiBase: 'http://flowboard.test', token: 'host-secret' }, fetchImpl as typeof fetch)
    const request = { meetingId: 'meeting-1', contentType: 'audio/wav', size: 3, clientSegmentId: 'segment-1' }

    await expect(client.uploadAudio(request, new Uint8Array([1, 2, 3]))).resolves.toEqual({ jobId: 'job-1' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://flowboard.test/v1/uploads/ticket-1')
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', headers: { 'content-type': 'audio/wav' } })
  })
})
