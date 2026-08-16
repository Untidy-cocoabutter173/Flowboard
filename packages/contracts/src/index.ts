import { z } from 'zod'

export const API_VERSION = 1 as const
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

export type AccessRole = 'owner' | 'admin' | 'member' | 'viewer'
export type Priority = 'low' | 'medium' | 'high'
export type MeetingStatus = 'idle' | 'live' | 'ended'
export type MeetingMode = 'silent' | 'feedback'
export type LibraryItemType = 'doc' | 'link'
export type CalendarEventType = 'meeting' | 'deadline' | 'event' | 'reminder'
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
  role: AccessRole
  createdAt: string
}

export interface PersonView {
  id: string
  tenantId: string
  name: string
  email: string | null
  department: string | null
  title: string | null
  createdAt: string
}

export interface ProjectView {
  id: string
  tenantId: string
  teamId: string
  parentId: string | null
  name: string
  description: string
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

export interface BoardColumnView {
  id: string
  tenantId: string
  name: string
  position: number
  version: number
}

export interface CategoryView {
  id: string
  tenantId: string
  name: string
  color: string
  version: number
}

export interface TaskView {
  id: string
  tenantId: string
  projectId: string
  title: string
  summary: string
  detail: string
  columnId: string
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
  mode: MeetingMode
  answerQuestions: boolean
  silenceSec: number
}

export interface MeetingView {
  id: string
  tenantId: string
  projectId: string
  title: string
  status: MeetingStatus
  settings: MeetingSettings
  transcript: string
  summary: string
  startedAt: string | null
  endedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface LibraryItemView {
  id: string
  tenantId: string
  projectId: string
  type: LibraryItemType
  title: string
  content: string
  url: string | null
  categoryId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CalendarEventView {
  id: string
  tenantId: string
  projectId: string
  type: CalendarEventType
  title: string
  startAt: string
  endAt: string | null
  allDay: boolean
  ownerId: string | null
  attendeeIds: string[]
  taskId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface SnapshotRequest {
  projectId?: string | undefined
}

export interface FlowboardSnapshot {
  apiVersion: typeof API_VERSION
  cursor: number
  actor: ActorView
  teams: TeamView[]
  people: PersonView[]
  projects: ProjectView[]
  projectMembers: ProjectMemberView[]
  columns: BoardColumnView[]
  categories: CategoryView[]
  tasks: TaskView[]
  meetings: MeetingView[]
  library: LibraryItemView[]
  events: CalendarEventView[]
}

export interface CommandEnvelope<Type extends string, Payload> {
  idempotencyKey: string
  type: Type
  payload: Payload
  expectedVersion?: number
}

export type CommandRequest =
  | CommandEnvelope<'person.create', { name: string; email?: string; department?: string; title?: string; teamId: string; role?: AccessRole }>
  | CommandEnvelope<'project.create', { teamId: string; name: string; description?: string; parentId?: string }>
  | CommandEnvelope<'project.update', { id: string; name?: string; description?: string }>
  | CommandEnvelope<'project.delete', { id: string }>
  | CommandEnvelope<'project.member.set', { projectId: string; userId: string; role: AccessRole }>
  | CommandEnvelope<'column.create', { name: string }>
  | CommandEnvelope<'column.update', { id: string; name?: string; position?: number }>
  | CommandEnvelope<'column.delete', { id: string }>
  | CommandEnvelope<'category.create', { name: string; color?: string }>
  | CommandEnvelope<'category.update', { id: string; name?: string; color?: string }>
  | CommandEnvelope<'category.delete', { id: string }>
  | CommandEnvelope<'task.create', {
    projectId: string; title: string; summary?: string; detail?: string; columnId?: string; categoryId?: string
    assigneeId?: string; priority?: Priority; progress?: number; dueAt?: string; customData?: Record<string, JsonScalar>
  }>
  | CommandEnvelope<'task.update', {
    id: string; title?: string; summary?: string; detail?: string; columnId?: string; categoryId?: string | null
    assigneeId?: string | null; priority?: Priority; progress?: number; dueAt?: string | null
    customData?: Record<string, JsonScalar>
  }>
  | CommandEnvelope<'task.delete', { id: string }>
  | CommandEnvelope<'meeting.create', { projectId: string; title: string; settings?: Partial<MeetingSettings> }>
  | CommandEnvelope<'meeting.update', { id: string; title?: string; status?: MeetingStatus; settings?: Partial<MeetingSettings> }>
  | CommandEnvelope<'meeting.delete', { id: string }>
  | CommandEnvelope<'meeting.transcript.append', { id: string; text: string; speakerId?: string }>
  | CommandEnvelope<'meeting.summary.set', { id: string; content: string }>
  | CommandEnvelope<'library.create', {
    projectId: string; type: LibraryItemType; title: string; content?: string; url?: string; categoryId?: string
  }>
  | CommandEnvelope<'library.update', {
    id: string; title?: string; content?: string; url?: string | null; categoryId?: string | null
  }>
  | CommandEnvelope<'library.delete', { id: string }>
  | CommandEnvelope<'event.create', {
    projectId: string; type: CalendarEventType; title: string; startAt: string; endAt?: string; allDay?: boolean
    ownerId?: string; attendeeIds?: string[]; taskId?: string
  }>
  | CommandEnvelope<'event.update', {
    id: string; type?: CalendarEventType; title?: string; startAt?: string; endAt?: string | null; allDay?: boolean
    ownerId?: string | null; attendeeIds?: string[]; taskId?: string | null
  }>
  | CommandEnvelope<'event.delete', { id: string }>

export interface CommandResult {
  cursor: number
  entityType: string
  entityId: string
  version: number
  replayed: boolean
}

export interface ChangesRequest {
  cursor: number
  waitMs?: number | undefined
}

export interface ChangesResult {
  cursor: number
  changed: boolean
}

export interface UploadTicketRequest {
  meetingId: string
  contentType: string
  size: number
}

export interface UploadTicketResult {
  uploadUrl: string
  expiresAt: string
  maxBytes: number
}

export type TranscriptionState = 'pending' | 'processing' | 'completed' | 'failed'

export interface TranscriptionRequest {
  jobId: string
}

export interface TranscriptionView {
  id: string
  meetingId: string
  state: TranscriptionState
  text: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface FlowboardErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, JsonScalar>
  }
}

const id = z.string().min(1).max(160)
const text = z.string().max(1_000_000)
const shortText = z.string().trim().min(1).max(240)
const optionalShortText = z.string().trim().max(240).optional()
const role = z.enum(['owner', 'admin', 'member', 'viewer'])
const priority = z.enum(['low', 'medium', 'high'])
const meetingStatus = z.enum(['idle', 'live', 'ended'])
const meetingMode = z.enum(['silent', 'feedback'])
const eventType = z.enum(['meeting', 'deadline', 'event', 'reminder'])
const itemType = z.enum(['doc', 'link'])
const dateTime = z.string().min(1).max(64)
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const customData = z.record(z.string().min(1).max(120), scalar)
const settings = z.object({
  mode: meetingMode,
  answerQuestions: z.boolean(),
  silenceSec: z.number().min(0.5).max(30),
})
const partialSettings = settings.partial()

const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) => z.object({
  idempotencyKey: z.string().min(8).max(160),
  type: z.literal(type),
  payload,
  expectedVersion: z.number().int().positive().optional(),
})

export const snapshotRequestSchema: z.ZodType<SnapshotRequest> = z.object({ projectId: id.optional() })

export const commandRequestSchema: z.ZodType<CommandRequest> = z.discriminatedUnion('type', [
  envelope('person.create', z.object({ name: shortText, email: optionalShortText, department: optionalShortText, title: optionalShortText, teamId: id, role: role.optional() })),
  envelope('project.create', z.object({ teamId: id, name: shortText, description: text.optional(), parentId: id.optional() })),
  envelope('project.update', z.object({ id, name: shortText.optional(), description: text.optional() })),
  envelope('project.delete', z.object({ id })),
  envelope('project.member.set', z.object({ projectId: id, userId: id, role })),
  envelope('column.create', z.object({ name: shortText })),
  envelope('column.update', z.object({ id, name: shortText.optional(), position: z.number().int().nonnegative().optional() })),
  envelope('column.delete', z.object({ id })),
  envelope('category.create', z.object({ name: shortText, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })),
  envelope('category.update', z.object({ id, name: shortText.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })),
  envelope('category.delete', z.object({ id })),
  envelope('task.create', z.object({
    projectId: id, title: shortText, summary: text.optional(), detail: text.optional(), columnId: id.optional(),
    categoryId: id.optional(), assigneeId: id.optional(), priority: priority.optional(), progress: z.number().min(0).max(1).optional(),
    dueAt: dateTime.optional(), customData: customData.optional(),
  })),
  envelope('task.update', z.object({
    id, title: shortText.optional(), summary: text.optional(), detail: text.optional(), columnId: id.optional(),
    categoryId: id.nullable().optional(), assigneeId: id.nullable().optional(), priority: priority.optional(),
    progress: z.number().min(0).max(1).optional(), dueAt: dateTime.nullable().optional(), customData: customData.optional(),
  })),
  envelope('task.delete', z.object({ id })),
  envelope('meeting.create', z.object({ projectId: id, title: shortText, settings: partialSettings.optional() })),
  envelope('meeting.update', z.object({ id, title: shortText.optional(), status: meetingStatus.optional(), settings: partialSettings.optional() })),
  envelope('meeting.delete', z.object({ id })),
  envelope('meeting.transcript.append', z.object({ id, text: z.string().trim().min(1).max(200_000), speakerId: id.optional() })),
  envelope('meeting.summary.set', z.object({ id, content: text })),
  envelope('library.create', z.object({ projectId: id, type: itemType, title: shortText, content: text.optional(), url: text.optional(), categoryId: id.optional() })),
  envelope('library.update', z.object({ id, title: shortText.optional(), content: text.optional(), url: text.nullable().optional(), categoryId: id.nullable().optional() })),
  envelope('library.delete', z.object({ id })),
  envelope('event.create', z.object({
    projectId: id, type: eventType, title: shortText, startAt: dateTime, endAt: dateTime.optional(), allDay: z.boolean().optional(),
    ownerId: id.optional(), attendeeIds: z.array(id).max(200).optional(), taskId: id.optional(),
  })),
  envelope('event.update', z.object({
    id, type: eventType.optional(), title: shortText.optional(), startAt: dateTime.optional(), endAt: dateTime.nullable().optional(),
    allDay: z.boolean().optional(), ownerId: id.nullable().optional(), attendeeIds: z.array(id).max(200).optional(), taskId: id.nullable().optional(),
  })),
  envelope('event.delete', z.object({ id })),
]) as z.ZodType<CommandRequest>

export const changesRequestSchema: z.ZodType<ChangesRequest> = z.object({
  cursor: z.number().int().nonnegative(),
  waitMs: z.number().int().min(0).max(30_000).optional(),
})

export const uploadTicketRequestSchema: z.ZodType<UploadTicketRequest> = z.object({
  meetingId: id,
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

export const transcriptionRequestSchema: z.ZodType<TranscriptionRequest> = z.object({ jobId: id })
