import { useCallback, useEffect, useState } from 'react'
import { Button, IconPlayOutline16, IconRefreshOutline16, IconStopFill16, Input, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowboardSnapshot, MeetingView, ProjectView } from '@flowboard/contracts'
import type { ClientCommand, FlowboardRoute, FlowboardState, MeetingRuntime } from './controller.ts'
import { BoardView } from './domain/board.tsx'
import { CalendarView } from './domain/calendar.tsx'
import { LibraryView } from './domain/library.tsx'
import { MeetingsView } from './domain/meetings.tsx'
import { PeopleView } from './domain/people.tsx'
import { ProjectsView } from './domain/projects.tsx'
import { Empty, EntityModal, Field, PageHeader, formatDate } from './domain/shared.tsx'
import { useVadRecorder } from './use-audio-recorder.ts'
import css from './flowboard.module.css'

export interface FlowboardInjected {
  hooks: { flowboard: { getSnapshot(): FlowboardState; subscribe(fn: () => void): () => void } }
  getState(): FlowboardState
  navigate(route: FlowboardRoute): void
  refresh(): Promise<void>
  command(value: ClientCommand): Promise<unknown>
  upload(meetingId: string, blob: Blob, clientSegmentId: string, startedAt: string, endedAt: string): Promise<{ text: string | null }>
  setMeetingRuntime(sessionId: string, patch: Partial<MeetingRuntime>): void
}

const projectTabs = [['overview', '概览'], ['board', '看板'], ['table', '任务表'], ['meetings', '会议'], ['library', '资料'], ['members', '成员']] as const

function Sidebar({ state, navigate }: { state: FlowboardState; navigate(route: FlowboardRoute): void }) {
  const route = state.route
  const active = (area: FlowboardRoute['area']) => route.area === area
  return <aside className={css.sidebar}><div className={css.brand}><strong>Flowboard</strong><span>AI 工作空间</span></div><nav aria-label="工作空间导航">
    <button type="button" data-active={active('home')} onClick={() => navigate({ area: 'home' })}>首页</button>
    <div className={css.navGroup}><span>项目</span>{state.snapshot?.projects.map(project => <div className={css.projectTree} key={project.id}><button type="button" className={css.projectNode} data-active={route.area === 'projects' && route.projectId === project.id} onClick={() => navigate({ area: 'projects', projectId: project.id, tab: 'overview' })}><i style={{ background: project.color }} />{project.name}</button><div>{projectTabs.map(([tab, label]) => <button type="button" key={tab} data-active={route.area === 'projects' && route.projectId === project.id && route.tab === tab} onClick={() => navigate({ area: 'projects', projectId: project.id, tab })}>{label}</button>)}</div></div>)}</div>
    <button type="button" data-active={active('meetings')} onClick={() => navigate({ area: 'meetings', meetingId: null })}>会议</button>
    <button type="button" data-active={active('library')} onClick={() => navigate({ area: 'library', libraryId: null })}>资料</button>
    <div className={css.navGroup}><span>我的工作</span><button type="button" data-active={route.area === 'my' && route.tab === 'tasks'} onClick={() => navigate({ area: 'my', tab: 'tasks' })}>任务表</button><button type="button" data-active={route.area === 'my' && route.tab === 'calendar'} onClick={() => navigate({ area: 'my', tab: 'calendar' })}>日程表</button><button type="button" data-active={route.area === 'my' && route.tab === 'board'} onClick={() => navigate({ area: 'my', tab: 'board' })}>个人看板</button></div>
    <div className={css.navGroup}><span>组织</span><button type="button" data-active={route.area === 'organization' && route.tab === 'people'} onClick={() => navigate({ area: 'organization', tab: 'people' })}>人员</button><button type="button" data-active={route.area === 'organization' && route.tab === 'teams'} onClick={() => navigate({ area: 'organization', tab: 'teams' })}>团队</button></div>
  </nav></aside>
}

