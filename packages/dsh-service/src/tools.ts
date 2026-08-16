import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CommandRequest, MeetingAiActionView } from '@flowboard/contracts'
import type { FlowboardHttpClient } from './http-client.ts'

const jsonOutput = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function key(callId: unknown, operation: string): string {
  return `tool:${String(callId)}:${operation}`
}

function command(client: FlowboardHttpClient, request: CommandRequest, signal: AbortSignal) {
  return client.command(request, signal)
}

export function registerFlowboardTools(ctx: Context, client: FlowboardHttpClient): void {
  ctx.tools.register(defineTool({
    name: 'flowboard_snapshot',
    description: '读取 Flowboard 工作空间摘要；指定项目或会议时读取该范围的完整详情。',
    parameters: {
      project_id: { type: 'string', description: '可选项目 id。' },
      meeting_id: { type: 'string', description: '可选会议 id。' },
    },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => args.project_id === undefined && args.meeting_id === undefined
      ? client.summary(exec.signal)
      : client.snapshot({
          ...(args.project_id === undefined ? {} : { projectId: args.project_id }),
          ...(args.meeting_id === undefined ? {} : { meetingId: args.meeting_id }),
        }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_create_task',
    description: '为项目创建任务，可关联当前会议。创建后会留下可审计的会议 AI 操作记录。',
    parameters: {
      project_id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      summary: { type: 'string' },
      assignee_id: { type: 'string' },
      due_at: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      meeting_id: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const result = await command(client, {
        idempotencyKey: key(exec.callId, 'task.create'),
        type: 'task.create',
        payload: {
          projectId: args.project_id,
          title: args.title,
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
          ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.meeting_id === undefined ? {} : { meetingIds: [args.meeting_id] }),
        },
      }, exec.signal)
      if (args.meeting_id !== undefined) await recordAction(client, exec, args.meeting_id, 'task', `创建任务：${args.title}`, result.entityType, result.entityId)
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_update_task',
    description: '使用乐观锁更新任务。先读取快照获得任务当前 expected_version。',
    parameters: {
      id: { type: 'string', required: true },
      expected_version: { type: 'integer', required: true },
      title: { type: 'string' }, summary: { type: 'string' }, status_id: { type: 'string' },
      assignee_id: { type: 'string' }, progress: { type: 'number' }, due_at: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'task.update'), type: 'task.update', expectedVersion: args.expected_version,
      payload: {
        id: args.id,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.status_id === undefined ? {} : { statusId: args.status_id }),
        ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
        ...(args.progress === undefined ? {} : { progress: args.progress }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
      },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_create_document',
    description: '创建会议资料或项目资料，并建立项目与会议关联。',
    parameters: {
      team_id: { type: 'string', required: true }, project_ids: { type: 'array', items: { type: 'string' }, required: true },
      title: { type: 'string', required: true }, content: { type: 'string', required: true }, meeting_id: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const result = await command(client, {
        idempotencyKey: key(exec.callId, 'library.create'), type: 'library.create',
        payload: { teamId: args.team_id, projectIds: args.project_ids, type: 'doc', title: args.title, content: args.content, ...(args.meeting_id === undefined ? {} : { sourceMeetingId: args.meeting_id }) },
      }, exec.signal)
      if (args.meeting_id !== undefined) await recordAction(client, exec, args.meeting_id, 'document', `创建资料：${args.title}`, result.entityType, result.entityId)
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_meeting_action',
    description: '向会议操作记录追加决议、备注或一次 AI 操作结果。',
    parameters: {
      meeting_id: { type: 'string', required: true },
      kind: { type: 'string', enum: ['task', 'document', 'decision', 'note'], required: true },
      summary: { type: 'string', required: true }, entity_type: { type: 'string' }, entity_id: { type: 'string' }, ok: { type: 'boolean' },
    },
    output: jsonOutput,
    execute: async (args, exec) => recordAction(client, exec, args.meeting_id, args.kind, args.summary, args.entity_type, args.entity_id, args.ok),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_finalize_meeting',
    description: '完成会议整理：写入总结、决议、风险，并原子创建关联任务和资料，最后结束会议。',
    parameters: {
      meeting_id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true }, summary: { type: 'string', required: true },
      decisions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } },
      action_items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      documents: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.finalize'), type: 'meeting.finalize', expectedVersion: args.expected_version,
      payload: {
        id: args.meeting_id, summary: args.summary,
        ...(args.decisions === undefined ? {} : { decisions: args.decisions }),
        ...(args.risks === undefined ? {} : { risks: args.risks }),
        ...(args.action_items === undefined ? {} : { actionItems: args.action_items as never }),
        ...(args.documents === undefined ? {} : { documents: args.documents as never }),
      },
    }, exec.signal),
  }))
}

async function recordAction(
  client: FlowboardHttpClient,
  exec: { callId: unknown; signal: AbortSignal },
  meetingId: string,
  kind: MeetingAiActionView['kind'],
  summary: string,
  entityType?: string,
  entityId?: string,
  ok = true,
) {
  return command(client, {
    idempotencyKey: key(exec.callId, `meeting.action:${kind}`), type: 'meeting.action.append',
    payload: {
      id: meetingId, callId: String(exec.callId), kind, summary, ok,
      ...(entityType === undefined ? {} : { entityType }),
      ...(entityId === undefined ? {} : { entityId }),
    },
  }, exec.signal)
}
