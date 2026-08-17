import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerFlowboardTools } from '../src/tools.ts'
import type { FlowboardHttpClient } from '../src/http-client.ts'

function setup() {
  const tools: ToolDefinition[] = []
  const client = {
    summary: vi.fn(async () => ({ apiVersion: 3, counts: {} })),
    snapshot: vi.fn(async () => ({ apiVersion: 3, projects: [] })),
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

  it('会议意图工具携带稳定键、证据范围和提交游标', async () => {
    const { tools, client } = setup()
    await tools.find(item => item.name === 'flowboard_upsert_meeting_intent')!.execute({
      meeting_id: 'meeting-1', intent_key: 'release-check', kind: 'task', title: '发布检查',
      project_id: 'project-1', evidence_from_sequence: 1, evidence_to_sequence: 2,
    }, exec('call-intent-upsert'))
    await tools.find(item => item.name === 'flowboard_commit_meeting_intent')!.execute({ intent_id: 'intent-1', revision: 2, basis_sequence: 2 }, exec('call-intent-commit'))
    expect(client.command).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'meeting.intent.upsert', payload: expect.objectContaining({ intentKey: 'release-check', evidenceToSequence: 2 }) }), expect.any(AbortSignal))
    expect(client.command).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'meeting.intent.commit', payload: { id: 'intent-1', revision: 2, basisSequence: 2 } }), expect.any(AbortSignal))
  })
})