function Home({ snapshot, command, startMeeting, navigate }: { snapshot: FlowboardSnapshot; command: (value: ClientCommand) => Promise<unknown>; startMeeting(meeting: MeetingView): Promise<void>; navigate(route: FlowboardRoute): void }) {
  const [create, setCreate] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const tasks = snapshot.tasks.filter(task => task.assigneeId === snapshot.actor.id && task.progress < 1).slice(0, 6)
  const events = snapshot.events.filter(event => event.startAt.startsWith(today)).slice(0, 6)
  const active = snapshot.projects.slice(0, 5)
  return <section><PageHeader title={`你好，${snapshot.actor.name}`} meta="今天的工作与会议都在这里" actions={<Button variant="primary" icon={<IconPlayOutline16 />} disabled={snapshot.projects.length === 0} onClick={() => setCreate(true)}>开始 AI 会议</Button>} /><div className={css.metrics}><article><span>待办任务</span><strong>{tasks.length}</strong></article><article><span>今日安排</span><strong>{events.length}</strong></article><article><span>活跃项目</span><strong>{snapshot.projects.length}</strong></article><article><span>AI 操作</span><strong>{snapshot.aiActions.length}</strong></article></div><div className={css.homeGrid}><section><h3>我的任务</h3>{tasks.map(task => <button type="button" key={task.id} onClick={() => navigate({ area: 'projects', projectId: task.projectId, tab: 'board' })}><strong>{task.title}</strong><span>{snapshot.projects.find(project => project.id === task.projectId)?.name} · {formatDate(task.dueAt, false)}</span></button>)}{tasks.length === 0 && <Empty title="今天没有待办任务" />}</section><section><h3>今日安排</h3>{events.map(event => <article key={event.id}><strong>{event.title}</strong><span>{formatDate(event.startAt)}</span></article>)}{events.length === 0 && <Empty title="今天没有日程" />}</section><section><h3>活跃项目</h3>{active.map(project => <button type="button" key={project.id} onClick={() => navigate({ area: 'projects', projectId: project.id, tab: 'overview' })}><i style={{ background: project.color }} /><strong>{project.name}</strong><span>{snapshot.tasks.filter(task => task.projectId === project.id && task.progress < 1).length} 项进行中</span></button>)}</section><section><h3>最近 AI 操作</h3>{snapshot.aiActions.slice(0, 5).map(action => <article key={action.id}><strong>{action.summary}</strong><span>{formatDate(action.createdAt)}</span></article>)}{snapshot.aiActions.length === 0 && <Empty title="暂无 AI 操作" />}</section></div>
    <EntityModal open={create} title="开始 AI 会议" submitLabel="创建并开始" onClose={() => setCreate(false)} onSubmit={async data => { const project = snapshot.projects.find(item => item.id === String(data.get('projectId'))); if (project === undefined) throw new Error('请选择项目'); const result = await command({ type: 'meeting.create', payload: { teamId: project.teamId, projectIds: [project.id], title: String(data.get('title')), settings: { automation: String(data.get('automation')) as 'record' | 'suggest' | 'execute', silenceSec: Number(data.get('silenceSec')) } } }) as { entityId: string }; const meeting = snapshot.meetings.find(item => item.id === result.entityId) ?? { id: result.entityId, version: 1 } as MeetingView; await startMeeting(meeting) }}><Field label="会议主题"><Input name="title" required autoFocus /></Field><Field label="关联项目"><select name="projectId" required>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field><div className={css.formGrid}><Field label="AI 参与"><select name="automation" defaultValue="suggest"><option value="record">只记录</option><option value="suggest">建议后执行</option><option value="execute">自动执行安全操作</option></select></Field><Field label="静音提交（秒）"><input name="silenceSec" type="number" min="1" max="30" defaultValue="4" /></Field></div></EntityModal>
  </section>
}

function ProjectOverview({ snapshot, project }: { snapshot: FlowboardSnapshot; project: ProjectView }) {
  const tasks = snapshot.tasks.filter(task => task.projectId === project.id)
  const meetingIds = new Set(snapshot.links.projectMeetings.filter(link => link.projectId === project.id).map(link => link.meetingId))
  const documentIds = new Set(snapshot.links.projectLibrary.filter(link => link.projectId === project.id).map(link => link.libraryItemId))
  return <section><PageHeader title={project.name} meta={`${project.key} · ${project.description || '暂无项目描述'}`} /><div className={css.metrics}><article><span>任务</span><strong>{tasks.length}</strong></article><article><span>已完成</span><strong>{tasks.filter(task => task.progress >= 1).length}</strong></article><article><span>会议</span><strong>{meetingIds.size}</strong></article><article><span>资料</span><strong>{documentIds.size}</strong></article></div><div className={css.projectSummary}><h3>工作流</h3>{snapshot.workflowStatuses.filter(status => status.projectId === project.id).sort((a, b) => a.position - b.position).map(status => <article key={status.id}><i style={{ background: status.color }} /><strong>{status.name}</strong><span>{tasks.filter(task => task.statusId === status.id).length}</span></article>)}</div></section>
}

