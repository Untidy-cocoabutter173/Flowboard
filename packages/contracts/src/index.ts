import { z } from 'zod'

export const API_VERSION = 2 as const
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

export type AccessRole = 'owner' | 'admin' | 'member' | 'viewer'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type MeetingStatus = 'scheduled' | 'live' | 'finalizing' | 'ended' | 'cancelled'
export type AutomationLevel = 'record' | 'suggest' | 'execute'
export type FeedbackMode = 'silent' | 'activity'
export type LibraryItemType = 'doc' | 'link'
export type CalendarEventType = 'meeting' | 'deadline' | 'event' | 'reminder'
export type SavedViewType = 'board' | 'table' | 'calendar'
export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select' | 'person'
export type JsonScalar = string | number | boolean | null

export interface ActorView {
  id: string
  tenantId: string
  name: string
  email: string | null
}

export interface TeamView {
  id: string
  tenantId: string
  parentId: string | null
  name: string
  description: string
  role: AccessRole
  version: number
  createdAt: string
  updatedAt: string
}

export interface TeamMemberView {
  teamId: string
  userId: string
  role: AccessRole
}

export interface PersonView {
  id: string
  tenantId: string
  name: string
  email: string | null
  department: string | null
  title: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProjectView {
  id: string
  tenantId: string
  teamId: string
  parentId: string | null
  key: string
  name: string
  description: string
  color: string
  role: AccessRole
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProjectMemberView {
  projectId: string
  userId: string
  role: AccessRole
}

export interface WorkflowStatusView {
  id: string
  tenantId: string
  projectId: string
  name: string
  color: string
  position: number
  category: 'backlog' | 'active' | 'done'
  version: number
}

export interface TaskFieldDefinitionView {
  id: string
  tenantId: string
  projectId: string
  key: string
  name: string
  type: FieldType
  required: boolean
  options: string[]
  position: number
  version: number
}

export interface SavedViewView {
  id: string
  tenantId: string
  projectId: string
  name: string
  type: SavedViewType
  filters: Record<string, JsonScalar | JsonScalar[]>
  sorts: Array<{ field: string; direction: 'asc' | 'desc' }>
  groupBy: string | null
  fields: string[]
  version: number
}

export interface TaskView {
  id: string
  tenantId: string
  projectId: string
  sequence: number
  title: string
  summary: string
  detail: string
  statusId: string
  categoryId: string | null
  assigneeId: string | null
  priority: Priority
  progress: number
  dueAt: string | null
  customData: Record<string, JsonScalar>
  version: number
  createdAt: string
  updatedAt: string
}

export interface MeetingSettings {
  automation: AutomationLevel
  feedback: FeedbackMode
  answerQuestions: boolean
  silenceSec: number
}

export interface MeetingView {
  id: string
  tenantId: string
  teamId: string
  title: string
  status: MeetingStatus
  settings: MeetingSettings
  transcript: string
  summary: string
  decisions: string[]
  risks: string[]
  startedAt: string | null
  endedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface MeetingUtteranceView {
  id: string
  meetingId: string
  sequence: number
  speakerId: string | null
  text: string
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}

export interface MeetingAiActionView {
  id: string
  meetingId: string
  callId: string | null
  kind: 'task' | 'document' | 'decision' | 'note' | 'finalize'
  summary: string
  entityType: string | null
  entityId: string | null
  ok: boolean
  createdAt: string
}

export interface LibraryItemView {
  id: string
  tenantId: string
  teamId: string
  type: LibraryItemType
  title: string
  content: string
  url: string | null
  categoryId: string | null
  sourceMeetingId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CalendarEventView {
  id: string
  tenantId: string
  projectId: string | null
  type: CalendarEventType
  title: string
  startAt: string
  endAt: string | null
  allDay: boolean
  ownerId: string | null
  attendeeIds: string[]
  taskId: string | null
  meetingId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CategoryView {
  id: string
  tenantId: string
  name: string
  color: string
  version: number
}

export interface ResourceLinks {
  projectMeetings: Array<{ projectId: string; meetingId: string }>
  projectLibrary: Array<{ projectId: string; libraryItemId: string }>
  meetingLibrary: Array<{ meetingId: string; libraryItemId: string }>
  taskMeetings: Array<{ taskId: string; meetingId: string }>
  taskLibrary: Array<{ taskId: string; libraryItemId: string }>
}

export interface FlowboardSnapshot {
  apiVersion: typeof API_VERSION
  cursor: number
  actor: ActorView
  teams: TeamView[]
  teamMembers: TeamMemberView[]
  people: PersonView[]
  projects: ProjectView[]
  projectMembers: ProjectMemberView[]
  workflowStatuses: WorkflowStatusView[]
  fieldDefinitions: TaskFieldDefinitionView[]
  savedViews: SavedViewView[]
  categories: CategoryView[]
  tasks: TaskView[]
  meetings: MeetingView[]
  utterances: MeetingUtteranceView[]
  aiActions: MeetingAiActionView[]
  library: LibraryItemView[]
  events: CalendarEventView[]
  links: ResourceLinks
}

export interface SnapshotRequest {
  projectId?: string | undefined
  meetingId?: string | undefined
  compact?: boolean | undefined
}

export interface WorkspaceSummary {
  apiVersion: typeof API_VERSION
  cursor: number
  actor: ActorView
  teams: Array<Pick<TeamView, 'id' | 'name' | 'role'>>
  projects: Array<Pick<ProjectView, 'id' | 'teamId' | 'key' | 'name' | 'role'>>
  liveMeetings: Array<Pick<MeetingView, 'id' | 'teamId' | 'title' | 'status' | 'startedAt'>>
  counts: { projects: number; tasks: number; meetings: number; documents: number; people: number }
}

export interface CommandEnvelope<Type extends string, Payload> {
  idempotencyKey: string
  type: Type
  payload: Payload
  expectedVersion?: number
}

export interface FinalizeActionItem {
  key: string
  projectId: string
  title: string
  summary?: string
  assigneeId?: string
  dueAt?: string
  priority?: Priority
}

export interface FinalizeDocument {
  key: string
  title: string
  content: string
  projectIds: string[]
}

export type CommandRequest =
  | CommandEnvelope<'team.create', { name: string; description?: string; parentId?: string }>
  | CommandEnvelope<'team.update', { id: string; name?: string; description?: string }>
  | CommandEnvelope<'team.delete', { id: string }>
  | CommandEnvelope<'team.member.set', { teamId: string; userId: string; role: AccessRole }>
  | CommandEnvelope<'person.create', { teamId: string; name: string; email?: string; department?: string; title?: string; role?: AccessRole }>
  | CommandEnvelope<'person.update', { id: string; name?: string; email?: string | null; department?: string | null; title?: string | null }>
  | CommandEnvelope<'person.delete', { id: string }>
  | CommandEnvelope<'project.create', { teamId: string; key: string; name: string; description?: string; color?: string; parentId?: string }>
  | CommandEnvelope<'project.update', { id: string; key?: string; name?: string; description?: string; color?: string }>
  | CommandEnvelope<'project.delete', { id: string }>
  | CommandEnvelope<'project.member.set', { projectId: string; userId: string; role: AccessRole }>
  | CommandEnvelope<'workflow.create', { projectId: string; name: string; color?: string; category: 'backlog' | 'active' | 'done'; position?: number }>
  | CommandEnvelope<'workflow.update', { id: string; name?: string; color?: string; category?: 'backlog' | 'active' | 'done'; position?: number }>
  | CommandEnvelope<'workflow.delete', { id: string }>
  | CommandEnvelope<'field.create', { projectId: string; key: string; name: string; fieldType: FieldType; required?: boolean; options?: string[]; position?: number }>
  | CommandEnvelope<'field.update', { id: string; name?: string; required?: boolean; options?: string[]; position?: number }>
  | CommandEnvelope<'field.delete', { id: string }>
  | CommandEnvelope<'view.create', { projectId: string; name: string; viewType: SavedViewType; groupBy?: string; fields?: string[] }>
  | CommandEnvelope<'view.update', { id: string; name?: string; groupBy?: string | null; fields?: string[] }>
  | CommandEnvelope<'view.delete', { id: string }>
  | CommandEnvelope<'category.create', { name: string; color?: string }>
  | CommandEnvelope<'category.update', { id: string; name?: string; color?: string }>
  | CommandEnvelope<'category.delete', { id: string }>
  | CommandEnvelope<'task.create', { projectId: string; title: string; summary?: string; detail?: string; statusId?: string; categoryId?: string; assigneeId?: string; priority?: Priority; progress?: number; dueAt?: string; customData?: Record<string, JsonScalar>; meetingIds?: string[]; libraryItemIds?: string[] }>
  | CommandEnvelope<'task.update', { id: string; title?: string; summary?: string; detail?: string; statusId?: string; categoryId?: string | null; assigneeId?: string | null; priority?: Priority; progress?: number; dueAt?: string | null; customData?: Record<string, JsonScalar>; meetingIds?: string[]; libraryItemIds?: string[] }>
  | CommandEnvelope<'task.delete', { id: string }>
  | CommandEnvelope<'meeting.create', { teamId: string; projectIds: string[]; title: string; settings?: Partial<MeetingSettings> }>
  | CommandEnvelope<'meeting.update', { id: string; title?: string; status?: MeetingStatus; projectIds?: string[]; settings?: Partial<MeetingSettings> }>
  | CommandEnvelope<'meeting.delete', { id: string }>
  | CommandEnvelope<'meeting.transcript.append', { id: string; text: string; speakerId?: string; clientSegmentId?: string; startedAt?: string; endedAt?: string }>
  | CommandEnvelope<'meeting.action.append', { id: string; callId?: string; kind: MeetingAiActionView['kind']; summary: string; entityType?: string; entityId?: string; ok?: boolean }>
  | CommandEnvelope<'meeting.finalize', { id: string; summary: string; decisions?: string[]; risks?: string[]; actionItems?: FinalizeActionItem[]; documents?: FinalizeDocument[] }>
  | CommandEnvelope<'library.create', { teamId: string; projectIds: string[]; type: LibraryItemType; title: string; content?: string; url?: string; categoryId?: string; sourceMeetingId?: string }>
  | CommandEnvelope<'library.update', { id: string; projectIds?: string[]; title?: string; content?: string; url?: string | null; categoryId?: string | null }>
  | CommandEnvelope<'library.delete', { id: string }>
  | CommandEnvelope<'library.meeting.link', { libraryItemId: string; meetingId: string }>
  | CommandEnvelope<'event.create', { projectId?: string; type: CalendarEventType; title: string; startAt: string; endAt?: string; allDay?: boolean; ownerId?: string; attendeeIds?: string[]; taskId?: string; meetingId?: string }>
  | CommandEnvelope<'event.update', { id: string; projectId?: string | null; type?: CalendarEventType; title?: string; startAt?: string; endAt?: string | null; allDay?: boolean; ownerId?: string | null; attendeeIds?: string[]; taskId?: string | null; meetingId?: string | null }>
  | CommandEnvelope<'event.delete', { id: string }>

export interface CommandResult {
  cursor: number
  entityType: string
  entityId: string
  version: number
  replayed: boolean
  related?: Array<{ entityType: string; entityId: string }>
}

export interface ChangesRequest { cursor: number; waitMs?: number | undefined }
export interface ChangesResult { cursor: number; changed: boolean }
export interface UploadTicketRequest { meetingId: string; contentType: string; size: number; clientSegmentId: string; startedAt?: string | undefined; endedAt?: string | undefined }
export interface UploadTicketResult { uploadUrl: string; expiresAt: string; maxBytes: number }
export type TranscriptionState = 'pending' | 'processing' | 'completed' | 'failed'
export interface TranscriptionRequest { jobId: string }
export interface TranscriptionView { id: string; meetingId: string; clientSegmentId: string; state: TranscriptionState; text: string | null; utteranceSequence: number | null; error: string | null; createdAt: string; updatedAt: string }
export interface FlowboardErrorBody { error: { code: string; message: string; details?: Record<string, JsonScalar> } }

const id = z.string().min(1).max(160)
const text = z.string().max(1_000_000)
const shortText = z.string().trim().min(1).max(240)
const optionalShortText = z.string().trim().max(240).optional()
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const role = z.enum(['owner', 'admin', 'member', 'viewer'])
const priority = z.enum(['low', 'medium', 'high', 'urgent'])
const meetingStatus = z.enum(['scheduled', 'live', 'finalizing', 'ended', 'cancelled'])
const automation = z.enum(['record', 'suggest', 'execute'])
const feedback = z.enum(['silent', 'activity'])
const eventType = z.enum(['meeting', 'deadline', 'event', 'reminder'])
const itemType = z.enum(['doc', 'link'])
const viewType = z.enum(['board', 'table', 'calendar'])
const fieldType = z.enum(['text', 'number', 'boolean', 'date', 'select', 'multi_select', 'person'])
const statusCategory = z.enum(['backlog', 'active', 'done'])
const dateTime = z.string().min(1).max(64)
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const customData = z.record(z.string().min(1).max(120), scalar)
const settings = z.object({ automation, feedback, answerQuestions: z.boolean(), silenceSec: z.number().min(1).max(30) })
const partialSettings = settings.partial()
const idList = z.array(id).max(100)
const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) => z.object({ idempotencyKey: z.string().min(4).max(200), type: z.literal(type), payload, expectedVersion: z.number().int().positive().optional() })

export const snapshotRequestSchema: z.ZodType<SnapshotRequest> = z.object({ projectId: id.optional(), meetingId: id.optional(), compact: z.boolean().optional() })

export const commandRequestSchema: z.ZodType<CommandRequest> = z.discriminatedUnion('type', [
  envelope('team.create', z.object({ name: shortText, description: text.optional(), parentId: id.optional() })),
  envelope('team.update', z.object({ id, name: shortText.optional(), description: text.optional() })),
  envelope('team.delete', z.object({ id })),
  envelope('team.member.set', z.object({ teamId: id, userId: id, role })),
  envelope('person.create', z.object({ teamId: id, name: shortText, email: optionalShortText, department: optionalShortText, title: optionalShortText, role: role.optional() })),
  envelope('person.update', z.object({ id, name: shortText.optional(), email: shortText.nullable().optional(), department: shortText.nullable().optional(), title: shortText.nullable().optional() })),
  envelope('person.delete', z.object({ id })),
  envelope('project.create', z.object({ teamId: id, key: z.string().trim().min(2).max(12).regex(/^[A-Za-z][A-Za-z0-9]*$/), name: shortText, description: text.optional(), color: color.optional(), parentId: id.optional() })),
  envelope('project.update', z.object({ id, key: z.string().trim().min(2).max(12).regex(/^[A-Za-z][A-Za-z0-9]*$/).optional(), name: shortText.optional(), description: text.optional(), color: color.optional() })),
  envelope('project.delete', z.object({ id })), envelope('project.member.set', z.object({ projectId: id, userId: id, role })),
  envelope('workflow.create', z.object({ projectId: id, name: shortText, color: color.optional(), category: statusCategory, position: z.number().int().nonnegative().optional() })),
  envelope('workflow.update', z.object({ id, name: shortText.optional(), color: color.optional(), category: statusCategory.optional(), position: z.number().int().nonnegative().optional() })),
  envelope('workflow.delete', z.object({ id })),
  envelope('field.create', z.object({ projectId: id, key: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/), name: shortText, fieldType, required: z.boolean().optional(), options: z.array(shortText).max(100).optional(), position: z.number().int().nonnegative().optional() })),
  envelope('field.update', z.object({ id, name: shortText.optional(), required: z.boolean().optional(), options: z.array(shortText).max(100).optional(), position: z.number().int().nonnegative().optional() })), envelope('field.delete', z.object({ id })),
  envelope('view.create', z.object({ projectId: id, name: shortText, viewType, groupBy: shortText.optional(), fields: z.array(shortText).max(100).optional() })), envelope('view.update', z.object({ id, name: shortText.optional(), groupBy: shortText.nullable().optional(), fields: z.array(shortText).max(100).optional() })), envelope('view.delete', z.object({ id })),
  envelope('category.create', z.object({ name: shortText, color: color.optional() })), envelope('category.update', z.object({ id, name: shortText.optional(), color: color.optional() })), envelope('category.delete', z.object({ id })),
  envelope('task.create', z.object({ projectId: id, title: shortText, summary: text.optional(), detail: text.optional(), statusId: id.optional(), categoryId: id.optional(), assigneeId: id.optional(), priority: priority.optional(), progress: z.number().min(0).max(1).optional(), dueAt: dateTime.optional(), customData: customData.optional(), meetingIds: idList.optional(), libraryItemIds: idList.optional() })),
  envelope('task.update', z.object({ id, title: shortText.optional(), summary: text.optional(), detail: text.optional(), statusId: id.optional(), categoryId: id.nullable().optional(), assigneeId: id.nullable().optional(), priority: priority.optional(), progress: z.number().min(0).max(1).optional(), dueAt: dateTime.nullable().optional(), customData: customData.optional(), meetingIds: idList.optional(), libraryItemIds: idList.optional() })), envelope('task.delete', z.object({ id })),
  envelope('meeting.create', z.object({ teamId: id, projectIds: idList.min(1), title: shortText, settings: partialSettings.optional() })), envelope('meeting.update', z.object({ id, title: shortText.optional(), status: meetingStatus.optional(), projectIds: idList.min(1).optional(), settings: partialSettings.optional() })), envelope('meeting.delete', z.object({ id })),
  envelope('meeting.transcript.append', z.object({ id, text: z.string().trim().min(1).max(200_000), speakerId: id.optional(), clientSegmentId: id.optional(), startedAt: dateTime.optional(), endedAt: dateTime.optional() })),
  envelope('meeting.action.append', z.object({ id, callId: id.optional(), kind: z.enum(['task', 'document', 'decision', 'note', 'finalize']), summary: shortText, entityType: shortText.optional(), entityId: id.optional(), ok: z.boolean().optional() })),
  envelope('meeting.finalize', z.object({ id, summary: text, decisions: z.array(shortText).max(100).optional(), risks: z.array(shortText).max(100).optional(), actionItems: z.array(z.object({ key: id, projectId: id, title: shortText, summary: text.optional(), assigneeId: id.optional(), dueAt: dateTime.optional(), priority: priority.optional() })).max(100).optional(), documents: z.array(z.object({ key: id, title: shortText, content: text, projectIds: idList.min(1) })).max(100).optional() })),
  envelope('library.create', z.object({ teamId: id, projectIds: idList.min(1), type: itemType, title: shortText, content: text.optional(), url: text.optional(), categoryId: id.optional(), sourceMeetingId: id.optional() })), envelope('library.update', z.object({ id, projectIds: idList.min(1).optional(), title: shortText.optional(), content: text.optional(), url: text.nullable().optional(), categoryId: id.nullable().optional() })), envelope('library.delete', z.object({ id })), envelope('library.meeting.link', z.object({ libraryItemId: id, meetingId: id })),
  envelope('event.create', z.object({ projectId: id.optional(), type: eventType, title: shortText, startAt: dateTime, endAt: dateTime.optional(), allDay: z.boolean().optional(), ownerId: id.optional(), attendeeIds: idList.optional(), taskId: id.optional(), meetingId: id.optional() })), envelope('event.update', z.object({ id, projectId: id.nullable().optional(), type: eventType.optional(), title: shortText.optional(), startAt: dateTime.optional(), endAt: dateTime.nullable().optional(), allDay: z.boolean().optional(), ownerId: id.nullable().optional(), attendeeIds: idList.optional(), taskId: id.nullable().optional(), meetingId: id.nullable().optional() })), envelope('event.delete', z.object({ id })),
]) as z.ZodType<CommandRequest>

export const changesRequestSchema: z.ZodType<ChangesRequest> = z.object({ cursor: z.number().int().nonnegative(), waitMs: z.number().int().min(0).max(30_000).optional() })
export const uploadTicketRequestSchema: z.ZodType<UploadTicketRequest> = z.object({ meetingId: id, contentType: z.string().min(1).max(120), size: z.number().int().positive().max(MAX_UPLOAD_BYTES), clientSegmentId: id, startedAt: dateTime.optional(), endedAt: dateTime.optional() })
export const transcriptionRequestSchema: z.ZodType<TranscriptionRequest> = z.object({ jobId: id })
