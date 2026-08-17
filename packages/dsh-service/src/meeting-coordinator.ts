import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { FlowboardSnapshot, MeetingAgentBindingView } from '@flowboard/contracts'
import type { FlowboardHttpClient } from './http-client.ts'

interface AgentMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: Array<{ type: 'text'; text: string }>
  readonly source: { kind: 'plugin'; plugin: string; form: string }
}

interface AgentPort {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly inbox: { replace(messageId: string, message: AgentMessage): boolean }
  readonly ctx: Context
  followup(message: AgentMessage): void
  steer(message: AgentMessage): void
}

interface AgentRegistryPort { get(id: string): AgentPort | undefined }
interface SystemPromptPort {
  context(value: { name: string; order: number; text(context: { agent?: { id: string } }): string }): () => void
}
interface AgentEventContext {
  on(name: 'agent/turn-stopping', listener: (event: { agent: AgentPort; signal: AbortSignal }) => void | Promise<void>): () => void
}

const PLUGIN = '@flowboard/dsh-service'

function message(text: string): AgentMessage {
  return Object.freeze({
    id: randomUUID(), role: 'user' as const,
    content: [Object.freeze({ type: 'text' as const, text })],
    source: Object.freeze({ kind: 'plugin' as const, plugin: PLUGIN, form: 'meeting-supervisor' }),
  })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

export class MeetingCoordinator {
  private readonly abort = new AbortController()
  private readonly snapshots = new Map<string, FlowboardSnapshot>()
  private readonly pendingMessages = new Map<string, string>()
  private readonly attachedAgents = new Map<string, () => void>()
  private readonly finalizationNotified = new Set<string>()
  private running: Promise<void> | null = null

  constructor(
    private readonly ctx: Context,
    private readonly client: FlowboardHttpClient,
    private readonly agents: AgentRegistryPort,
    systemPrompt: SystemPromptPort,
  ) {
    ctx.effect(() => systemPrompt.context({
      name: 'flowboard:meeting-supervisor',
      order: 220,
      text: context => {
        const sessionId = context.agent?.id
        if (sessionId === undefined) return ''
        const snapshot = this.snapshots.get(sessionId)
        if (snapshot === undefined) return ''
        return this.renderContext(snapshot)
      },
    }), 'flowboard.meetingSupervisorContext')
  }

  start(): void {
    if (this.running !== null) return
    this.running = this.run()
    this.ctx.effect(() => () => this.stop(), 'flowboard.meetingCoordinator')
  }

  stop(): void {
    this.abort.abort()
    for (const dispose of this.attachedAgents.values()) dispose()
    this.attachedAgents.clear()
  }

  private async run(): Promise<void> {
    let cursor = 0
    while (!this.abort.signal.aborted) {
      try {
        const workspace = await this.client.snapshot({}, this.abort.signal)
        cursor = workspace.cursor
        const active = workspace.meetingAgentBindings.filter(binding => binding.state === 'active')
        const activeSessions = new Set(active.map(binding => binding.sessionId))
        for (const [sessionId, dispose] of this.attachedAgents) {
          if (activeSessions.has(sessionId)) continue
          dispose(); this.attachedAgents.delete(sessionId); this.snapshots.delete(sessionId)
        }
        await Promise.all(active.map(binding => this.synchronize(binding)))
        await this.client.changes({ cursor, waitMs: 30_000 }, this.abort.signal)
      } catch (error) {
        if (this.abort.signal.aborted) return
        this.ctx.logger.warn(`Flowboard MeetingCoordinator: ${error instanceof Error ? error.message : String(error)}`)
        await delay(1_000, this.abort.signal)
      }
    }
  }

  private async synchronize(binding: MeetingAgentBindingView): Promise<void> {
    const agent = this.agents.get(binding.sessionId)
    if (agent === undefined) return
    this.attach(agent)
    const snapshot = await this.client.snapshot({ meetingId: binding.meetingId }, this.abort.signal)
    this.snapshots.set(binding.sessionId, snapshot)
    const meeting = snapshot.meetings.find(item => item.id === binding.meetingId)
    if (meeting === undefined) return
    const latest = snapshot.utterances.at(-1)?.sequence ?? 0
    if (latest > binding.deliveredSequence) {
      await this.client.command({
        idempotencyKey: `coordinator:deliver:${binding.meetingId}:${latest}`,
        type: 'meeting.agent.progress', payload: { id: binding.meetingId, deliveredSequence: latest },
      }, this.abort.signal)
      const current = snapshot.meetingAgentBindings.find(item => item.meetingId === binding.meetingId)
      if (current !== undefined) current.deliveredSequence = latest
      this.notify(agent, binding.meetingId, this.transcriptNotice(snapshot, binding.deliveredSequence))
    }
    if (meeting.status === 'finalizing' && !this.finalizationNotified.has(meeting.id)) {
      this.finalizationNotified.add(meeting.id)
      this.notify(agent, meeting.id, `会议「${meeting.title}」已停止采集。确认所有转录均已分析、所有任务/资料/决议/风险意图均已提交或终结后，调用 flowboard_finalize_meeting 写入最终总结并结束会议。`)
    }
  }

  private attach(agent: AgentPort): void {
    if (this.attachedAgents.has(agent.id)) return
    const eventContext = agent.ctx as unknown as AgentEventContext
    const dispose = eventContext.on('agent/turn-stopping', async ({ agent: stopping, signal }) => {
      signal.throwIfAborted()
      const cached = this.snapshots.get(stopping.id)
      const cachedBinding = cached?.meetingAgentBindings.find(item => item.sessionId === stopping.id && item.state === 'active')
      if (cachedBinding === undefined) return
      const snapshot = await this.client.snapshot({ meetingId: cachedBinding.meetingId }, signal)
      this.snapshots.set(stopping.id, snapshot)
      const binding = snapshot.meetingAgentBindings.find(item => item.sessionId === stopping.id && item.state === 'active')
      if (binding === undefined || binding.deliveredSequence <= binding.analyzedSequence) return
      stopping.steer(message(`仍有转录未确认：已投递序号 ${binding.deliveredSequence}，已分析序号 ${binding.analyzedSequence}。继续检查完整会议上下文，更新或废弃旧意图，然后调用 flowboard_ack_meeting。`))
    })
    this.attachedAgents.set(agent.id, dispose)
  }

  private notify(agent: AgentPort, meetingId: string, text: string): void {
    const next = message(text)
    const previousId = this.pendingMessages.get(meetingId)
    if (previousId !== undefined && agent.inbox.replace(previousId, next)) {
      this.pendingMessages.set(meetingId, next.id)
      return
    }
    this.pendingMessages.set(meetingId, next.id)
    if (agent.status === 'running') agent.steer(next)
    else agent.followup(next)
  }

  private transcriptNotice(snapshot: FlowboardSnapshot, after: number): string {
    const meeting = snapshot.meetings[0]
    const fresh = snapshot.utterances.filter(item => item.sequence > after)
    const last = fresh.at(-1)?.sequence ?? after
    const lines = fresh.map(item => `[${item.sequence}] ${item.text}`).join('\n')
    return `会议「${meeting?.title ?? '未命名会议'}」有新转录（${after + 1}-${last}）：\n${lines}\n请结合完整会议上下文识别新增、纠正或撤销的意图。不要仅按最后一句执行；先更新意图账本，必要时派发 continuable Subagent，最后调用 flowboard_ack_meeting 确认分析水位。`
  }

  private renderContext(snapshot: FlowboardSnapshot): string {
    const meeting = snapshot.meetings[0]
    if (meeting === undefined) return ''
    const binding = snapshot.meetingAgentBindings.find(item => item.meetingId === meeting.id)
    const projects = snapshot.projects.map(item => `${item.name}(${item.id})`).join('、')
    const people = snapshot.people.map(item => `${item.name}(${item.id})`).join('、')
    const intents = snapshot.meetingIntents.map(item => `- ${item.id} r${item.revision} [${item.status}/${item.kind}] ${item.payload.title}，证据 ${item.evidenceFromSequence}-${item.evidenceToSequence}${item.subagentId === null ? '' : `，subagent=${item.subagentId}`}`).join('\n') || '- 无'
    const transcript = snapshot.utterances.map(item => `[${item.sequence}] ${item.text}`).join('\n') || '（暂无转录）'
    return [
      '# Flowboard 会议 Supervisor',
      `会议：${meeting.title} (${meeting.id})，状态=${meeting.status}，自动化=${meeting.settings.automation}`,
      `水位：delivered=${binding?.deliveredSequence ?? 0}，analyzed=${binding?.analyzedSequence ?? 0}`,
      `关联项目：${projects || '无'}`,
      `可选人员：${people || '无'}`,
      '规则：始终基于完整转录判断；更正覆盖旧意图；任务、资料、决议、风险或备注先 upsert intent，再按自动化级别审批，最后用最新 sequence commit。record 不写业务实体，suggest 必须 approved，execute 自动处理明确且可逆的操作。复杂整理可使用 continuable Subagent，Supervisor 负责最终校验和提交。',
      '项目、会议等容器级创建不是 task 意图：用户要求创建项目时直接调用 flowboard_create_project，绝不能创建标题为“新建项目”的任务。缺少名称时先创建“未命名项目”，再根据后续转录调用 flowboard_update_project。',
      '需要向会议参与者提出问题时调用 flowboard_raise_meeting_question；需要主动回复、提醒或给出建议时调用 flowboard_reply_in_meeting。不要只在聊天中输出而不写入会议。',
      '即时行动：安全可逆的创建操作不要等待非关键字段；使用临时标题或空值先创建，之后基于最新 version 修正。确有歧义需要用户回答时调用 flowboard_raise_meeting_question，建立 origin=assistant 的澄清意图；后续回答必须修订或终结同一 intent_key。',
      '当前意图：', intents,
      '完整转录：', transcript,
    ].join('\n')
  }
}
