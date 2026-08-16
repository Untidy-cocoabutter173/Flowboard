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
})
