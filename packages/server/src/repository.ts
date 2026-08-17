import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  API_VERSION,
  MAX_UPLOAD_BYTES,
  type AccessRole,
  type ActorView,
  type CalendarEventView,
  type CategoryView,
  type ChangesResult,
  type CommandRequest,
  type CommandResult,
  type FlowboardSnapshot,
  type FieldType,
  type JsonValue,
  type LibraryItemView,
  type MeetingAiActionView,
  type MeetingAgentBindingView,
  type MeetingIntentPayload,
  type MeetingIntentStatus,
  type MeetingIntentView,
  type MeetingSettings,
  type MeetingUtteranceView,
  type MeetingView,
  type PersonView,
  type ProjectMemberView,
  type ProjectView,
  type SavedViewView,
  type SnapshotRequest,
  type TaskFieldDefinitionView,
  type TaskView,
  type TeamMemberView,
  type TeamView,
  type TranscriptionView,
  type UploadTicketRequest,
  type UploadTicketResult,
  type WorkflowStatusView,
  type WorkspaceSummary,
} from '@flowboard/contracts'
import { conflict, FlowboardError, forbidden, notFound } from './errors.ts'
import { tokenHash } from './database.ts'

// node:sqlite exposes selected columns as unknown. These mappers are the
// runtime conversion point from database rows to the public contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const WRITE_ROLES: readonly AccessRole[] = ['owner', 'admin', 'member']
const ADMIN_ROLES: readonly AccessRole[] = ['owner', 'admin']
const DEFAULT_SETTINGS: MeetingSettings = { automation: 'execute', feedback: 'activity', answerQuestions: true, silenceSec: 3 }

const now = (): string => new Date().toISOString()
const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value)
const parseJson = <T>(value: unknown, fallback: T): T => typeof value === 'string' && value !== '' ? JSON.parse(value) as T : fallback
const asRow = (value: unknown): Row => {
  if (value === undefined) throw new Error('expected database row')
  return value as Row
}
const requestHash = (request: CommandRequest): string => createHash('sha256').update(JSON.stringify(request)).digest('hex')

interface ProjectAccess { project: Row; role: AccessRole }

export class SqliteFlowboardRepository {
  constructor(readonly db: DatabaseSync, readonly publicBaseUrl: string) {}