function TeamsView({ snapshot }: { snapshot: FlowboardSnapshot }) {
  return <section><PageHeader title="团队" meta={`${snapshot.teams.length} 个团队`} /><div className={css.teamList}>{snapshot.teams.map(team => <article key={team.id}><strong>{team.name}</strong><span>{team.description || '暂无说明'}</span><small>{snapshot.teamMembers.filter(member => member.teamId === team.id).length} 位成员 · {team.role}</small></article>)}</div></section>
}

function MeetingDetail({ snapshot, meeting }: { snapshot: FlowboardSnapshot; meeting: MeetingView }) {
  const utterances = snapshot.utterances.filter(item => item.meetingId === meeting.id)
  const actions = snapshot.aiActions.filter(item => item.meetingId === meeting.id)
  const documents = new Set(snapshot.links.meetingLibrary.filter(link => link.meetingId === meeting.id).map(link => link.libraryItemId))
  return <section><PageHeader title={meeting.title} meta={`${meeting.status} · ${formatDate(meeting.startedAt ?? meeting.createdAt)}`} /><div className={css.meetingDetail}><section><h3>转录稿</h3>{utterances.map(item => <p key={item.id}><time>#{item.sequence}</time>{item.text}</p>)}{utterances.length === 0 && <Empty title="等待会议转录" />}</section><aside><h3>核心总结</h3><p>{meeting.summary || '会议结束后由 AI 整理'}</p><h3>决议</h3>{meeting.decisions.map(item => <p key={item}>{item}</p>)}<h3>风险</h3>{meeting.risks.map(item => <p key={item}>{item}</p>)}<h3>会议资料</h3>{snapshot.library.filter(item => documents.has(item.id)).map(item => <p key={item.id}>{item.title}</p>)}<h3>AI 操作</h3>{actions.map(item => <p key={item.id}>{item.summary}</p>)}</aside></div></section>
}

export function FlowboardView(props: ConvViewProps & InjectFace<FlowboardInjected>) {
  const state = props.useFlowboard(value => value)
  const sessionId = String(props.sessionId)
  if (state.snapshot === null) return <div className={css.loading}><span className={css.loadingMark} />{state.status === 'error' ? state.error : '正在连接 Flowboard'}</div>
  const snapshot = state.snapshot
  const route = state.route
  const startMeeting = async (meeting: MeetingView) => { await props.command({ type: 'meeting.update', expectedVersion: meeting.version, payload: { id: meeting.id, status: 'live' } }); props.setMeetingRuntime(sessionId, { meetingId: meeting.id, error: null }); props.navigate({ area: 'meetings', meetingId: meeting.id }) }
  const stopMeeting = async (meeting: MeetingView) => { await props.command({ type: 'meeting.update', expectedVersion: meeting.version, payload: { id: meeting.id, status: 'finalizing' } }); const prompt = `会议 ${meeting.id} 已停止采集。请先调用 flowboard_snapshot 读取会议详情，等待最后转写完成，然后调用 flowboard_finalize_meeting 整理总结、决议、风险、行动项和会议资料。`; props.inputActions.setDraft(prompt); props.inputActions.submit() }
  let body
  if (route.area === 'home') body = <Home snapshot={snapshot} command={props.command} startMeeting={startMeeting} navigate={props.navigate} />
  else if (route.area === 'projects') { const projectId = route.projectId; const project = snapshot.projects.find(item => item.id === projectId); body = project === undefined ? <ProjectsView snapshot={snapshot} selectedProjectId={null} selectProject={id => props.navigate({ area: 'projects', projectId: id, tab: 'overview' })} command={props.command} /> : route.tab === 'overview' ? <ProjectOverview snapshot={snapshot} project={project} /> : route.tab === 'board' || route.tab === 'table' ? <BoardView snapshot={snapshot} projectId={project.id} command={props.command} mode={route.tab} /> : route.tab === 'meetings' ? <MeetingsView snapshot={snapshot} projectId={project.id} command={props.command} onStart={startMeeting} onStop={stopMeeting} onOpen={meeting => props.navigate({ area: 'meetings', meetingId: meeting.id })} /> : route.tab === 'library' ? <LibraryView snapshot={snapshot} projectId={project.id} command={props.command} /> : <PeopleView snapshot={snapshot} command={props.command} /> }
  else if (route.area === 'meetings') { const meetingId = route.meetingId; const meeting = snapshot.meetings.find(item => item.id === meetingId); body = meeting === undefined ? <MeetingsView snapshot={snapshot} projectId={null} command={props.command} onStart={startMeeting} onStop={stopMeeting} onOpen={item => props.navigate({ area: 'meetings', meetingId: item.id })} /> : <MeetingDetail snapshot={snapshot} meeting={meeting} /> }
  else if (route.area === 'library') body = <LibraryView snapshot={snapshot} projectId={null} command={props.command} />
  else if (route.area === 'my') body = route.tab === 'calendar' ? <CalendarView snapshot={snapshot} projectId={null} command={props.command} /> : <BoardView snapshot={snapshot} projectId={null} command={props.command} mode={route.tab === 'tasks' ? 'table' : 'board'} personal />
  else body = route.tab === 'people' ? <PeopleView snapshot={snapshot} command={props.command} /> : <TeamsView snapshot={snapshot} />
  return <div className={css.workspace}><Sidebar state={state} navigate={props.navigate} /><div className={css.mainPane}><header className={css.topbar}><span>{snapshot.actor.name}</span><div><StateDot state={state.error === null ? 'done' : 'error'} /><span>{state.error === null ? '已同步' : '连接异常'}</span><Tooltip label="刷新"><Button variant="toolbar" size="sm" aria-label="刷新" disabled={state.busy} onClick={() => void props.refresh().catch(() => undefined)}><IconRefreshOutline16 /></Button></Tooltip></div></header>{state.error !== null && <div className={css.errorBanner}>{state.error}</div>}<main className={css.workspaceContent}>{state.busy && <div className={css.progress} />}{body}</main></div></div>
}

export function FlowboardMeetingDock(props: PropsRuntime<'conversation.input.dock'> & InjectFace<FlowboardInjected>) {
  const state = props.useFlowboard(value => value)
  const sessionId = String(props.sessionId)
  const runtime = state.meetingRuntimes[sessionId]
  const input = props.useInput(value => value)
  const meeting = state.snapshot?.meetings.find(item => item.id === runtime?.meetingId)
  const active = meeting?.status === 'live'
  const onSegment = useCallback(async (blob: Blob, startedAt: string, endedAt: string) => {
    if (meeting === undefined) return
    props.setMeetingRuntime(sessionId, { uploading: true, error: null })
    try {
      const result = await props.upload(meeting.id, blob, crypto.randomUUID(), startedAt, endedAt)
      const text = result.text?.trim()
      if (text !== undefined && text !== '') {
        const latest = props.getState().meetingRuntimes[sessionId]?.candidate ?? ''
        const candidate = latest === '' ? text : `${latest}\n${text}`
        const currentDraft = input.draft.trim()
        props.inputActions.setDraft(currentDraft === '' ? candidate : `${input.draft}\n${text}`)
        props.setMeetingRuntime(sessionId, { candidate, awaitingConsumption: false })
      }
    } finally { props.setMeetingRuntime(sessionId, { uploading: false }) }
  }, [input.draft, meeting, props, sessionId])
  useVadRecorder({ active, onSegment, onState: recording => props.setMeetingRuntime(sessionId, { recording }), onError: error => props.setMeetingRuntime(sessionId, { error }) })
  useEffect(() => {
    if (runtime?.candidate === undefined || runtime.candidate === '' || runtime.awaitingConsumption || input.phase !== 'plain') return
    const timer = window.setTimeout(() => { props.setMeetingRuntime(sessionId, { awaitingConsumption: true }); props.inputActions.submit() }, (meeting?.settings.silenceSec ?? 4) * 1_000)
    return () => window.clearTimeout(timer)
  }, [input.phase, meeting?.settings.silenceSec, props, runtime?.awaitingConsumption, runtime?.candidate, sessionId])
  useEffect(() => {
    if (runtime?.awaitingConsumption === true && input.draft === '' && input.phase === 'plain') props.setMeetingRuntime(sessionId, { candidate: '', awaitingConsumption: false })
  }, [input.draft, input.phase, props, runtime?.awaitingConsumption, sessionId])
  if (meeting === undefined || runtime === undefined) return null
  return <div className={css.meetingDock}><span className={active ? css.liveDot : css.finalizingDot} /> <strong>{meeting.title}</strong><span>{active ? runtime.recording ? '正在听取发言' : runtime.uploading ? '正在转写' : 'AI 秘书在线' : 'AI 正在整理'}</span><p>{runtime.candidate || '转录内容会持续进入输入候选框'}</p>{runtime.error !== null && <em>{runtime.error}</em>}{active && <Button variant="outline" size="sm" icon={<IconStopFill16 />} onClick={() => void props.command({ type: 'meeting.update', expectedVersion: meeting.version, payload: { id: meeting.id, status: 'finalizing' } }).then(() => { const prompt = `会议 ${meeting.id} 已结束，请读取会议并调用 flowboard_finalize_meeting 完成整理。`; props.inputActions.setDraft(prompt); props.inputActions.submit() }).catch(() => undefined)}>停止</Button>}</div>
}
