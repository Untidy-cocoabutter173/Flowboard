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

async function writableScope(
  client: FlowboardHttpClient,
  signal: AbortSignal,
  projectId?: string,
  teamId?: string,
) {
  const snapshot = await client.snapshot({}, signal)
  const project = projectId === undefined
    ? snapshot.projects.find(item => item.role !== 'viewer' && (teamId === undefined || item.teamId === teamId))
    : snapshot.projects.find(item => item.id === projectId && item.role !== 'viewer')
  const team = teamId === undefined
    ? snapshot.teams.find(item => item.id === project?.teamId) ?? snapshot.teams.find(item => item.role !== 'viewer')
    : snapshot.teams.find(item => item.id === teamId && item.role !== 'viewer')
  return { snapshot, project, team }
}

function provisionalProjectKey(callId: unknown): string {
  const suffix = String(callId).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-7)
  return `TMP${suffix || 'PROJECT'}`.slice(0, 12)
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
    name: 'flowboard_create_project',
    description: '立即创建项目。名称、代号或团队缺失时使用可修订的临时值，不因非关键字段缺失而等待用户。',
    parameters: {
      team_id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' },
      description: { type: 'string' }, color: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const { team } = await writableScope(client, exec.signal, undefined, args.team_id)
      if (team === undefined) throw new Error('没有可写团队，无法创建项目')
      return command(client, {
        idempotencyKey: key(exec.callId, 'project.create'), type: 'project.create',
        payload: {
          teamId: team.id,
          key: args.key ?? provisionalProjectKey(exec.callId),
          name: args.name?.trim() || '未命名项目',
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.color === undefined ? {} : { color: args.color }),
        },
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_update_project',
    description: '使用乐观锁修订项目临时名称、代号、说明或颜色。',
    parameters: {
      id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true },
      key: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, color: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'project.update'), type: 'project.update', expectedVersion: args.expected_version,
      payload: {
        id: args.id,
        ...(args.key === undefined ? {} : { key: args.key }),
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.color === undefined ? {} : { color: args.color }),
      },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_create_task',
    description: '立即为项目创建任务，可关联当前会议。项目或标题缺失时推断当前可写项目并使用临时标题，后续再修订。',
    parameters: {
      project_id: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      assignee_id: { type: 'string' },
      due_at: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      meeting_id: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const { project } = await writableScope(client, exec.signal, args.project_id)
      if (project === undefined) throw new Error('没有可写项目，无法创建任务')
      const title = args.title?.trim() || '未命名任务'
      const result = await command(client, {
        idempotencyKey: key(exec.callId, 'task.create'),
        type: 'task.create',
        payload: {
          projectId: project.id,
          title,
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
          ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.meeting_id === undefined ? {} : { meetingIds: [args.meeting_id] }),
        },
      }, exec.signal)
      if (args.meeting_id !== undefined) await recordAction(client, exec, args.meeting_id, 'task', `创建任务：${title}`, result.entityType, result.entityId)
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_observe_meeting',
    description: '读取一场会议的完整转录、Supervisor 水位、意图账本、关联项目与人员。会议分析必须以此完整快照为依据。',
    parameters: { meeting_id: { type: 'string', required: true } },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => client.snapshot({ meetingId: args.meeting_id }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_ack_meeting',
    description: '确认 Supervisor 已完整分析到指定转录序号。只有在相关意图已新建、修订、废弃或进入澄清后调用。',
    parameters: {
      meeting_id: { type: 'string', required: true },
      analyzed_sequence: { type: 'integer', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.agent.progress'),
      type: 'meeting.agent.progress',
      payload: { id: args.meeting_id, analyzedSequence: args.analyzed_sequence },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_upsert_meeting_intent',
    description: '按稳定 intent_key 新建或修订会议意图。遇到“张三，不对，李四”等纠正时必须更新同一意图，不得创建重复任务。',
    parameters: {
      meeting_id: { type: 'string', required: true }, intent_key: { type: 'string', required: true },
      kind: { type: 'string', enum: ['task', 'document', 'decision', 'risk', 'note'], required: true },
      title: { type: 'string', required: true }, summary: { type: 'string' }, content: { type: 'string' },
      project_id: { type: 'string' }, project_ids: { type: 'array', items: { type: 'string' } },
      origin: { type: 'string', enum: ['user', 'assistant'] }, question: { type: 'string' },
      assignee_id: { type: 'string' }, due_at: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      evidence_from_sequence: { type: 'integer', required: true }, evidence_to_sequence: { type: 'integer', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.intent.upsert'), type: 'meeting.intent.upsert',
      payload: {
        meetingId: args.meeting_id, intentKey: args.intent_key, kind: args.kind,
        payload: {
          title: args.title,
          ...(args.origin === undefined ? {} : { origin: args.origin }),
          ...(args.question === undefined ? {} : { question: args.question }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.project_id === undefined ? {} : { projectId: args.project_id }),
          ...(args.project_ids === undefined ? {} : { projectIds: args.project_ids }),
          ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
          ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
        },
        evidenceFromSequence: args.evidence_from_sequence,
        evidenceToSequence: args.evidence_to_sequence,
      },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_raise_meeting_question',
    description: 'AI 在会议中提出一个需要用户确认的问题，并作为 assistant 来源的澄清意图持续跟踪。用户回答后修订或终结同一 intent_key。',
    parameters: {
      meeting_id: { type: 'string', required: true }, intent_key: { type: 'string', required: true },
      question: { type: 'string', required: true }, project_id: { type: 'string' },
      evidence_from_sequence: { type: 'integer', required: true }, evidence_to_sequence: { type: 'integer', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const created = await command(client, {
        idempotencyKey: key(exec.callId, 'meeting.question.upsert'), type: 'meeting.intent.upsert',
        payload: {
          meetingId: args.meeting_id, intentKey: args.intent_key, kind: 'note',
          payload: {
            title: args.question, question: args.question, origin: 'assistant',
            ...(args.project_id === undefined ? {} : { projectId: args.project_id }),
          },
          evidenceFromSequence: args.evidence_from_sequence, evidenceToSequence: args.evidence_to_sequence,
        },
      }, exec.signal)
      return command(client, {
        idempotencyKey: key(exec.callId, 'meeting.question.clarifying'), type: 'meeting.intent.status',
        payload: { id: created.entityId, revision: created.version, status: 'clarifying' },
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_reply_in_meeting',
    description: 'AI 作为会议参与者给出简洁回复、提醒或建议，并持久化到会议的“AI 回复与提问”列表。不要用它代替应立即执行的业务工具。',
    parameters: {
      meeting_id: { type: 'string', required: true },
      reply: { type: 'string', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => recordAction(client, exec, args.meeting_id, 'note', args.reply),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_set_meeting_intent_status',
    description: '推进会议意图状态，并可关联 continuable Subagent。suggest 模式提交前必须设为 approved。',
    parameters: {
      intent_id: { type: 'string', required: true }, revision: { type: 'integer', required: true },
      status: { type: 'string', enum: ['clarifying', 'approved', 'executing', 'superseded', 'rejected', 'failed'], required: true },
      subagent_id: { type: 'string' }, error: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.intent.status'), type: 'meeting.intent.status',
      payload: {
        id: args.intent_id, revision: args.revision, status: args.status,
        ...(args.subagent_id === undefined ? {} : { subagentId: args.subagent_id }),
        ...(args.error === undefined ? {} : { error: args.error }),
      },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_commit_meeting_intent',
    description: '以意图 revision 和最新完整转录 basis_sequence 原子提交意图。转录已推进时会拒绝旧提交，必须重新观察和修订。',
    parameters: {
      intent_id: { type: 'string', required: true }, revision: { type: 'integer', required: true },
      basis_sequence: { type: 'integer', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.intent.commit'), type: 'meeting.intent.commit',
      payload: { id: args.intent_id, revision: args.revision, basisSequence: args.basis_sequence },
    }, exec.signal),
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
    name: 'flowboard_update_meeting',
    description: '使用乐观锁修订会议名称、总结、决议或风险，可用于把即时会议的临时标题改为正式标题。',
    parameters: {
      id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true },
      title: { type: 'string' }, summary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.update'), type: 'meeting.update', expectedVersion: args.expected_version,
      payload: {
        id: args.id,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.decisions === undefined ? {} : { decisions: args.decisions }),
        ...(args.risks === undefined ? {} : { risks: args.risks }),
      },
    }, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_create_document',
    description: '立即创建会议资料或项目资料。范围、标题或正文缺失时推断当前可写项目并使用可修订的空白文档。',
    parameters: {
      team_id: { type: 'string' }, project_ids: { type: 'array', items: { type: 'string' } },
      title: { type: 'string' }, content: { type: 'string' }, meeting_id: { type: 'string' },
    },
    output: jsonOutput,
    execute: async (args, exec) => {
      const requestedProject = args.project_ids?.[0]
      const { snapshot, project, team } = await writableScope(client, exec.signal, requestedProject, args.team_id)
      const projectIds = args.project_ids ?? (project === undefined ? [] : [project.id])
      const selectedTeam = team ?? snapshot.teams.find(item => item.id === project?.teamId)
      if (selectedTeam === undefined || projectIds.length === 0) throw new Error('没有可写项目，无法创建资料')
      const title = args.title?.trim() || '未命名资料'
      const result = await command(client, {
        idempotencyKey: key(exec.callId, 'library.create'), type: 'library.create',
        payload: { teamId: selectedTeam.id, projectIds, type: 'doc', title, content: args.content ?? '', ...(args.meeting_id === undefined ? {} : { sourceMeetingId: args.meeting_id }) },
      }, exec.signal)
      if (args.meeting_id !== undefined) await recordAction(client, exec, args.meeting_id, 'document', `创建资料：${title}`, result.entityType, result.entityId)
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
    description: '在所有转录和意图已收敛后写入最终总结并结束会议。任务、资料、决议和风险必须先通过会议意图提交。',
    parameters: {
      meeting_id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true }, summary: { type: 'string', required: true },
    },
    output: jsonOutput,
    execute: async (args, exec) => command(client, {
      idempotencyKey: key(exec.callId, 'meeting.finalize'), type: 'meeting.finalize', expectedVersion: args.expected_version,
      payload: {
        id: args.meeting_id, summary: args.summary,
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