  authenticate(token: string): ActorView {
    const row = this.db.prepare(`
      SELECT u.id,u.tenant_id,u.name,u.email FROM api_tokens t
      JOIN users u ON u.id=t.user_id AND u.tenant_id=t.tenant_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND u.deleted_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at>?)
    `).get(tokenHash(token), now()) as Row | undefined
    if (row === undefined) throw new FlowboardError('UNAUTHORIZED', 'Invalid or expired access token', 401)
    return { id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), email: nullable(row.email) }
  }

  summary(actor: ActorView): WorkspaceSummary {
    const projectRows = this.accessibleProjects(actor)
    const projectIds = projectRows.map(row => String(row.id))
    const teamIds = [...new Set(projectRows.map(row => String(row.team_id)))]
    const meetingIds = this.resourceIds('project_meetings', 'meeting_id', projectIds)
    const libraryIds = this.resourceIds('project_library_items', 'library_item_id', projectIds)
    const teamRows = this.rowsByIds('teams', teamIds, 'deleted_at IS NULL')
    const liveMeetings = meetingIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM meetings WHERE id IN (${this.placeholders(meetingIds)}) AND status='live' AND deleted_at IS NULL ORDER BY started_at DESC`).all(...meetingIds) as Row[]
    const taskCount = projectIds.length === 0 ? 0 : Number((this.db.prepare(`SELECT COUNT(*) AS value FROM tasks WHERE project_id IN (${this.placeholders(projectIds)}) AND deleted_at IS NULL`).get(...projectIds) as Row).value)
    const peopleCount = teamIds.length === 0 ? 0 : Number((this.db.prepare(`SELECT COUNT(DISTINCT user_id) AS value FROM team_members WHERE team_id IN (${this.placeholders(teamIds)})`).get(...teamIds) as Row).value)
    return {
      apiVersion: API_VERSION,
      cursor: this.cursor(actor.tenantId),
      actor,
      teams: teamRows.map(row => this.mapTeam(row, this.teamRole(actor, String(row.id)))).map(({ id, name, role }) => ({ id, name, role })),
      projects: projectRows.map(this.mapProject).map(({ id, teamId, key, name, role }) => ({ id, teamId, key, name, role })),
      liveMeetings: liveMeetings.map(this.mapMeeting).map(({ id, teamId, title, status, startedAt }) => ({ id, teamId, title, status, startedAt })),
      counts: {
        projects: projectIds.length,
        tasks: taskCount,
        meetings: meetingIds.length,
        documents: libraryIds.length,
        people: peopleCount,
      },
    }
  }

  snapshot(actor: ActorView, request: SnapshotRequest): FlowboardSnapshot {
    let projectRows = this.accessibleProjects(actor, request.projectId)
    let projectIds = projectRows.map(row => String(row.id))
    if (request.meetingId !== undefined) {
      this.requireMeeting(actor, request.meetingId, false)
      const linked = this.db.prepare('SELECT project_id FROM project_meetings WHERE meeting_id=?').all(request.meetingId) as Row[]
      const linkedIds = new Set(linked.map(row => String(row.project_id)))
      projectRows = projectRows.filter(row => linkedIds.has(String(row.id)))
      projectIds = projectIds.filter(id => linkedIds.has(id))
    }
    const teamIds = [...new Set(projectRows.map(row => String(row.team_id)))]
    const meetingIds = this.resourceIds('project_meetings', 'meeting_id', projectIds)
    const libraryIds = this.resourceIds('project_library_items', 'library_item_id', projectIds)
    const filteredMeetingIds = request.meetingId === undefined ? meetingIds : meetingIds.filter(id => id === request.meetingId)
    const teams = this.rowsByIds('teams', teamIds, 'deleted_at IS NULL')
    const people = teamIds.length === 0 ? [] : this.db.prepare(`
      SELECT DISTINCT u.* FROM users u JOIN team_members tm ON tm.user_id=u.id
      WHERE tm.team_id IN (${this.placeholders(teamIds)}) AND u.deleted_at IS NULL ORDER BY u.name
    `).all(...teamIds) as Row[]
    const teamMembers = teamIds.length === 0 ? [] : this.db.prepare(`SELECT team_id,user_id,role FROM team_members WHERE team_id IN (${this.placeholders(teamIds)})`).all(...teamIds) as Row[]
    const projectMembers = projectIds.length === 0 ? [] : this.db.prepare(`SELECT project_id,user_id,role FROM project_members WHERE project_id IN (${this.placeholders(projectIds)})`).all(...projectIds) as Row[]
    const statuses = this.rowsForProjects('workflow_statuses', projectIds, 'position,name')
    const fields = this.rowsForProjects('task_field_definitions', projectIds, 'position,name')
    const views = this.rowsForProjects('saved_views', projectIds, 'name')
    const tasks = this.rowsForProjects('tasks', projectIds, 'updated_at DESC')
    const meetings = filteredMeetingIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM meetings WHERE id IN (${this.placeholders(filteredMeetingIds)}) AND deleted_at IS NULL ORDER BY updated_at DESC`).all(...filteredMeetingIds) as Row[]
    const library = libraryIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM library_items WHERE id IN (${this.placeholders(libraryIds)}) AND deleted_at IS NULL ORDER BY updated_at DESC`).all(...libraryIds) as Row[]
    const events = projectIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM calendar_events WHERE deleted_at IS NULL AND (project_id IN (${this.placeholders(projectIds)}) OR owner_id=?) ORDER BY start_at,title`).all(...projectIds, actor.id) as Row[]
    const utterances = request.meetingId === undefined ? [] : this.db.prepare('SELECT * FROM meeting_utterances WHERE meeting_id=? ORDER BY sequence').all(request.meetingId) as Row[]
    const actionMeetingIds = request.meetingId === undefined ? meetings.filter(row => row.status === 'live' || row.status === 'finalizing').map(row => String(row.id)) : filteredMeetingIds
    const aiActions = actionMeetingIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM meeting_ai_actions WHERE meeting_id IN (${this.placeholders(actionMeetingIds)}) ORDER BY created_at`).all(...actionMeetingIds) as Row[]
    const meetingAgentBindings = filteredMeetingIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM meeting_agent_bindings WHERE meeting_id IN (${this.placeholders(filteredMeetingIds)}) ORDER BY updated_at`).all(...filteredMeetingIds) as Row[]
    const meetingIntents = filteredMeetingIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM meeting_intents WHERE meeting_id IN (${this.placeholders(filteredMeetingIds)}) ORDER BY updated_at,id`).all(...filteredMeetingIds) as Row[]
    const categories = this.db.prepare('SELECT * FROM categories WHERE tenant_id=? AND deleted_at IS NULL ORDER BY name').all(actor.tenantId) as Row[]

    return {
      apiVersion: API_VERSION,
      cursor: this.cursor(actor.tenantId),
      actor,
      teams: teams.map(row => this.mapTeam(row, this.teamRole(actor, String(row.id)))),
      teamMembers: teamMembers.map(this.mapTeamMember),
      people: people.map(this.mapPerson),
      projects: projectRows.map(this.mapProject),
      projectMembers: projectMembers.map(this.mapProjectMember),
      workflowStatuses: statuses.map(this.mapWorkflow),
      fieldDefinitions: fields.map(this.mapField),
      savedViews: views.map(this.mapView),
      categories: categories.map(this.mapCategory),
      tasks: tasks.map(this.mapTask),
      meetings: meetings.map(this.mapMeeting),
      utterances: utterances.map(this.mapUtterance),
      aiActions: aiActions.map(this.mapAiAction),
      meetingAgentBindings: meetingAgentBindings.map(this.mapMeetingAgentBinding),
      meetingIntents: meetingIntents.map(this.mapMeetingIntent),
      library: library.map(this.mapLibrary),
      events: events.map(this.mapEvent),
      links: {
        projectMeetings: this.linkRows('project_meetings', projectIds).map(row => ({ projectId: String(row.project_id), meetingId: String(row.meeting_id) })),
        projectLibrary: this.linkRows('project_library_items', projectIds).map(row => ({ projectId: String(row.project_id), libraryItemId: String(row.library_item_id) })),
        meetingLibrary: meetingIds.length === 0 ? [] : (this.db.prepare(`SELECT meeting_id,library_item_id FROM meeting_library_items WHERE meeting_id IN (${this.placeholders(meetingIds)})`).all(...meetingIds) as Row[]).map(row => ({ meetingId: String(row.meeting_id), libraryItemId: String(row.library_item_id) })),
        taskMeetings: this.taskLinkRows('task_meetings', projectIds).map(row => ({ taskId: String(row.task_id), meetingId: String(row.meeting_id) })),
        taskLibrary: this.taskLinkRows('task_library_items', projectIds).map(row => ({ taskId: String(row.task_id), libraryItemId: String(row.library_item_id) })),
      },
    }
  }

  execute(actor: ActorView, request: CommandRequest): CommandResult {
    const hash = requestHash(request)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db.prepare('SELECT request_hash,response_json FROM idempotency_keys WHERE tenant_id=? AND key=?').get(actor.tenantId, request.idempotencyKey) as Row | undefined
      if (previous !== undefined) {
        if (String(previous.request_hash) !== hash) throw conflict('Idempotency key was already used for another command', { key: request.idempotencyKey })
        const result = parseJson<CommandResult>(previous.response_json, { cursor: this.cursor(actor.tenantId), entityType: 'unknown', entityId: 'unknown', version: 0, replayed: true })
        this.db.exec('COMMIT')
        return { ...result, replayed: true }
      }
      const result = this.dispatch(actor, request)
      this.db.prepare('INSERT INTO idempotency_keys(tenant_id,key,request_hash,response_json,created_at) VALUES(?,?,?,?,?)')
        .run(actor.tenantId, request.idempotencyKey, hash, JSON.stringify(result), now())
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  changes(actor: ActorView, cursor: number): ChangesResult {
    const current = this.cursor(actor.tenantId)
    return { cursor: current, changed: current > cursor }
  }

  createUploadTicket(actor: ActorView, request: UploadTicketRequest): UploadTicketResult {
    const meeting = this.requireMeeting(actor, request.meetingId, true).meeting
    if (meeting.status !== 'live' && meeting.status !== 'finalizing') throw conflict('Meeting is not accepting audio', { status: String(meeting.status) })
    if (request.size > MAX_UPLOAD_BYTES) throw new FlowboardError('UPLOAD_TOO_LARGE', 'Audio segment exceeds 16 MiB', 413)
    const existing = this.db.prepare('SELECT id FROM transcription_jobs WHERE meeting_id=? AND client_segment_id=?').get(request.meetingId, request.clientSegmentId)
    if (existing !== undefined) throw conflict('Audio segment was already uploaded', { clientSegmentId: request.clientSegmentId })
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    const contentType = request.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!contentType.startsWith('audio/')) throw new FlowboardError('INVALID_UPLOAD', 'An audio content type is required', 400)
    this.db.prepare(`INSERT INTO upload_tickets(token_hash,tenant_id,user_id,meeting_id,client_segment_id,content_type,expected_size,started_at,ended_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tokenHash(token), actor.tenantId, actor.id, request.meetingId, request.clientSegmentId, contentType, request.size, request.startedAt ?? null, request.endedAt ?? null, expiresAt, now())
    return { uploadUrl: `${this.publicBaseUrl.replace(/\/$/, '')}/v1/uploads/${encodeURIComponent(token)}`, expiresAt, maxBytes: MAX_UPLOAD_BYTES }
  }

  consumeUploadTicket(token: string, actualSize: number, audioPath: string, contentType: string): string {
    const hash = tokenHash(token)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const ticket = this.db.prepare('SELECT * FROM upload_tickets WHERE token_hash=?').get(hash) as Row | undefined
      if (ticket === undefined || ticket.used_at !== null || String(ticket.expires_at) <= now()) throw new FlowboardError('UPLOAD_TICKET_INVALID', 'Upload ticket is invalid, expired, or already used', 401)
      if (actualSize !== Number(ticket.expected_size) || actualSize > MAX_UPLOAD_BYTES) throw new FlowboardError('UPLOAD_SIZE_MISMATCH', 'Uploaded audio size does not match the ticket', 400)
      if (contentType !== String(ticket.content_type)) throw new FlowboardError('UPLOAD_CONTENT_TYPE_MISMATCH', 'Uploaded audio content type does not match the ticket', 400)
      const id = randomUUID()
      const stamp = now()
      this.db.prepare('UPDATE upload_tickets SET used_at=? WHERE token_hash=?').run(stamp, hash)
      this.db.prepare(`INSERT INTO transcription_jobs(id,tenant_id,user_id,meeting_id,client_segment_id,audio_path,started_at,ended_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'pending',?,?)`)
        .run(id, ticket.tenant_id, ticket.user_id, ticket.meeting_id, ticket.client_segment_id, audioPath, ticket.started_at, ticket.ended_at, stamp, stamp)
      this.db.exec('COMMIT')
      return id
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  transcription(actor: ActorView, jobId: string): TranscriptionView {
    const row = this.db.prepare('SELECT * FROM transcription_jobs WHERE id=? AND tenant_id=?').get(jobId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('transcription job', jobId)
    this.requireMeeting(actor, String(row.meeting_id), false)
    return this.mapTranscription(row)
  }

  claimTranscription(): (TranscriptionView & { audioPath: string; userId: string; tenantId: string }) | undefined {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare(`SELECT * FROM transcription_jobs WHERE state='pending' ORDER BY created_at LIMIT 1`).get() as Row | undefined
      if (row === undefined) { this.db.exec('COMMIT'); return undefined }
      const stamp = now()
      this.db.prepare(`UPDATE transcription_jobs SET state='processing',updated_at=? WHERE id=? AND state='pending'`).run(stamp, row.id)
      this.db.exec('COMMIT')
      return { ...this.mapTranscription({ ...row, state: 'processing', updated_at: stamp }), audioPath: String(row.audio_path), userId: String(row.user_id), tenantId: String(row.tenant_id) }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  finishTranscription(jobId: string, text: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const job = this.db.prepare('SELECT * FROM transcription_jobs WHERE id=?').get(jobId) as Row | undefined
      if (job === undefined) throw notFound('transcription job', jobId)
      if (job.state === 'completed') { this.db.exec('COMMIT'); return }
      if (job.state !== 'processing') throw conflict('Transcription job is not processing', { state: String(job.state) })
      const meeting = asRow(this.db.prepare('SELECT * FROM meetings WHERE id=? AND deleted_at IS NULL').get(job.meeting_id))
      const stamp = now()
      let sequence: number | null = null
      const clean = text.trim()
      if (clean !== '') {
        sequence = Number((this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS value FROM meeting_utterances WHERE meeting_id=?').get(job.meeting_id) as Row).value)
        const utteranceId = randomUUID()
        this.db.prepare(`INSERT INTO meeting_utterances(id,meeting_id,sequence,client_segment_id,speaker_id,text,started_at,ended_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(utteranceId, job.meeting_id, sequence, job.client_segment_id, null, clean, job.started_at, job.ended_at, stamp)
        const version = Number(meeting.version) + 1
        const transcript = `${String(meeting.transcript)}${String(meeting.transcript) === '' ? '' : '\n'}${clean}`
        this.db.prepare('UPDATE meetings SET transcript=?,version=?,updated_at=? WHERE id=?').run(transcript, version, stamp, job.meeting_id)
        this.record({ id: String(job.user_id), tenantId: String(job.tenant_id), name: 'Transcription Worker', email: null }, 'meeting', String(job.meeting_id), 'meeting.transcript.append', version, this.entity('meetings', String(job.meeting_id)))
      }
      this.db.prepare(`UPDATE transcription_jobs SET state='completed',text=?,utterance_sequence=?,updated_at=? WHERE id=?`).run(clean, sequence, stamp, jobId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  failTranscription(jobId: string, message: string): void {
    this.db.prepare(`UPDATE transcription_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND state='processing'`).run(message.slice(0, 2_000), now(), jobId)
  }

  private dispatch(actor: ActorView, request: CommandRequest): CommandResult {
    switch (request.type) {
      case 'team.create': return this.createTeam(actor, request)
      case 'team.update': return this.updateTeam(actor, request)
      case 'team.delete': return this.deleteTeam(actor, request)
      case 'team.member.set': return this.setTeamMember(actor, request)
      case 'team.member.remove': return this.removeTeamMember(actor, request)
      case 'person.create': return this.createPerson(actor, request)
      case 'person.update': return this.updatePerson(actor, request)
      case 'person.delete': return this.deletePerson(actor, request)
      case 'project.create': return this.createProject(actor, request)
      case 'project.update': return this.updateProject(actor, request)
      case 'project.delete': return this.deleteProject(actor, request)
      case 'project.member.set': return this.setProjectMember(actor, request)
      case 'project.member.remove': return this.removeProjectMember(actor, request)
      case 'workflow.create': return this.createWorkflow(actor, request)
      case 'workflow.update': return this.updateWorkflow(actor, request)
      case 'workflow.delete': return this.deleteWorkflow(actor, request)
      case 'field.create': return this.createField(actor, request)
      case 'field.update': return this.updateField(actor, request)
      case 'field.delete': return this.deleteField(actor, request)
      case 'view.create': return this.createView(actor, request)
      case 'view.update': return this.updateView(actor, request)
      case 'view.delete': return this.deleteSimpleProjectEntity(actor, request, 'saved_views', 'view')
      case 'category.create': return this.createCategory(actor, request)
      case 'category.update': return this.updateCategory(actor, request)
      case 'category.delete': return this.deleteCategory(actor, request)
      case 'task.create': return this.createTask(actor, request)
      case 'task.update': return this.updateTask(actor, request)
      case 'task.delete': return this.deleteTask(actor, request)
      case 'meeting.create': return this.createMeeting(actor, request)
      case 'meeting.update': return this.updateMeeting(actor, request)
      case 'meeting.delete': return this.deleteMeeting(actor, request)
      case 'meeting.transcript.append': return this.appendTranscript(actor, request)
      case 'meeting.action.append': return this.appendMeetingAction(actor, request)
      case 'meeting.agent.bind': return this.bindMeetingAgent(actor, request)
      case 'meeting.agent.progress': return this.updateMeetingAgentProgress(actor, request)
      case 'meeting.intent.upsert': return this.upsertMeetingIntent(actor, request)
      case 'meeting.intent.record': return this.recordMeetingIntent(actor, request)
      case 'meeting.intent.status': return this.updateMeetingIntentStatus(actor, request)
      case 'meeting.intent.commit': return this.commitMeetingIntent(actor, request)
      case 'meeting.finalize': return this.finalizeMeeting(actor, request)
      case 'library.create': return this.createLibrary(actor, request)
      case 'library.update': return this.updateLibrary(actor, request)
      case 'library.delete': return this.deleteLibrary(actor, request)
      case 'library.meeting.link': return this.linkLibraryMeeting(actor, request)
      case 'event.create': return this.createEvent(actor, request)
      case 'event.update': return this.updateEvent(actor, request)
      case 'event.delete': return this.deleteEvent(actor, request)
    }
  }

  private createTeam(actor: ActorView, request: Extract<CommandRequest, { type: 'team.create' }>): CommandResult {
    if (request.payload.parentId !== undefined) this.requireTeam(actor, request.payload.parentId, true, true)
    else if (this.db.prepare('SELECT 1 FROM team_members WHERE user_id=? AND role IN (\'owner\',\'admin\')').get(actor.id) === undefined) throw forbidden('Only a team administrator can create teams')
    const id = randomUUID(); const stamp = now()
    this.db.prepare('INSERT INTO teams(id,tenant_id,parent_id,name,description,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id, actor.tenantId, request.payload.parentId ?? null, request.payload.name, request.payload.description ?? '', stamp, stamp)
    this.db.prepare('INSERT INTO team_members(team_id,user_id,role,created_at) VALUES(?,?,\'owner\',?)').run(id, actor.id, stamp)
    return this.record(actor, 'team', id, request.type, 1, this.entity('teams', id))
  }

  private updateTeam(actor: ActorView, request: Extract<CommandRequest, { type: 'team.update' }>): CommandResult {
    const row = this.requireTeam(actor, request.payload.id, true, true); const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE teams SET name=?,description=?,version=?,updated_at=? WHERE id=?').run(request.payload.name ?? row.name, request.payload.description ?? row.description, version + 1, stamp, row.id)
    return this.record(actor, 'team', String(row.id), request.type, version + 1, this.entity('teams', String(row.id)))
  }

  private deleteTeam(actor: ActorView, request: Extract<CommandRequest, { type: 'team.delete' }>): CommandResult {
    const row = this.requireTeam(actor, request.payload.id, true, true); const version = this.expect(row, request.expectedVersion)
    if (this.db.prepare('SELECT 1 FROM projects WHERE team_id=? AND deleted_at IS NULL LIMIT 1').get(row.id) !== undefined) throw conflict('Team still owns projects')
    const stamp = now(); this.db.prepare('UPDATE teams SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'team', String(row.id), request.type, version + 1, this.entity('teams', String(row.id)))
  }

  private setTeamMember(actor: ActorView, request: Extract<CommandRequest, { type: 'team.member.set' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, true); this.requireUser(actor, request.payload.userId)
    const current = this.db.prepare('SELECT role FROM team_members WHERE team_id=? AND user_id=?').get(request.payload.teamId, request.payload.userId) as Row | undefined
    if (current?.role === 'owner' && request.payload.role !== 'owner' && this.teamOwnerCount(request.payload.teamId) <= 1) throw conflict('A team must keep at least one owner')
    this.db.prepare(`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role`).run(request.payload.teamId, request.payload.userId, request.payload.role, now())
    return this.record(actor, 'team_member', `${request.payload.teamId}:${request.payload.userId}`, request.type, 1, request.payload)
  }

  private removeTeamMember(actor: ActorView, request: Extract<CommandRequest, { type: 'team.member.remove' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, true)
    const member = this.db.prepare('SELECT role FROM team_members WHERE team_id=? AND user_id=?').get(request.payload.teamId, request.payload.userId) as Row | undefined
    if (member === undefined) throw notFound('team member', request.payload.userId)
    if (member.role === 'owner' && this.teamOwnerCount(request.payload.teamId) <= 1) throw conflict('A team must keep at least one owner')
    this.db.prepare('DELETE FROM project_members WHERE user_id=? AND project_id IN (SELECT id FROM projects WHERE team_id=?)').run(request.payload.userId, request.payload.teamId)
    this.db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(request.payload.teamId, request.payload.userId)
    return this.record(actor, 'team_member', `${request.payload.teamId}:${request.payload.userId}`, request.type, 1, request.payload)
  }

  private createPerson(actor: ActorView, request: Extract<CommandRequest, { type: 'person.create' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, true); const id = randomUUID(); const stamp = now()
    this.db.prepare('INSERT INTO users(id,tenant_id,name,email,department,title,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run(id, actor.tenantId, request.payload.name, request.payload.email ?? null, request.payload.department ?? null, request.payload.title ?? null, stamp, stamp)
    this.db.prepare('INSERT INTO team_members(team_id,user_id,role,created_at) VALUES(?,?,?,?)').run(request.payload.teamId, id, request.payload.role ?? 'member', stamp)
    return this.record(actor, 'person', id, request.type, 1, this.entity('users', id))
  }

  private updatePerson(actor: ActorView, request: Extract<CommandRequest, { type: 'person.update' }>): CommandResult {
    const row = this.requireUser(actor, request.payload.id, true); const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE users SET name=?,email=?,department=?,title=?,version=?,updated_at=? WHERE id=?').run(request.payload.name ?? row.name, request.payload.email === undefined ? row.email : request.payload.email, request.payload.department === undefined ? row.department : request.payload.department, request.payload.title === undefined ? row.title : request.payload.title, version + 1, stamp, row.id)
    return this.record(actor, 'person', String(row.id), request.type, version + 1, this.entity('users', String(row.id)))
  }

  private deletePerson(actor: ActorView, request: Extract<CommandRequest, { type: 'person.delete' }>): CommandResult {
    const row = this.requireUser(actor, request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    if (row.id === actor.id) throw conflict('You cannot delete your own account')
    const stamp = now(); this.db.prepare('UPDATE users SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'person', String(row.id), request.type, version + 1, this.entity('users', String(row.id)))
  }

  private createProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.create' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, true)
    if (request.payload.parentId !== undefined) {
      const parent = this.requireProject(actor, request.payload.parentId, true).project
      if (String(parent.team_id) !== request.payload.teamId) throw conflict('Parent project belongs to another team')
    }
    const id = randomUUID(); const stamp = now(); const key = request.payload.key.toUpperCase()
    this.db.prepare(`INSERT INTO projects(id,tenant_id,team_id,parent_id,project_key,name,description,color,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`).run(id, actor.tenantId, request.payload.teamId, request.payload.parentId ?? null, key, request.payload.name, request.payload.description ?? '', request.payload.color ?? '#4D6BFE', stamp, stamp)
    this.db.prepare('INSERT INTO project_members(project_id,user_id,role,created_at) VALUES(?,?,\'owner\',?)').run(id, actor.id, stamp)
    this.seedProject(actor.tenantId, id)
    return this.record(actor, 'project', id, request.type, 1, this.entity('projects', id))
  }

  private updateProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.update' }>): CommandResult {
    const row = this.requireProject(actor, request.payload.id, true).project; const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE projects SET project_key=?,name=?,description=?,color=?,version=?,updated_at=? WHERE id=?').run((request.payload.key ?? row.project_key).toUpperCase(), request.payload.name ?? row.name, request.payload.description ?? row.description, request.payload.color ?? row.color, version + 1, stamp, row.id)
    return this.record(actor, 'project', String(row.id), request.type, version + 1, this.entity('projects', String(row.id)))
  }

  private deleteProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.delete' }>): CommandResult {
    const row = this.requireProject(actor, request.payload.id, true).project; const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE projects SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    this.db.prepare('UPDATE tasks SET deleted_at=?,updated_at=? WHERE project_id=? AND deleted_at IS NULL').run(stamp, stamp, row.id)
    return this.record(actor, 'project', String(row.id), request.type, version + 1, this.entity('projects', String(row.id)))
  }

  private setProjectMember(actor: ActorView, request: Extract<CommandRequest, { type: 'project.member.set' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.projectId, true)
    if (!ADMIN_ROLES.includes(access.role)) throw forbidden('Only a project administrator can manage members')
    const project = access.project; this.requireUserInTeam(actor, request.payload.userId, String(project.team_id))
    const current = this.db.prepare('SELECT role FROM project_members WHERE project_id=? AND user_id=?').get(request.payload.projectId, request.payload.userId) as Row | undefined
    if (current?.role === 'owner' && request.payload.role !== 'owner' && this.projectOwnerCount(request.payload.projectId) <= 1) throw conflict('A project must keep at least one owner')
    this.db.prepare(`INSERT INTO project_members(project_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role`).run(request.payload.projectId, request.payload.userId, request.payload.role, now())
    return this.record(actor, 'project_member', `${request.payload.projectId}:${request.payload.userId}`, request.type, 1, request.payload)
  }

  private removeProjectMember(actor: ActorView, request: Extract<CommandRequest, { type: 'project.member.remove' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.projectId, true)
    if (!ADMIN_ROLES.includes(access.role)) throw forbidden('Only a project administrator can manage members')
    const member = this.db.prepare('SELECT role FROM project_members WHERE project_id=? AND user_id=?').get(request.payload.projectId, request.payload.userId) as Row | undefined
    if (member === undefined) throw notFound('project member', request.payload.userId)
    if (member.role === 'owner' && this.projectOwnerCount(request.payload.projectId) <= 1) throw conflict('A project must keep at least one owner')
    this.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(request.payload.projectId, request.payload.userId)
    return this.record(actor, 'project_member', `${request.payload.projectId}:${request.payload.userId}`, request.type, 1, request.payload)
  }

  private createWorkflow(actor: ActorView, request: Extract<CommandRequest, { type: 'workflow.create' }>): CommandResult {
    const project = this.requireProject(actor, request.payload.projectId, true).project; const id = randomUUID()
    const position = request.payload.position ?? Number((this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS value FROM workflow_statuses WHERE project_id=? AND deleted_at IS NULL').get(project.id) as Row).value)
    this.db.prepare('INSERT INTO workflow_statuses(id,tenant_id,project_id,name,color,position,category,version) VALUES(?,?,?,?,?,?,?,1)').run(id, actor.tenantId, project.id, request.payload.name, request.payload.color ?? '#8A8D93', position, request.payload.category)
    return this.record(actor, 'workflow', id, request.type, 1, this.entity('workflow_statuses', id))
  }

  private updateWorkflow(actor: ActorView, request: Extract<CommandRequest, { type: 'workflow.update' }>): CommandResult {
    const row = this.projectEntity(actor, 'workflow_statuses', request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    this.db.prepare('UPDATE workflow_statuses SET name=?,color=?,position=?,category=?,version=? WHERE id=?').run(request.payload.name ?? row.name, request.payload.color ?? row.color, request.payload.position ?? row.position, request.payload.category ?? row.category, version + 1, row.id)
    return this.record(actor, 'workflow', String(row.id), request.type, version + 1, this.entity('workflow_statuses', String(row.id)))
  }

  private deleteWorkflow(actor: ActorView, request: Extract<CommandRequest, { type: 'workflow.delete' }>): CommandResult {
    const row = this.projectEntity(actor, 'workflow_statuses', request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    if (this.db.prepare('SELECT 1 FROM tasks WHERE status_id=? AND deleted_at IS NULL LIMIT 1').get(row.id) !== undefined) throw conflict('Workflow status is still used by tasks')
    this.db.prepare('UPDATE workflow_statuses SET deleted_at=?,version=? WHERE id=?').run(now(), version + 1, row.id)
    return this.record(actor, 'workflow', String(row.id), request.type, version + 1, this.entity('workflow_statuses', String(row.id)))
  }

  private createField(actor: ActorView, request: Extract<CommandRequest, { type: 'field.create' }>): CommandResult {
    const project = this.requireProject(actor, request.payload.projectId, true).project; const id = randomUUID()
    const position = request.payload.position ?? Number((this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS value FROM task_field_definitions WHERE project_id=? AND deleted_at IS NULL').get(project.id) as Row).value)
    this.db.prepare('INSERT INTO task_field_definitions(id,tenant_id,project_id,field_key,name,field_type,required,options_json,position,version) VALUES(?,?,?,?,?,?,?,?,?,1)').run(id, actor.tenantId, project.id, request.payload.key, request.payload.name, request.payload.fieldType, request.payload.required === true ? 1 : 0, JSON.stringify(request.payload.options ?? []), position)
    return this.record(actor, 'field', id, request.type, 1, this.entity('task_field_definitions', id))
  }

  private updateField(actor: ActorView, request: Extract<CommandRequest, { type: 'field.update' }>): CommandResult {
    const row = this.projectEntity(actor, 'task_field_definitions', request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    const nextType = request.payload.fieldType ?? row.field_type as FieldType
    const nextOptions = request.payload.options === undefined ? row.options_json : JSON.stringify(request.payload.options)
    this.db.prepare('UPDATE task_field_definitions SET name=?,field_type=?,required=?,options_json=?,position=?,version=? WHERE id=?').run(request.payload.name ?? row.name, nextType, request.payload.required === undefined ? row.required : request.payload.required ? 1 : 0, nextOptions, request.payload.position ?? row.position, version + 1, row.id)
    if (nextType !== row.field_type) this.clearCustomField(actor, String(row.project_id), String(row.field_key))
    return this.record(actor, 'field', String(row.id), request.type, version + 1, this.entity('task_field_definitions', String(row.id)))
  }

  private deleteField(actor: ActorView, request: Extract<CommandRequest, { type: 'field.delete' }>): CommandResult {
    const row = this.projectEntity(actor, 'task_field_definitions', request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    this.db.prepare('UPDATE task_field_definitions SET deleted_at=?,version=? WHERE id=?').run(now(), version + 1, row.id)
    this.clearCustomField(actor, String(row.project_id), String(row.field_key))
    return this.record(actor, 'field', String(row.id), request.type, version + 1, this.entity('task_field_definitions', String(row.id)))
  }

  private createView(actor: ActorView, request: Extract<CommandRequest, { type: 'view.create' }>): CommandResult {
    const project = this.requireProject(actor, request.payload.projectId, true).project; const id = randomUUID()
    this.db.prepare(`INSERT INTO saved_views(id,tenant_id,project_id,name,view_type,filters_json,sorts_json,group_by,fields_json,version) VALUES(?,?,?,?,?,'{}','[]',?,?,1)`).run(id, actor.tenantId, project.id, request.payload.name, request.payload.viewType, request.payload.groupBy ?? null, JSON.stringify(request.payload.fields ?? []))
    return this.record(actor, 'view', id, request.type, 1, this.entity('saved_views', id))
  }

  private updateView(actor: ActorView, request: Extract<CommandRequest, { type: 'view.update' }>): CommandResult {
    const row = this.projectEntity(actor, 'saved_views', request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    this.db.prepare('UPDATE saved_views SET name=?,group_by=?,fields_json=?,version=? WHERE id=?').run(request.payload.name ?? row.name, request.payload.groupBy === undefined ? row.group_by : request.payload.groupBy, request.payload.fields === undefined ? row.fields_json : JSON.stringify(request.payload.fields), version + 1, row.id)
    return this.record(actor, 'view', String(row.id), request.type, version + 1, this.entity('saved_views', String(row.id)))
  }

  private deleteSimpleProjectEntity(actor: ActorView, request: Extract<CommandRequest, { type: 'field.delete' | 'view.delete' }>, table: 'task_field_definitions' | 'saved_views', entityType: string): CommandResult {
    const row = this.projectEntity(actor, table, request.payload.id, true); const version = this.expect(row, request.expectedVersion)
    this.db.prepare(`UPDATE ${table} SET deleted_at=?,version=? WHERE id=?`).run(now(), version + 1, row.id)
    return this.record(actor, entityType, String(row.id), request.type, version + 1, this.entity(table, String(row.id)))
  }

  private createCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.create' }>): CommandResult {
    const id = randomUUID(); this.db.prepare('INSERT INTO categories(id,tenant_id,name,color,version) VALUES(?,?,?,?,1)').run(id, actor.tenantId, request.payload.name, request.payload.color ?? '#4D6BFE')
    return this.record(actor, 'category', id, request.type, 1, this.entity('categories', id))
  }

  private updateCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.update' }>): CommandResult {
    const row = this.tenantEntity(actor, 'categories', request.payload.id); const version = this.expect(row, request.expectedVersion)
    this.db.prepare('UPDATE categories SET name=?,color=?,version=? WHERE id=?').run(request.payload.name ?? row.name, request.payload.color ?? row.color, version + 1, row.id)
    return this.record(actor, 'category', String(row.id), request.type, version + 1, this.entity('categories', String(row.id)))
  }

  private deleteCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.delete' }>): CommandResult {
    const row = this.tenantEntity(actor, 'categories', request.payload.id); const version = this.expect(row, request.expectedVersion)
    this.db.prepare('UPDATE categories SET deleted_at=?,version=? WHERE id=?').run(now(), version + 1, row.id)
    return this.record(actor, 'category', String(row.id), request.type, version + 1, this.entity('categories', String(row.id)))
  }

  private createTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.create' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.projectId, true); const project = access.project
    const status = request.payload.statusId ?? String((this.db.prepare(`SELECT id FROM workflow_statuses WHERE project_id=? AND deleted_at IS NULL ORDER BY position LIMIT 1`).get(project.id) as Row | undefined)?.id ?? '')
    this.requireStatus(project.id, status); if (request.payload.assigneeId !== undefined) this.requireProjectMember(actor, request.payload.assigneeId, String(project.id))
    if (request.payload.categoryId !== undefined) this.requireCategory(actor, request.payload.categoryId)
    this.validateCustomData(actor, project, request.payload.customData ?? {})
    const sequence = Number(project.next_task_sequence); const id = randomUUID(); const stamp = now()
    this.db.prepare('UPDATE projects SET next_task_sequence=next_task_sequence+1 WHERE id=?').run(project.id)
    this.db.prepare(`INSERT INTO tasks(id,tenant_id,project_id,sequence,title,summary,detail,status_id,category_id,assignee_id,priority,progress,due_at,custom_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
      .run(id, actor.tenantId, project.id, sequence, request.payload.title, request.payload.summary ?? '', request.payload.detail ?? '', status, request.payload.categoryId ?? null, request.payload.assigneeId ?? null, request.payload.priority ?? 'medium', request.payload.progress ?? 0, request.payload.dueAt ?? null, JSON.stringify(request.payload.customData ?? {}), stamp, stamp)
    this.replaceTaskLinks(actor, id, String(project.team_id), request.payload.meetingIds ?? [], request.payload.libraryItemIds ?? [])
    return this.record(actor, 'task', id, request.type, 1, this.entity('tasks', id))
  }

  private updateTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.update' }>): CommandResult {
    const row = this.projectEntity(actor, 'tasks', request.payload.id, true); const version = this.expect(row, request.expectedVersion); const project = this.requireProject(actor, String(row.project_id), true).project
    if (request.payload.statusId !== undefined) this.requireStatus(project.id, request.payload.statusId)
    if (request.payload.assigneeId !== undefined && request.payload.assigneeId !== null) this.requireProjectMember(actor, request.payload.assigneeId, String(project.id))
    if (request.payload.categoryId !== undefined && request.payload.categoryId !== null) this.requireCategory(actor, request.payload.categoryId)
    if (request.payload.customData !== undefined) this.validateCustomData(actor, project, request.payload.customData)
    const stamp = now()
    this.db.prepare(`UPDATE tasks SET title=?,summary=?,detail=?,status_id=?,category_id=?,assignee_id=?,priority=?,progress=?,due_at=?,custom_json=?,version=?,updated_at=? WHERE id=?`).run(
      request.payload.title ?? row.title, request.payload.summary ?? row.summary, request.payload.detail ?? row.detail,
      request.payload.statusId ?? row.status_id, request.payload.categoryId === undefined ? row.category_id : request.payload.categoryId,
      request.payload.assigneeId === undefined ? row.assignee_id : request.payload.assigneeId, request.payload.priority ?? row.priority,
      request.payload.progress ?? row.progress, request.payload.dueAt === undefined ? row.due_at : request.payload.dueAt,
      request.payload.customData === undefined ? row.custom_json : JSON.stringify(request.payload.customData), version + 1, stamp, row.id,
    )
    if (request.payload.meetingIds !== undefined || request.payload.libraryItemIds !== undefined) {
      const currentMeetings = request.payload.meetingIds ?? (this.db.prepare('SELECT meeting_id FROM task_meetings WHERE task_id=?').all(row.id) as Row[]).map(item => String(item.meeting_id))
      const currentLibrary = request.payload.libraryItemIds ?? (this.db.prepare('SELECT library_item_id FROM task_library_items WHERE task_id=?').all(row.id) as Row[]).map(item => String(item.library_item_id))
      this.replaceTaskLinks(actor, String(row.id), String(project.team_id), currentMeetings, currentLibrary)
    }
    return this.record(actor, 'task', String(row.id), request.type, version + 1, this.entity('tasks', String(row.id)))
  }

  private deleteTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.delete' }>): CommandResult {
    const row = this.projectEntity(actor, 'tasks', request.payload.id, true); const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE tasks SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'task', String(row.id), request.type, version + 1, this.entity('tasks', String(row.id)))
  }

  private createMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.create' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, false); this.validateProjectSet(actor, request.payload.projectIds, request.payload.teamId, true)
    const id = randomUUID(); const stamp = now(); const settings = { ...DEFAULT_SETTINGS, ...request.payload.settings }
    this.db.prepare(`INSERT INTO meetings(id,tenant_id,team_id,title,status,settings_json,version,created_at,updated_at) VALUES(?,?,?,?,'scheduled',?,1,?,?)`).run(id, actor.tenantId, request.payload.teamId, request.payload.title, JSON.stringify(settings), stamp, stamp)
    this.replaceProjectLinks('project_meetings', 'meeting_id', id, request.payload.projectIds, stamp)
    return this.record(actor, 'meeting', id, request.type, 1, this.entity('meetings', id))
  }

  private updateMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.update' }>): CommandResult {
    const access = this.requireMeeting(actor, request.payload.id, true); const row = access.meeting; const version = this.expect(row, request.expectedVersion); const stamp = now()
    const status = request.payload.status ?? row.status
    if (request.payload.status !== undefined) this.assertMeetingTransition(String(row.status), request.payload.status)
    const startedAt = row.started_at ?? (status === 'live' ? stamp : null)
    const endedAt = status === 'ended' || status === 'cancelled' ? stamp : row.ended_at
    const settings = { ...parseJson<MeetingSettings>(row.settings_json, DEFAULT_SETTINGS), ...request.payload.settings }
    this.db.prepare('UPDATE meetings SET title=?,status=?,settings_json=?,transcript=?,summary=?,decisions_json=?,risks_json=?,started_at=?,ended_at=?,version=?,updated_at=? WHERE id=?').run(
      request.payload.title ?? row.title, status, JSON.stringify(settings), request.payload.transcript ?? row.transcript,
      request.payload.summary ?? row.summary, request.payload.decisions === undefined ? row.decisions_json : JSON.stringify(request.payload.decisions),
      request.payload.risks === undefined ? row.risks_json : JSON.stringify(request.payload.risks), startedAt, endedAt, version + 1, stamp, row.id,
    )
    if (request.payload.projectIds !== undefined) {
      this.validateProjectSet(actor, request.payload.projectIds, String(row.team_id), true)
      this.replaceProjectLinks('project_meetings', 'meeting_id', String(row.id), request.payload.projectIds, stamp)
    }
    if (status === 'ended' || status === 'cancelled') this.db.prepare("UPDATE meeting_agent_bindings SET state='closed',updated_at=? WHERE meeting_id=? AND state='active'").run(stamp, row.id)
    return this.record(actor, 'meeting', String(row.id), request.type, version + 1, this.entity('meetings', String(row.id)))
  }

  private deleteMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.delete' }>): CommandResult {
    const row = this.requireMeeting(actor, request.payload.id, true).meeting; const version = this.expect(row, request.expectedVersion); const stamp = now()
    if (row.status === 'live' || row.status === 'finalizing') throw conflict('An active meeting cannot be deleted')
    this.db.prepare('UPDATE meetings SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'meeting', String(row.id), request.type, version + 1, this.entity('meetings', String(row.id)))
  }

  private appendTranscript(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.transcript.append' }>): CommandResult {
    const row = this.requireMeeting(actor, request.payload.id, true).meeting; const version = this.expect(row, request.expectedVersion)
    if (row.status !== 'live' && row.status !== 'finalizing') throw conflict('Meeting is not accepting transcript', { status: String(row.status) })
    const duplicate = request.payload.clientSegmentId === undefined ? undefined : this.db.prepare('SELECT sequence FROM meeting_utterances WHERE meeting_id=? AND client_segment_id=?').get(row.id, request.payload.clientSegmentId) as Row | undefined
    if (duplicate !== undefined) return { cursor: this.cursor(actor.tenantId), entityType: 'meeting', entityId: String(row.id), version, replayed: true }
    const sequence = Number((this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS value FROM meeting_utterances WHERE meeting_id=?').get(row.id) as Row).value); const stamp = now()
    this.db.prepare('INSERT INTO meeting_utterances(id,meeting_id,sequence,client_segment_id,speaker_id,text,started_at,ended_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.id, sequence, request.payload.clientSegmentId ?? null, request.payload.speakerId ?? null, request.payload.text, request.payload.startedAt ?? null, request.payload.endedAt ?? null, stamp)
    const transcript = `${String(row.transcript)}${String(row.transcript) === '' ? '' : '\n'}${request.payload.text}`
    this.db.prepare('UPDATE meetings SET transcript=?,version=?,updated_at=? WHERE id=?').run(transcript, version + 1, stamp, row.id)
    return this.record(actor, 'meeting', String(row.id), request.type, version + 1, this.entity('meetings', String(row.id)))
  }

  private appendMeetingAction(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.action.append' }>): CommandResult {
    const row = this.requireMeeting(actor, request.payload.id, true).meeting; const version = this.expect(row, request.expectedVersion); const stamp = now()
    if (request.payload.callId !== undefined && this.db.prepare('SELECT id FROM meeting_ai_actions WHERE meeting_id=? AND call_id=?').get(row.id, request.payload.callId) !== undefined) return { cursor: this.cursor(actor.tenantId), entityType: 'meeting', entityId: String(row.id), version, replayed: true }
    this.db.prepare('INSERT INTO meeting_ai_actions(id,meeting_id,call_id,kind,summary,entity_type,entity_id,ok,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.id, request.payload.callId ?? null, request.payload.kind, request.payload.summary, request.payload.entityType ?? null, request.payload.entityId ?? null, request.payload.ok === false ? 0 : 1, stamp)
    this.db.prepare('UPDATE meetings SET version=?,updated_at=? WHERE id=?').run(version + 1, stamp, row.id)
    return this.record(actor, 'meeting', String(row.id), request.type, version + 1, this.entity('meetings', String(row.id)))
  }

  private bindMeetingAgent(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.agent.bind' }>): CommandResult {
    const meeting = this.requireMeeting(actor, request.payload.id, true).meeting
    if (meeting.status !== 'live' && meeting.status !== 'finalizing') throw conflict('Meeting agent can only bind an active meeting', { status: String(meeting.status) })
    const current = this.db.prepare('SELECT * FROM meeting_agent_bindings WHERE meeting_id=?').get(meeting.id) as Row | undefined
    if (current !== undefined && current.state === 'active' && current.session_id === request.payload.sessionId) {
      return { cursor: this.cursor(actor.tenantId), entityType: 'meeting_agent_binding', entityId: String(meeting.id), version: 1, replayed: true }
    }
    const occupied = this.db.prepare("SELECT meeting_id FROM meeting_agent_bindings WHERE session_id=? AND state='active'").get(request.payload.sessionId) as Row | undefined
    if (occupied !== undefined && occupied.meeting_id !== meeting.id) throw conflict('Session is already supervising another meeting', { meetingId: String(occupied.meeting_id) })
    if (current !== undefined && current.state === 'active') throw conflict('Meeting is already supervised by another session', { sessionId: String(current.session_id) })
    const stamp = now()
    this.db.prepare(`INSERT INTO meeting_agent_bindings(meeting_id,session_id,state,delivered_sequence,analyzed_sequence,created_at,updated_at)
      VALUES(?,?,'active',0,0,?,?)
      ON CONFLICT(meeting_id) DO UPDATE SET session_id=excluded.session_id,state='active',delivered_sequence=0,analyzed_sequence=0,updated_at=excluded.updated_at`)
      .run(meeting.id, request.payload.sessionId, stamp, stamp)
    return this.record(actor, 'meeting_agent_binding', String(meeting.id), request.type, 1, this.meetingBinding(String(meeting.id)))
  }

  private updateMeetingAgentProgress(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.agent.progress' }>): CommandResult {
    const meeting = this.requireMeeting(actor, request.payload.id, true).meeting
    const binding = this.db.prepare('SELECT * FROM meeting_agent_bindings WHERE meeting_id=?').get(meeting.id) as Row | undefined
    if (binding === undefined || binding.state !== 'active') throw conflict('Meeting has no active Supervisor binding')
    const latest = this.latestUtteranceSequence(String(meeting.id))
    const delivered = request.payload.deliveredSequence ?? Number(binding.delivered_sequence)
    const analyzed = request.payload.analyzedSequence ?? Number(binding.analyzed_sequence)
    if (delivered < Number(binding.delivered_sequence) || analyzed < Number(binding.analyzed_sequence)) throw conflict('Meeting agent progress cannot move backwards')
    if (analyzed > delivered || delivered > latest) throw conflict('Meeting agent progress exceeds available transcript', { latestSequence: latest })
    if (delivered === Number(binding.delivered_sequence) && analyzed === Number(binding.analyzed_sequence)) {
      return { cursor: this.cursor(actor.tenantId), entityType: 'meeting_agent_binding', entityId: String(meeting.id), version: 1, replayed: true }
    }
    this.db.prepare('UPDATE meeting_agent_bindings SET delivered_sequence=?,analyzed_sequence=?,updated_at=? WHERE meeting_id=?').run(delivered, analyzed, now(), meeting.id)
    return this.record(actor, 'meeting_agent_binding', String(meeting.id), request.type, 1, this.meetingBinding(String(meeting.id)))
  }

  private upsertMeetingIntent(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.intent.upsert' }>): CommandResult {
    const meeting = this.requireMeeting(actor, request.payload.meetingId, true).meeting
    if (meeting.status !== 'live' && meeting.status !== 'finalizing') throw conflict('Meeting is not accepting AI intents', { status: String(meeting.status) })
    const latest = this.latestUtteranceSequence(String(meeting.id))
    if (request.payload.evidenceFromSequence > request.payload.evidenceToSequence || request.payload.evidenceToSequence > latest) {
      throw conflict('Intent evidence exceeds available transcript', { latestSequence: latest })
    }
    const existing = this.db.prepare('SELECT * FROM meeting_intents WHERE meeting_id=? AND intent_key=?').get(meeting.id, request.payload.intentKey) as Row | undefined
    const stamp = now()
    if (existing === undefined) {
      const id = randomUUID()
      this.db.prepare(`INSERT INTO meeting_intents(id,meeting_id,intent_key,kind,status,payload_json,evidence_from_sequence,evidence_to_sequence,revision,created_at,updated_at)
        VALUES(?,?,?,?,'detected',?,?,?,?,?,?)`)
        .run(id, meeting.id, request.payload.intentKey, request.payload.kind, JSON.stringify(request.payload.payload), request.payload.evidenceFromSequence, request.payload.evidenceToSequence, 1, stamp, stamp)
      return this.record(actor, 'meeting_intent', id, request.type, 1, this.entity('meeting_intents', id))
    }
    if (existing.status === 'applied') throw conflict('Applied intent cannot be revised; create a new intent key', { intentId: String(existing.id) })
    const revision = Number(existing.revision) + 1
    this.db.prepare(`UPDATE meeting_intents SET kind=?,status='detected',payload_json=?,evidence_from_sequence=?,evidence_to_sequence=?,revision=?,subagent_id=NULL,entity_type=NULL,entity_id=NULL,error=NULL,updated_at=? WHERE id=?`)
      .run(request.payload.kind, JSON.stringify(request.payload.payload), request.payload.evidenceFromSequence, request.payload.evidenceToSequence, revision, stamp, existing.id)
    return this.record(actor, 'meeting_intent', String(existing.id), request.type, revision, this.entity('meeting_intents', String(existing.id)))
  }

  private updateMeetingIntentStatus(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.intent.status' }>): CommandResult {
    const intent = this.requireMeetingIntent(actor, request.payload.id, true)
    if (Number(intent.revision) !== request.payload.revision) throw conflict('Meeting intent revision conflict', { currentRevision: Number(intent.revision) })
    this.assertMeetingIntentTransition(intent.status as MeetingIntentStatus, request.payload.status)
    this.db.prepare('UPDATE meeting_intents SET status=?,subagent_id=?,error=?,updated_at=? WHERE id=?').run(
      request.payload.status,
      request.payload.subagentId === undefined ? intent.subagent_id : request.payload.subagentId,
      request.payload.error === undefined ? intent.error : request.payload.error,
      now(), intent.id,
    )
    return this.record(actor, 'meeting_intent', String(intent.id), request.type, Number(intent.revision), this.entity('meeting_intents', String(intent.id)))
  }

  private recordMeetingIntent(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.intent.record' }>): CommandResult {
    const meeting = this.requireMeeting(actor, request.payload.meetingId, true).meeting
    if (meeting.status !== 'live' && meeting.status !== 'finalizing') throw conflict('Meeting is not accepting AI intents', { status: String(meeting.status) })
    const latest = this.latestUtteranceSequence(String(meeting.id))
    if (request.payload.evidenceFromSequence > request.payload.evidenceToSequence || request.payload.evidenceToSequence > latest) {
      throw conflict('Intent evidence exceeds available transcript', { latestSequence: latest })
    }
    const existing = this.db.prepare('SELECT * FROM meeting_intents WHERE meeting_id=? AND intent_key=?').get(meeting.id, request.payload.intentKey) as Row | undefined
    if (existing !== undefined) {
      return { cursor: this.cursor(actor.tenantId), entityType: 'meeting_intent', entityId: String(existing.id), version: Number(existing.revision), replayed: true }
    }
    const duplicate = this.db.prepare(`SELECT * FROM meeting_intents
      WHERE meeting_id=? AND evidence_from_sequence=? AND evidence_to_sequence=? AND json_extract(payload_json,'$.title')=? LIMIT 1`)
      .get(meeting.id, request.payload.evidenceFromSequence, request.payload.evidenceToSequence, request.payload.title) as Row | undefined
    if (duplicate !== undefined) {
      return { cursor: this.cursor(actor.tenantId), entityType: 'meeting_intent', entityId: String(duplicate.id), version: Number(duplicate.revision), replayed: true }
    }
    const id = randomUUID(); const stamp = now()
    this.db.prepare(`INSERT INTO meeting_intents(id,meeting_id,intent_key,kind,status,payload_json,evidence_from_sequence,evidence_to_sequence,revision,entity_type,entity_id,created_at,updated_at)
      VALUES(?,?,?,'note','applied',?,?,?,?, 'meeting',?,?,?)`)
      .run(id, meeting.id, request.payload.intentKey, JSON.stringify({ title: request.payload.title, origin: 'user' }), request.payload.evidenceFromSequence, request.payload.evidenceToSequence, 1, meeting.id, stamp, stamp)
    return this.record(actor, 'meeting_intent', id, request.type, 1, this.entity('meeting_intents', id))
  }

  private commitMeetingIntent(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.intent.commit' }>): CommandResult {
    const intent = this.requireMeetingIntent(actor, request.payload.id, true)
    const meeting = this.requireMeeting(actor, String(intent.meeting_id), true).meeting
    if (Number(intent.revision) !== request.payload.revision) throw conflict('Meeting intent revision conflict', { currentRevision: Number(intent.revision) })
    if (intent.status === 'applied') {
      return {
        cursor: this.cursor(actor.tenantId),
        entityType: nullable(intent.entity_type) ?? 'meeting_intent',
        entityId: nullable(intent.entity_id) ?? String(intent.id),
        version: Number(intent.revision),
        replayed: true,
      }
    }
    const latest = this.latestUtteranceSequence(String(meeting.id))
    if (request.payload.basisSequence !== latest || Number(intent.evidence_to_sequence) > request.payload.basisSequence) {
      throw conflict('Meeting transcript advanced; re-evaluate the intent before committing', { latestSequence: latest, basisSequence: request.payload.basisSequence })
    }
    const settings = parseJson<MeetingSettings>(meeting.settings_json, DEFAULT_SETTINGS)
    if (settings.automation === 'record') throw forbidden('Record-only meetings cannot commit AI intents')
    if (settings.automation === 'suggest' && intent.status !== 'approved') throw conflict('Suggested intent requires approval before commit', { status: String(intent.status) })
    if (!['detected', 'approved', 'executing'].includes(String(intent.status))) throw conflict('Meeting intent is not ready to commit', { status: String(intent.status) })

    const payload = parseJson<MeetingIntentPayload>(intent.payload_json, { title: '' })
    const linkedProjects = new Set((this.db.prepare('SELECT project_id FROM project_meetings WHERE meeting_id=?').all(meeting.id) as Row[]).map(row => String(row.project_id)))
    const projectIds = payload.projectIds ?? (payload.projectId === undefined ? [] : [payload.projectId])
    if (projectIds.some(projectId => !linkedProjects.has(projectId))) throw conflict('Intent references a project outside the meeting', { meetingId: String(meeting.id) })
    this.db.prepare("UPDATE meeting_intents SET status='executing',error=NULL,updated_at=? WHERE id=?").run(now(), intent.id)

    let entityType: string
    let entityId: string
    if (intent.kind === 'task') {
      const projectId = projectIds[0]
      if (projectId === undefined) throw conflict('Task intent requires a linked project')
      const created = this.createTask(actor, {
        idempotencyKey: `intent:${intent.id}:${intent.revision}`,
        type: 'task.create',
        payload: {
          projectId,
          title: payload.title,
          meetingIds: [String(meeting.id)],
          ...(payload.summary === undefined ? {} : { summary: payload.summary }),
          ...(payload.assigneeId === undefined ? {} : { assigneeId: payload.assigneeId }),
          ...(payload.dueAt === undefined ? {} : { dueAt: payload.dueAt }),
          ...(payload.priority === undefined ? {} : { priority: payload.priority }),
        },
      })
      entityType = created.entityType; entityId = created.entityId
    } else if (intent.kind === 'document') {
      if (projectIds.length === 0) throw conflict('Document intent requires at least one linked project')
      const created = this.createLibrary(actor, {
        idempotencyKey: `intent:${intent.id}:${intent.revision}`,
        type: 'library.create',
        payload: {
          teamId: String(meeting.team_id), projectIds, type: 'doc', title: payload.title,
          content: payload.content ?? payload.summary ?? '', sourceMeetingId: String(meeting.id),
        },
      })
      entityType = created.entityType; entityId = created.entityId
    } else {
      const field = intent.kind === 'decision' ? 'decisions_json' : intent.kind === 'risk' ? 'risks_json' : null
      if (field !== null) {
        const values = parseJson<string[]>(meeting[field], [])
        if (!values.includes(payload.title)) values.push(payload.title)
        const entityVersion = Number(meeting.version) + 1
        this.db.prepare(`UPDATE meetings SET ${field}=?,version=?,updated_at=? WHERE id=?`).run(JSON.stringify(values), entityVersion, now(), meeting.id)
        this.record(actor, 'meeting', String(meeting.id), `meeting.intent.${String(intent.kind)}`, entityVersion, this.entity('meetings', String(meeting.id)))
      }
      entityType = 'meeting'; entityId = String(meeting.id)
    }

    const stamp = now()
    this.db.prepare("UPDATE meeting_intents SET status='applied',entity_type=?,entity_id=?,error=NULL,updated_at=? WHERE id=?").run(entityType, entityId, stamp, intent.id)
    this.db.prepare('INSERT INTO meeting_ai_actions(id,meeting_id,call_id,kind,summary,entity_type,entity_id,ok,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), meeting.id, `intent:${String(intent.id)}:${String(intent.revision)}`, intent.kind === 'risk' ? 'note' : intent.kind, payload.title, entityType, entityId, 1, stamp)
    return { ...this.record(actor, 'meeting_intent', String(intent.id), request.type, Number(intent.revision), this.entity('meeting_intents', String(intent.id))), related: [{ entityType, entityId }] }
  }

  private finalizeMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.finalize' }>): CommandResult {
    const row = this.requireMeeting(actor, request.payload.id, true).meeting; const version = this.expect(row, request.expectedVersion)
    if (row.status !== 'live' && row.status !== 'finalizing') throw conflict('Meeting cannot be finalized', { status: String(row.status) })
    if (this.db.prepare("SELECT 1 FROM transcription_jobs WHERE meeting_id=? AND state IN ('pending','processing') LIMIT 1").get(row.id) !== undefined) {
      throw conflict('Meeting still has transcription jobs in progress')
    }
    const latestSequence = this.latestUtteranceSequence(String(row.id))
    const binding = this.db.prepare("SELECT * FROM meeting_agent_bindings WHERE meeting_id=? AND state='active'").get(row.id) as Row | undefined
    if (binding !== undefined && Number(binding.analyzed_sequence) < latestSequence) {
      throw conflict('Meeting still has transcript awaiting Supervisor analysis', { latestSequence, analyzedSequence: Number(binding.analyzed_sequence) })
    }
    const unresolved = Number((this.db.prepare("SELECT COUNT(*) AS value FROM meeting_intents WHERE meeting_id=? AND status IN ('detected','clarifying','approved','executing')").get(row.id) as Row).value)
    if (unresolved > 0) throw conflict('Meeting still has unresolved intents', { unresolvedIntents: unresolved })
    const stamp = now()
    this.db.prepare(`UPDATE meetings SET status='ended',summary=?,ended_at=?,version=?,updated_at=? WHERE id=?`).run(request.payload.summary, stamp, version + 1, stamp, row.id)
    this.db.prepare("UPDATE meeting_agent_bindings SET state='closed',updated_at=? WHERE meeting_id=? AND state='active'").run(stamp, row.id)
    this.db.prepare('INSERT INTO meeting_ai_actions(id,meeting_id,call_id,kind,summary,entity_type,entity_id,ok,created_at) VALUES(?,?,NULL,\'finalize\',\'会议已整理完成\',\'meeting\',?,1,?)').run(randomUUID(), row.id, row.id, stamp)
    return this.record(actor, 'meeting', String(row.id), request.type, version + 1, this.entity('meetings', String(row.id)))
  }

  private createLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.create' }>): CommandResult {
    this.requireTeam(actor, request.payload.teamId, true, false); this.validateProjectSet(actor, request.payload.projectIds, request.payload.teamId, true)
    if (request.payload.sourceMeetingId !== undefined) {
      const meeting = this.requireMeeting(actor, request.payload.sourceMeetingId, true).meeting
      if (String(meeting.team_id) !== request.payload.teamId) throw conflict('Source meeting belongs to another team')
    }
    const id = randomUUID(); const stamp = now()
    this.db.prepare('INSERT INTO library_items(id,tenant_id,team_id,type,title,content,url,category_id,source_meeting_id,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)').run(id, actor.tenantId, request.payload.teamId, request.payload.type, request.payload.title, request.payload.content ?? '', request.payload.url ?? null, request.payload.categoryId ?? null, request.payload.sourceMeetingId ?? null, stamp, stamp)
    this.replaceProjectLinks('project_library_items', 'library_item_id', id, request.payload.projectIds, stamp)
    if (request.payload.sourceMeetingId !== undefined) this.db.prepare('INSERT OR IGNORE INTO meeting_library_items(meeting_id,library_item_id,created_at) VALUES(?,?,?)').run(request.payload.sourceMeetingId, id, stamp)
    return this.record(actor, 'library', id, request.type, 1, this.entity('library_items', id))
  }

  private updateLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.update' }>): CommandResult {
    const row = this.requireLibrary(actor, request.payload.id, true).item; const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE library_items SET title=?,content=?,url=?,category_id=?,version=?,updated_at=? WHERE id=?').run(request.payload.title ?? row.title, request.payload.content ?? row.content, request.payload.url === undefined ? row.url : request.payload.url, request.payload.categoryId === undefined ? row.category_id : request.payload.categoryId, version + 1, stamp, row.id)
    if (request.payload.projectIds !== undefined) { this.validateProjectSet(actor, request.payload.projectIds, String(row.team_id), true); this.replaceProjectLinks('project_library_items', 'library_item_id', String(row.id), request.payload.projectIds, stamp) }
    return this.record(actor, 'library', String(row.id), request.type, version + 1, this.entity('library_items', String(row.id)))
  }

  private deleteLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.delete' }>): CommandResult {
    const row = this.requireLibrary(actor, request.payload.id, true).item; const version = this.expect(row, request.expectedVersion); const stamp = now()
    this.db.prepare('UPDATE library_items SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'library', String(row.id), request.type, version + 1, this.entity('library_items', String(row.id)))
  }

  private linkLibraryMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'library.meeting.link' }>): CommandResult {
    const library = this.requireLibrary(actor, request.payload.libraryItemId, true).item; const meeting = this.requireMeeting(actor, request.payload.meetingId, true).meeting
    if (String(library.team_id) !== String(meeting.team_id)) throw conflict('Meeting and document belong to different teams')
    this.db.prepare('INSERT OR IGNORE INTO meeting_library_items(meeting_id,library_item_id,created_at) VALUES(?,?,?)').run(meeting.id, library.id, now())
    return this.record(actor, 'meeting_library', `${meeting.id}:${library.id}`, request.type, 1, request.payload)
  }

  private createEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.create' }>): CommandResult {
    if (request.payload.projectId !== undefined) this.requireProject(actor, request.payload.projectId, true)
    const id = randomUUID(); const stamp = now()
    this.db.prepare(`INSERT INTO calendar_events(id,tenant_id,project_id,type,title,start_at,end_at,all_day,owner_id,attendee_ids_json,task_id,meeting_id,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(id, actor.tenantId, request.payload.projectId ?? null, request.payload.type, request.payload.title, request.payload.startAt, request.payload.endAt ?? null, request.payload.allDay === true ? 1 : 0, request.payload.ownerId ?? actor.id, JSON.stringify(request.payload.attendeeIds ?? []), request.payload.taskId ?? null, request.payload.meetingId ?? null, stamp, stamp)
    return this.record(actor, 'event', id, request.type, 1, this.entity('calendar_events', id))
  }

  private updateEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.update' }>): CommandResult {
    const row = this.tenantEntity(actor, 'calendar_events', request.payload.id); if (row.project_id !== null) this.requireProject(actor, String(row.project_id), true)
    const version = this.expect(row, request.expectedVersion); const stamp = now()
    if (request.payload.projectId !== undefined && request.payload.projectId !== null) this.requireProject(actor, request.payload.projectId, true)
    this.db.prepare(`UPDATE calendar_events SET project_id=?,type=?,title=?,start_at=?,end_at=?,all_day=?,owner_id=?,attendee_ids_json=?,task_id=?,meeting_id=?,version=?,updated_at=? WHERE id=?`).run(request.payload.projectId === undefined ? row.project_id : request.payload.projectId, request.payload.type ?? row.type, request.payload.title ?? row.title, request.payload.startAt ?? row.start_at, request.payload.endAt === undefined ? row.end_at : request.payload.endAt, request.payload.allDay === undefined ? row.all_day : request.payload.allDay ? 1 : 0, request.payload.ownerId === undefined ? row.owner_id : request.payload.ownerId, request.payload.attendeeIds === undefined ? row.attendee_ids_json : JSON.stringify(request.payload.attendeeIds), request.payload.taskId === undefined ? row.task_id : request.payload.taskId, request.payload.meetingId === undefined ? row.meeting_id : request.payload.meetingId, version + 1, stamp, row.id)
    return this.record(actor, 'event', String(row.id), request.type, version + 1, this.entity('calendar_events', String(row.id)))
  }

  private deleteEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.delete' }>): CommandResult {
    const row = this.tenantEntity(actor, 'calendar_events', request.payload.id); if (row.project_id !== null) this.requireProject(actor, String(row.project_id), true)
    const version = this.expect(row, request.expectedVersion); const stamp = now(); this.db.prepare('UPDATE calendar_events SET deleted_at=?,version=?,updated_at=? WHERE id=?').run(stamp, version + 1, stamp, row.id)
    return this.record(actor, 'event', String(row.id), request.type, version + 1, this.entity('calendar_events', String(row.id)))
  }

  private seedProject(tenantId: string, projectId: string): void {
    for (const [name, color, position, category] of [['待办', '#8A8D93', 0, 'backlog'], ['进行中', '#4D6BFE', 1, 'active'], ['已完成', '#2B8A5A', 2, 'done']] as const) {
      this.db.prepare('INSERT INTO workflow_statuses(id,tenant_id,project_id,name,color,position,category,version) VALUES(?,?,?,?,?,?,?,1)').run(randomUUID(), tenantId, projectId, name, color, position, category)
    }
    for (const [name, type, groupBy, fields] of [['项目看板', 'board', 'status', ['title', 'priority', 'assigneeId', 'dueAt']], ['任务表', 'table', null, ['sequence', 'title', 'status', 'priority', 'assigneeId', 'dueAt']]] as const) {
      this.db.prepare(`INSERT INTO saved_views(id,tenant_id,project_id,name,view_type,filters_json,sorts_json,group_by,fields_json,version) VALUES(?,?,?,?,?,'{}','[]',?,?,1)`).run(randomUUID(), tenantId, projectId, name, type, groupBy, JSON.stringify(fields))
    }
  }

  private replaceTaskLinks(actor: ActorView, taskId: string, teamId: string, meetingIds: string[], libraryIds: string[]): void {
    for (const meetingId of meetingIds) { const meeting = this.requireMeeting(actor, meetingId, false).meeting; if (String(meeting.team_id) !== teamId) throw conflict('Task and meeting belong to different teams') }
    for (const libraryId of libraryIds) { const item = this.requireLibrary(actor, libraryId, false).item; if (String(item.team_id) !== teamId) throw conflict('Task and document belong to different teams') }
    this.db.prepare('DELETE FROM task_meetings WHERE task_id=?').run(taskId); this.db.prepare('DELETE FROM task_library_items WHERE task_id=?').run(taskId)
    const stamp = now()
    for (const meetingId of [...new Set(meetingIds)]) this.db.prepare('INSERT INTO task_meetings(task_id,meeting_id,created_at) VALUES(?,?,?)').run(taskId, meetingId, stamp)
    for (const libraryId of [...new Set(libraryIds)]) this.db.prepare('INSERT INTO task_library_items(task_id,library_item_id,created_at) VALUES(?,?,?)').run(taskId, libraryId, stamp)
  }

  private replaceProjectLinks(table: 'project_meetings' | 'project_library_items', foreignColumn: 'meeting_id' | 'library_item_id', foreignId: string, projectIds: string[], stamp: string): void {
    this.db.prepare(`DELETE FROM ${table} WHERE ${foreignColumn}=?`).run(foreignId)
    for (const projectId of [...new Set(projectIds)]) this.db.prepare(`INSERT INTO ${table}(project_id,${foreignColumn},created_at) VALUES(?,?,?)`).run(projectId, foreignId, stamp)
  }

  private validateProjectSet(actor: ActorView, projectIds: string[], teamId: string, write: boolean): void {
    if (projectIds.length === 0) throw conflict('At least one project is required')
    for (const id of [...new Set(projectIds)]) {
      const project = this.requireProject(actor, id, write).project
      if (String(project.team_id) !== teamId) throw conflict('Cross-team resource links are not allowed', { projectId: id })
    }
  }

  private assertMeetingTransition(from: string, to: string): void {
    if (from === to) return
    const allowed: Record<string, readonly string[]> = { scheduled: ['live', 'cancelled'], live: ['finalizing', 'cancelled'], finalizing: ['ended', 'cancelled'], ended: [], cancelled: [] }
    if (!(allowed[from] ?? []).includes(to)) throw conflict('Invalid meeting status transition', { from, to })
  }

  private assertMeetingIntentTransition(from: MeetingIntentStatus, to: MeetingIntentStatus): void {
    if (from === to) return
    const allowed: Record<MeetingIntentStatus, readonly MeetingIntentStatus[]> = {
      detected: ['clarifying', 'approved', 'executing', 'superseded', 'rejected', 'failed'],
      clarifying: ['approved', 'superseded', 'rejected', 'failed'],
      approved: ['executing', 'superseded', 'rejected', 'failed'],
      executing: ['failed'],
      applied: [], superseded: [], rejected: [], failed: [],
    }
    if (!allowed[from].includes(to)) throw conflict('Invalid meeting intent status transition', { from, to })
  }

  private latestUtteranceSequence(meetingId: string): number {
    return Number((this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM meeting_utterances WHERE meeting_id=?').get(meetingId) as Row).value)
  }

  private validateCustomData(actor: ActorView, project: Row, data: Record<string, JsonValue>): void {
    const definitions = this.db.prepare('SELECT * FROM task_field_definitions WHERE project_id=? AND deleted_at IS NULL').all(project.id) as Row[]
    const byKey = new Map(definitions.map(field => [String(field.field_key), field]))
    for (const key of Object.keys(data)) {
      if (!byKey.has(key)) throw new FlowboardError('VALIDATION_ERROR', `Unknown task field: ${key}`, 400)
    }
    for (const field of definitions) {
      const key = String(field.field_key)
      const value = data[key]
      const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
      if (Boolean(field.required) && empty) throw new FlowboardError('VALIDATION_ERROR', `${String(field.name)} is required`, 400)
      if (empty) continue
      const options = parseJson<string[]>(field.options_json, [])
      switch (field.field_type as FieldType) {
        case 'text':
          if (typeof value !== 'string') throw this.invalidField(field)
          break
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value)) throw this.invalidField(field)
          break
        case 'boolean':
          if (typeof value !== 'boolean') throw this.invalidField(field)
          break
        case 'date':
          if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw this.invalidField(field)
          break
        case 'select':
          if (typeof value !== 'string' || (options.length > 0 && !options.includes(value))) throw this.invalidField(field)
          break
        case 'multi_select':
          if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || (options.length > 0 && !options.includes(item)))) throw this.invalidField(field)
          break
        case 'person':
          if (typeof value !== 'string') throw this.invalidField(field)
          this.requireProjectMember(actor, value, String(project.id))
          break
      }
    }
  }

  private invalidField(field: Row): FlowboardError {
    return new FlowboardError('VALIDATION_ERROR', `Invalid value for ${String(field.name)}`, 400)
  }

  private clearCustomField(actor: ActorView, projectId: string, key: string): void {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE project_id=? AND deleted_at IS NULL').all(projectId) as Row[]
    for (const row of rows) {
      const data = parseJson<Record<string, JsonValue>>(row.custom_json, {})
      if (!(key in data)) continue
      delete data[key]
      const stamp = now(); const version = Number(row.version) + 1
      this.db.prepare('UPDATE tasks SET custom_json=?,version=?,updated_at=? WHERE id=?').run(JSON.stringify(data), version, stamp, row.id)
      this.record(actor, 'task', String(row.id), 'field.value.clear', version, this.entity('tasks', String(row.id)))
    }
  }

  private projectOwnerCount(projectId: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS value FROM project_members WHERE project_id=? AND role='owner'").get(projectId) as Row).value)
  }

  private teamOwnerCount(teamId: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS value FROM team_members WHERE team_id=? AND role='owner'").get(teamId) as Row).value)
  }

  private requireStatus(projectId: string, statusId: string): Row {
    const row = this.db.prepare('SELECT * FROM workflow_statuses WHERE id=? AND project_id=? AND deleted_at IS NULL').get(statusId, projectId) as Row | undefined
    if (row === undefined) throw notFound('workflow status', statusId)
    return row
  }

  private requireTeam(actor: ActorView, teamId: string, write: boolean, admin: boolean): Row {
    const row = this.db.prepare('SELECT * FROM teams WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(teamId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('team', teamId)
    const role = this.teamRole(actor, teamId)
    if (role === null) throw notFound('team', teamId)
    if (admin ? !ADMIN_ROLES.includes(role) : write && !WRITE_ROLES.includes(role)) throw forbidden('Insufficient team permission')
    return row
  }

  private teamRole(actor: ActorView, teamId: string): AccessRole | null {
    const row = this.db.prepare('SELECT role FROM team_members WHERE team_id=? AND user_id=?').get(teamId, actor.id) as Row | undefined
    return row === undefined ? null : row.role as AccessRole
  }

  private requireProject(actor: ActorView, projectId: string, write: boolean): ProjectAccess {
    const row = this.db.prepare(`SELECT p.*,tm.role AS team_role,pm.role AS project_role FROM projects p JOIN team_members tm ON tm.team_id=p.team_id AND tm.user_id=? LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE p.id=? AND p.tenant_id=? AND p.deleted_at IS NULL`).get(actor.id, actor.id, projectId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('project', projectId)
    const teamRole = row.team_role as AccessRole
    const role: AccessRole | null = ADMIN_ROLES.includes(teamRole) ? teamRole : row.project_role === null || row.project_role === undefined ? null : row.project_role as AccessRole
    if (role === null) throw notFound('project', projectId)
    if (write && !WRITE_ROLES.includes(role)) throw forbidden('Project is read-only')
    return { project: row, role }
  }

  private requireMeeting(actor: ActorView, meetingId: string, write: boolean): { meeting: Row; role: AccessRole } {
    const meeting = this.db.prepare('SELECT * FROM meetings WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(meetingId, actor.tenantId) as Row | undefined
    if (meeting === undefined) throw notFound('meeting', meetingId)
    const links = this.db.prepare('SELECT project_id FROM project_meetings WHERE meeting_id=?').all(meetingId) as Row[]
    let best: AccessRole | null = null
    for (const link of links) {
      try { const access = this.requireProject(actor, String(link.project_id), write); if (best === null || this.roleRank(access.role) > this.roleRank(best)) best = access.role } catch { /* inaccessible links do not grant access */ }
    }
    if (best === null) throw notFound('meeting', meetingId)
    return { meeting, role: best }
  }

  private requireLibrary(actor: ActorView, libraryId: string, write: boolean): { item: Row; role: AccessRole } {
    const item = this.db.prepare('SELECT * FROM library_items WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(libraryId, actor.tenantId) as Row | undefined
    if (item === undefined) throw notFound('library item', libraryId)
    const links = this.db.prepare('SELECT project_id FROM project_library_items WHERE library_item_id=?').all(libraryId) as Row[]
    let best: AccessRole | null = null
    for (const link of links) {
      try { const access = this.requireProject(actor, String(link.project_id), write); if (best === null || this.roleRank(access.role) > this.roleRank(best)) best = access.role } catch { /* inaccessible links do not grant access */ }
    }
    if (best === null) throw notFound('library item', libraryId)
    return { item, role: best }
  }

  private requireMeetingIntent(actor: ActorView, intentId: string, write: boolean): Row {
    const row = this.db.prepare('SELECT * FROM meeting_intents WHERE id=?').get(intentId) as Row | undefined
    if (row === undefined) throw notFound('meeting intent', intentId)
    this.requireMeeting(actor, String(row.meeting_id), write)
    return row
  }

  private roleRank(role: AccessRole): number { return ({ viewer: 1, member: 2, admin: 3, owner: 4 })[role] }

  private requireUser(actor: ActorView, userId: string, admin = false): Row {
    const row = this.db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND deleted_at IS NULL').get(userId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('person', userId)
    if (admin) {
      const common = this.db.prepare(`SELECT 1 FROM team_members mine JOIN team_members target ON target.team_id=mine.team_id WHERE mine.user_id=? AND target.user_id=? AND mine.role IN ('owner','admin') LIMIT 1`).get(actor.id, userId)
      if (common === undefined) throw forbidden('Only a shared team administrator can manage this person')
    }
    return row
  }

  private requireUserInTeam(actor: ActorView, userId: string, teamId: string): Row {
    const row = this.requireUser(actor, userId)
    if (this.db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(teamId, userId) === undefined) throw conflict('Person is not a member of the project team', { userId })
    return row
  }

  private requireProjectMember(actor: ActorView, userId: string, projectId: string): Row {
    const row = this.requireUser(actor, userId)
    if (this.db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(projectId, userId) === undefined) throw conflict('Person is not a member of the project', { userId })
    return row
  }

  private requireCategory(actor: ActorView, categoryId: string): Row {
    return this.tenantEntity(actor, 'categories', categoryId)
  }

  private projectEntity(actor: ActorView, table: 'tasks' | 'workflow_statuses' | 'task_field_definitions' | 'saved_views', id: string, write: boolean): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(id) as Row | undefined
    if (row === undefined) throw notFound(table, id)
    this.requireProject(actor, String(row.project_id), write)
    return row
  }

  private tenantEntity(actor: ActorView, table: 'categories' | 'calendar_events', id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND deleted_at IS NULL`).get(id, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound(table, id)
    return row
  }

  private accessibleProjects(actor: ActorView, projectId?: string): Row[] {
    if (projectId !== undefined) { const access = this.requireProject(actor, projectId, false); return [{ ...access.project, role: access.role }] }
    return this.db.prepare(`SELECT p.*,CASE WHEN tm.role IN ('owner','admin') THEN tm.role ELSE pm.role END AS role FROM projects p JOIN team_members tm ON tm.team_id=p.team_id AND tm.user_id=? LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (tm.role IN ('owner','admin') OR pm.role IS NOT NULL) ORDER BY p.name`).all(actor.id, actor.id, actor.tenantId) as Row[]
  }

  private rowsForProjects(table: string, projectIds: string[], order: string): Row[] {
    return projectIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM ${table} WHERE project_id IN (${this.placeholders(projectIds)}) AND deleted_at IS NULL ORDER BY ${order}`).all(...projectIds) as Row[]
  }
  private rowsByIds(table: string, ids: string[], where: string): Row[] { return ids.length === 0 ? [] : this.db.prepare(`SELECT * FROM ${table} WHERE id IN (${this.placeholders(ids)}) AND ${where}`).all(...ids) as Row[] }
  private resourceIds(table: 'project_meetings' | 'project_library_items', column: string, projectIds: string[]): string[] { return projectIds.length === 0 ? [] : [...new Set((this.db.prepare(`SELECT ${column} AS id FROM ${table} WHERE project_id IN (${this.placeholders(projectIds)})`).all(...projectIds) as Row[]).map(row => String(row.id)))] }
  private linkRows(table: 'project_meetings' | 'project_library_items', projectIds: string[]): Row[] { return projectIds.length === 0 ? [] : this.db.prepare(`SELECT * FROM ${table} WHERE project_id IN (${this.placeholders(projectIds)})`).all(...projectIds) as Row[] }
  private taskLinkRows(table: 'task_meetings' | 'task_library_items', projectIds: string[]): Row[] { return projectIds.length === 0 ? [] : this.db.prepare(`SELECT l.* FROM ${table} l JOIN tasks t ON t.id=l.task_id WHERE t.project_id IN (${this.placeholders(projectIds)}) AND t.deleted_at IS NULL`).all(...projectIds) as Row[] }
  private placeholders(values: readonly unknown[]): string { return values.map(() => '?').join(',') }
  private entity(table: string, id: string): Row { return asRow(this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)) }
  private meetingBinding(meetingId: string): Row { return asRow(this.db.prepare('SELECT * FROM meeting_agent_bindings WHERE meeting_id=?').get(meetingId)) }
  private expect(row: Row, expected?: number): number { const version = Number(row.version); if (expected === undefined || expected !== version) throw conflict('Entity version conflict', { currentVersion: version }); return version }
  private cursor(tenantId: string): number { return Number((this.db.prepare('SELECT COALESCE(MAX(id),0) AS value FROM change_events WHERE tenant_id=?').get(tenantId) as Row).value) }

  private record(actor: ActorView, entityType: string, entityId: string, action: string, version: number, data: unknown): CommandResult {
    const stamp = now()
    this.db.prepare('INSERT OR REPLACE INTO entity_versions(entity_type,entity_id,tenant_id,version,data_json,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(entityType, entityId, actor.tenantId, version, JSON.stringify(data), actor.id, stamp)
    this.db.prepare('INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,meta_json,occurred_at) VALUES(?,?,?,?,?,?,?)').run(actor.tenantId, actor.id, action, entityType, entityId, '{}', stamp)
    const cursor = Number(this.db.prepare('INSERT INTO change_events(tenant_id,entity_type,entity_id,operation,occurred_at) VALUES(?,?,?,?,?) RETURNING id').get(actor.tenantId, entityType, entityId, action, stamp)?.id)
    return { cursor, entityType, entityId, version, replayed: false }
  }

  private mapTeam(row: Row, role: AccessRole | null): TeamView { return { id: String(row.id), tenantId: String(row.tenant_id), parentId: nullable(row.parent_id), name: String(row.name), description: String(row.description), role: role ?? 'viewer', version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
  private mapTeamMember = (row: Row): TeamMemberView => ({ teamId: String(row.team_id), userId: String(row.user_id), role: row.role as AccessRole })
  private mapPerson = (row: Row): PersonView => ({ id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), email: nullable(row.email), department: nullable(row.department), title: nullable(row.title), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapProject = (row: Row): ProjectView => ({ id: String(row.id), tenantId: String(row.tenant_id), teamId: String(row.team_id), parentId: nullable(row.parent_id), key: String(row.project_key), name: String(row.name), description: String(row.description), color: String(row.color), role: row.role as AccessRole, version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapProjectMember = (row: Row): ProjectMemberView => ({ projectId: String(row.project_id), userId: String(row.user_id), role: row.role as AccessRole })
  private mapWorkflow = (row: Row): WorkflowStatusView => ({ id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), name: String(row.name), color: String(row.color), position: Number(row.position), category: row.category as WorkflowStatusView['category'], version: Number(row.version) })
  private mapField = (row: Row): TaskFieldDefinitionView => ({ id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), key: String(row.field_key), name: String(row.name), type: row.field_type as TaskFieldDefinitionView['type'], required: Boolean(row.required), options: parseJson<string[]>(row.options_json, []), position: Number(row.position), version: Number(row.version) })
  private mapView = (row: Row): SavedViewView => ({ id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), name: String(row.name), type: row.view_type as SavedViewView['type'], filters: parseJson(row.filters_json, {}), sorts: parseJson(row.sorts_json, []), groupBy: nullable(row.group_by), fields: parseJson(row.fields_json, []), version: Number(row.version) })
  private mapCategory = (row: Row): CategoryView => ({ id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), color: String(row.color), version: Number(row.version) })
  private mapTask = (row: Row): TaskView => ({ id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), sequence: Number(row.sequence), title: String(row.title), summary: String(row.summary), detail: String(row.detail), statusId: String(row.status_id), categoryId: nullable(row.category_id), assigneeId: nullable(row.assignee_id), priority: row.priority as TaskView['priority'], progress: Number(row.progress), dueAt: nullable(row.due_at), customData: parseJson(row.custom_json, {}), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapMeeting = (row: Row): MeetingView => ({ id: String(row.id), tenantId: String(row.tenant_id), teamId: String(row.team_id), title: String(row.title), status: row.status as MeetingView['status'], settings: parseJson(row.settings_json, DEFAULT_SETTINGS), transcript: String(row.transcript), summary: String(row.summary), decisions: parseJson(row.decisions_json, []), risks: parseJson(row.risks_json, []), startedAt: nullable(row.started_at), endedAt: nullable(row.ended_at), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapUtterance = (row: Row): MeetingUtteranceView => ({ id: String(row.id), meetingId: String(row.meeting_id), sequence: Number(row.sequence), speakerId: nullable(row.speaker_id), text: String(row.text), startedAt: nullable(row.started_at), endedAt: nullable(row.ended_at), createdAt: String(row.created_at) })
  private mapAiAction = (row: Row): MeetingAiActionView => ({ id: String(row.id), meetingId: String(row.meeting_id), callId: nullable(row.call_id), kind: row.kind as MeetingAiActionView['kind'], summary: String(row.summary), entityType: nullable(row.entity_type), entityId: nullable(row.entity_id), ok: Boolean(row.ok), createdAt: String(row.created_at) })
  private mapMeetingAgentBinding = (row: Row): MeetingAgentBindingView => ({ meetingId: String(row.meeting_id), sessionId: String(row.session_id), state: row.state as MeetingAgentBindingView['state'], deliveredSequence: Number(row.delivered_sequence), analyzedSequence: Number(row.analyzed_sequence), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapMeetingIntent = (row: Row): MeetingIntentView => ({ id: String(row.id), meetingId: String(row.meeting_id), intentKey: String(row.intent_key), kind: row.kind as MeetingIntentView['kind'], status: row.status as MeetingIntentView['status'], payload: parseJson<MeetingIntentPayload>(row.payload_json, { title: '' }), evidenceFromSequence: Number(row.evidence_from_sequence), evidenceToSequence: Number(row.evidence_to_sequence), revision: Number(row.revision), subagentId: nullable(row.subagent_id), entityType: nullable(row.entity_type), entityId: nullable(row.entity_id), error: nullable(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapLibrary = (row: Row): LibraryItemView => ({ id: String(row.id), tenantId: String(row.tenant_id), teamId: String(row.team_id), type: row.type as LibraryItemView['type'], title: String(row.title), content: String(row.content), url: nullable(row.url), categoryId: nullable(row.category_id), sourceMeetingId: nullable(row.source_meeting_id), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapEvent = (row: Row): CalendarEventView => ({ id: String(row.id), tenantId: String(row.tenant_id), projectId: nullable(row.project_id), type: row.type as CalendarEventView['type'], title: String(row.title), startAt: String(row.start_at), endAt: nullable(row.end_at), allDay: Boolean(row.all_day), ownerId: nullable(row.owner_id), attendeeIds: parseJson(row.attendee_ids_json, []), taskId: nullable(row.task_id), meetingId: nullable(row.meeting_id), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
  private mapTranscription = (row: Row): TranscriptionView => ({ id: String(row.id), meetingId: String(row.meeting_id), clientSegmentId: String(row.client_segment_id), state: row.state as TranscriptionView['state'], text: nullable(row.text), utteranceSequence: row.utterance_sequence === null || row.utterance_sequence === undefined ? null : Number(row.utterance_sequence), error: nullable(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
}
