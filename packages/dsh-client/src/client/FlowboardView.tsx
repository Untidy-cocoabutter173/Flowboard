import { Button, IconRefreshOutline16, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientCommand, FlowboardSection, FlowboardState } from './controller.ts'
import { BoardView } from './domain/board.tsx'
import { CalendarView } from './domain/calendar.tsx'
import { LibraryView } from './domain/library.tsx'
import { MeetingsView } from './domain/meetings.tsx'
import { PeopleView } from './domain/people.tsx'
import { ProjectsView } from './domain/projects.tsx'
import css from './flowboard.module.css'

export interface FlowboardInjected {
  hooks: { flowboard: { getSnapshot(): FlowboardState; subscribe(fn: () => void): () => void } }
  selectProject(id: string): void
  selectSection(section: FlowboardSection): void
  refresh(): Promise<void>
  command(value: ClientCommand): Promise<void>
  upload(meetingId: string, blob: Blob): Promise<unknown>
}

const sections: Array<[FlowboardSection, string]> = [
  ['board', '看板'], ['projects', '项目'], ['meetings', '会议'], ['library', '资料'], ['calendar', '日历'], ['people', '成员'],
]

export function FlowboardView(props: ConvViewProps & InjectFace<FlowboardInjected>) {
  const state = props.useFlowboard(value => value)
  if (state.snapshot === null) return <div className={css.loading}><span className={css.loadingMark} />{state.status === 'error' ? state.error : '正在连接 Flowboard'}</div>
  const body = {
    projects: <ProjectsView snapshot={state.snapshot} selectedProjectId={state.selectedProjectId} selectProject={props.selectProject} command={props.command} />,
    board: <BoardView snapshot={state.snapshot} projectId={state.selectedProjectId} command={props.command} />,
    meetings: <MeetingsView snapshot={state.snapshot} projectId={state.selectedProjectId} command={props.command} upload={props.upload} />,
    library: <LibraryView snapshot={state.snapshot} projectId={state.selectedProjectId} command={props.command} />,
    calendar: <CalendarView snapshot={state.snapshot} projectId={state.selectedProjectId} command={props.command} />,
    people: <PeopleView snapshot={state.snapshot} command={props.command} />,
  }[state.section]
  return <div className={css.shell}>
    <header className={css.workspaceHeader}>
      <div className={css.identity}><strong>Flowboard</strong><span>{state.snapshot.actor.name}</span></div>
      <div className={css.projectControl}><span>项目</span><select value={state.selectedProjectId ?? ''} onChange={event => props.selectProject(event.target.value)} disabled={state.snapshot.projects.length === 0}>
        {state.snapshot.projects.length === 0 && <option value="">暂无项目</option>}
        {state.snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></div>
      <div className={css.syncState}><StateDot state={state.error === null ? 'done' : 'error'} /><span>{state.error === null ? '已同步' : '连接异常'}</span><Tooltip label="刷新"><Button variant="toolbar" size="sm" aria-label="刷新" disabled={state.busy} onClick={() => void props.refresh().catch(() => undefined)}><IconRefreshOutline16 /></Button></Tooltip></div>
    </header>
    <nav className={css.tabs} aria-label="Flowboard 模块">{sections.map(([id, label]) => <button type="button" aria-current={state.section === id ? 'page' : undefined} className={state.section === id ? css.activeTab : undefined} onClick={() => props.selectSection(id)} key={id}>{label}</button>)}</nav>
    {state.error !== null && <div className={css.errorBanner} role="status"><span>{state.error}</span><button type="button" onClick={() => void props.refresh().catch(() => undefined)}>重试</button></div>}
    <main className={css.content}>{state.busy && <div className={css.progress} aria-label="正在处理" />}{body}</main>
  </div>
}
