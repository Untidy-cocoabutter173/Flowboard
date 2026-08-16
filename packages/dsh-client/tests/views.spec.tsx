import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FlowboardSnapshot } from '@flowboard/contracts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => <button {...props}>{icon}{children}</button>,
  Input: ({ icon: _icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }) => <input {...props} />,
  Modal: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? <div>{children}</div> : null,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  StateDot: () => <span />,
  IconEditOutline16: () => <span />,
  IconLinkOutline16: () => <span />,
  IconPlayOutline16: () => <span />,
  IconPlusOutline16: () => <span />,
  IconSearchOutline16: () => <span />,
  IconStopFill16: () => <span />,
  IconTrashOutline16: () => <span />,
  IconUserOutline16: () => <span />,
}))
import { BoardView } from '../src/client/domain/board.tsx'
import { CalendarView } from '../src/client/domain/calendar.tsx'
import { LibraryView } from '../src/client/domain/library.tsx'
import { MeetingsView } from '../src/client/domain/meetings.tsx'
import { PeopleView } from '../src/client/domain/people.tsx'
import { ProjectsView } from '../src/client/domain/projects.tsx'
import type { CommandHandler } from '../src/client/domain/shared.tsx'

const snapshot: FlowboardSnapshot = {
  apiVersion: 1, cursor: 8,
  actor: { id: 'user-1', tenantId: 'tenant-1', name: '林晓', email: 'lin@example.com' },
  teams: [{ id: 'team-1', tenantId: 'tenant-1', parentId: null, name: '产品团队', role: 'owner', createdAt: '2026-08-17T00:00:00Z' }],
  people: [{ id: 'user-1', tenantId: 'tenant-1', name: '林晓', email: 'lin@example.com', department: '产品', title: '负责人', createdAt: '2026-08-17T00:00:00Z' }],
  projects: [{ id: 'project-1', tenantId: 'tenant-1', teamId: 'team-1', parentId: null, name: '秋季发布', description: '核心版本交付', role: 'owner', version: 1, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' }],
  projectMembers: [{ projectId: 'project-1', userId: 'user-1', role: 'owner' }],
  columns: [{ id: 'column-1', tenantId: 'tenant-1', name: '进行中', position: 0, version: 1 }],
  categories: [{ id: 'category-1', tenantId: 'tenant-1', name: '产品', color: '#3370ff', version: 1 }],
  tasks: [{ id: 'task-1', tenantId: 'tenant-1', projectId: 'project-1', title: '验收工作台', summary: '检查主要路径', detail: '', columnId: 'column-1', categoryId: 'category-1', assigneeId: 'user-1', priority: 'high', progress: .6, dueAt: '2026-08-20T09:00:00Z', customData: {}, version: 1, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' }],
  meetings: [{ id: 'meeting-1', tenantId: 'tenant-1', projectId: 'project-1', title: '发布周会', status: 'idle', settings: { mode: 'feedback', answerQuestions: true, silenceSec: 3 }, transcript: '确认发布范围', summary: '按计划推进', startedAt: null, endedAt: null, version: 1, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' }],
  library: [{ id: 'library-1', tenantId: 'tenant-1', projectId: 'project-1', type: 'doc', title: '发布说明', content: '版本范围', url: null, categoryId: null, version: 1, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' }],
  events: [{ id: 'event-1', tenantId: 'tenant-1', projectId: 'project-1', type: 'deadline', title: '提测截止', startAt: '2026-08-20T09:00:00Z', endAt: null, allDay: false, ownerId: 'user-1', attendeeIds: [], taskId: 'task-1', version: 1, createdAt: '2026-08-17T00:00:00Z', updatedAt: '2026-08-17T00:00:00Z' }],
}
const command: CommandHandler = async () => undefined

describe('六个业务页面', () => {
  it.each([
    ['看板', () => <BoardView snapshot={snapshot} projectId="project-1" command={command} />, '验收工作台'],
    ['项目', () => <ProjectsView snapshot={snapshot} selectedProjectId="project-1" selectProject={() => undefined} command={command} />, '秋季发布'],
    ['会议', () => <MeetingsView snapshot={snapshot} projectId="project-1" command={command} upload={async () => undefined} />, '发布周会'],
    ['资料', () => <LibraryView snapshot={snapshot} projectId="project-1" command={command} />, '发布说明'],
    ['日历', () => <CalendarView snapshot={snapshot} projectId="project-1" command={command} />, '提测截止'],
    ['成员', () => <PeopleView snapshot={snapshot} command={command} />, '林晓'],
  ])('%s 页面可完整渲染', (_name, view, expected) => {
    expect(renderToStaticMarkup(view())).toContain(expected)
  })
})
