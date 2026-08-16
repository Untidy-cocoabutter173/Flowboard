import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerFlowboardTools } from '../src/tools.ts'
import type { FlowboardHttpClient } from '../src/http-client.ts'

function setup() {
  const tools: ToolDefinition[] = []
  const client = {
    summary: vi.fn(async () => ({ apiVersion: 2, counts: {} })),
    snapshot: vi.fn(async () => ({ apiVersion: 2, projects: [] })),
    command: vi.fn(async () => ({ cursor: 1, entityType: 'task', entityId: 'task-1', version: 1, replayed: false })),
  }
  registerFlowboardTools({ tools: { register: (tool: ToolDefinition) => { tools.push(tool) } } } as never, client as unknown as FlowboardHttpClient)
  return { tools, client }
}

const exec = (callId: string) => ({ callId, signal: new AbortController().signal }) as never

describe('Flowboard Agent tools', () => {
  it('空 snapshot 使用轻量 summary，不进入 Remote 或完整快照', async () => {
    const { tools, client } = setup()
    const tool = tools.find(item => item.name === 'flowboard_snapshot')!
    await tool.execute({}, exec('call-summary'))
    expect(client.summary).toHaveBeenCalledOnce()
    expect(client.snapshot).not.toHaveBeenCalled()
  })

  it('指定项目读取完整快照，写工具使用 callId 作为稳定幂等来源', async () => {
    const { tools, client } = setup()
    await tools.find(item => item.name === 'flowboard_snapshot')!.execute({ project_id: 'project-1' }, exec('call-project'))
    expect(client.snapshot).toHaveBeenCalledWith({ projectId: 'project-1' }, expect.any(AbortSignal))
    await tools.find(item => item.name === 'flowboard_create_task')!.execute({ project_id: 'project-1', title: '发布检查' }, exec('call-task-42'))
    expect(client.command).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'tool:call-task-42:task.create', type: 'task.create' }), expect.any(AbortSignal))
  })
})
