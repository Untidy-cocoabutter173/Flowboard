import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerFlowboardTools } from '../src/tools.ts'
import type { FlowboardHttpClient } from '../src/http-client.ts'

function setup() {
  const tools: ToolDefinition[] = []
  const client = {
    summary: vi.fn(async () => ({ apiVersion: 3, counts: {} })),
    snapshot: vi.fn(async () => ({
      apiVersion: 3,
      projects: [{ id: 'project-1', teamId: 'team-1', role: 'owner' }],
      teams: [{ id: 'team-1', role: 'owner' }],
    })),
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

  it('缺失非关键字段时先创建临时项目和任务', async () => {
    const { tools, client } = setup()
    await tools.find(item => item.name === 'flowboard_create_project')!.execute({}, exec('create-project-8'))
    await tools.find(item => item.name === 'flowboard_create_task')!.execute({}, exec('create-task-9'))
    expect(client.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'project.create', payload: expect.objectContaining({ teamId: 'team-1', name: '未命名项目' }),
    }), expect.any(AbortSignal))
    expect(client.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'task.create', payload: expect.objectContaining({ projectId: 'project-1', title: '未命名任务' }),
    }), expect.any(AbortSignal))
  })

  it('会议中创建项目会自动追加项目操作记录', async () => {
    const { tools, client } = setup()
    client.command
      .mockResolvedValueOnce({ cursor: 1, entityType: 'project', entityId: 'project-new', version: 1, replayed: false })
      .mockResolvedValueOnce({ cursor: 2, entityType: 'meeting', entityId: 'meeting-1', version: 4, replayed: false })
    await tools.find(item => item.name === 'flowboard_create_project')!.execute({
      name: '发布平台', meeting_id: 'meeting-1',
    }, exec('create-project-in-meeting'))
    expect(client.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'meeting.action.append',
      payload: expect.objectContaining({ id: 'meeting-1', kind: 'project', summary: '创建项目：发布平台', entityId: 'project-new' }),
    }), expect.any(AbortSignal))
  })

  it('AI 提问会持久化 assistant 澄清意图', async () => {
    const { tools, client } = setup()
    client.command.mockResolvedValueOnce({ cursor: 1, entityType: 'meeting_intent', entityId: 'intent-1', version: 3, replayed: false })
    await tools.find(item => item.name === 'flowboard_raise_meeting_question')!.execute({
      meeting_id: 'meeting-1', intent_key: 'owner-question', question: '这个任务由谁负责？',
      evidence_from_sequence: 2, evidence_to_sequence: 2,
    }, exec('ask-1'))
    expect(client.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'meeting.intent.upsert', payload: expect.objectContaining({ payload: expect.objectContaining({ origin: 'assistant', question: '这个任务由谁负责？' }) }),
    }), expect.any(AbortSignal))
    expect(client.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'meeting.intent.status', payload: { id: 'intent-1', revision: 3, status: 'clarifying' },
    }), expect.any(AbortSignal))
  })

  it('AI 回复会写入会议回复列表', async () => {
    const { tools, client } = setup()
    await tools.find(item => item.name === 'flowboard_reply_in_meeting')!.execute({
      meeting_id: 'meeting-1', reply: '目前已创建项目，正在整理资料。',
    }, exec('reply-1'))
    expect(client.command).toHaveBeenCalledWith(expect.objectContaining({
      type: 'meeting.action.append',
      payload: expect.objectContaining({ id: 'meeting-1', kind: 'note', summary: '目前已创建项目，正在整理资料。' }),
    }), expect.any(AbortSignal))
  })

  it('批次确认先记录用户意图，再一次推进分析水位', async () => {
    const { tools, client } = setup()
    client.snapshot.mockResolvedValueOnce({
      meetingAgentBindings: [{ meetingId: 'meeting-1', state: 'active', deliveredSequence: 5, analyzedSequence: 2 }],
      meetingIntents: [{ meetingId: 'meeting-1', payload: { title: '已有任务', origin: 'user' }, evidenceFromSequence: 3, evidenceToSequence: 5 }],
    })
    client.command
      .mockResolvedValueOnce({ cursor: 3, entityType: 'meeting_intent', entityId: 'intent-batch', version: 1, replayed: false })
      .mockResolvedValueOnce({ cursor: 4, entityType: 'meeting_agent_binding', entityId: 'meeting-1', version: 1, replayed: false })
    const result = await tools.find(item => item.name === 'flowboard_ack_meeting')!.execute({
      meeting_id: 'meeting-1', analyzed_sequence: 5, analysis_summary: '识别到两个诉求', user_intents: ['创建发布项目', '已有任务', '创建发布项目'],
    }, exec('ack-batch'))
    expect(client.command).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'meeting.intent.record',
      payload: { meetingId: 'meeting-1', intentKey: 'batch-3-5-0', title: '创建发布项目', evidenceFromSequence: 3, evidenceToSequence: 5 },
    }), expect.any(AbortSignal))
    expect(client.command).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'meeting.agent.progress', payload: { id: 'meeting-1', analyzedSequence: 5 },
    }), expect.any(AbortSignal))
    expect(result).toMatchObject({ analysisSummary: '识别到两个诉求', userIntents: ['创建发布项目', '已有任务'] })
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
