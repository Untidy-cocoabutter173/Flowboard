import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  API_VERSION,
  type AccessRole,
  type ActorView,
  type BoardColumnView,
  type CalendarEventView,
  type CategoryView,
  type ChangesResult,
  type CommandRequest,
  type CommandResult,
  type FlowboardSnapshot,
  MAX_UPLOAD_BYTES,
  type LibraryItemView,
  type MeetingSettings,
  type MeetingView,
  type PersonView,
  type ProjectMemberView,
  type ProjectView,
  type SnapshotRequest,
  type TaskView,
  type TeamView,
  type TranscriptionView,
  type UploadTicketRequest,
  type UploadTicketResult,
} from '@flowboard/contracts'
import { conflict, FlowboardError, forbidden, notFound } from './errors.ts'
import { tokenHash } from './database.ts'

// node:sqlite deliberately exposes selected columns as unknown. Repository
// mappers are the runtime boundary that converts them to contract values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

interface Access {
  project: Row
  role: AccessRole
}

const WRITE_ROLES: readonly AccessRole[] = ['owner', 'admin', 'member']
const ADMIN_ROLES: readonly AccessRole[] = ['owner', 'admin']
const DEFAULT_SETTINGS: MeetingSettings = { mode: 'feedback', answerQuestions: true, silenceSec: 3 }

function now(): string {
  return new Date().toISOString()
}

function asRow(value: unknown): Row {
  if (value === undefined) throw new Error('expected database row')
  return value as Row
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function numberValue(value: unknown): number {
  return Number(value)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return JSON.parse(value) as T
}

function requestHash(request: CommandRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

export class SqliteFlowboardRepository {
  readonly db: DatabaseSync
  readonly publicBaseUrl: string

  constructor(db: DatabaseSync, publicBaseUrl: string) {
    this.db = db
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '')
  }

  authenticate(token: string): ActorView {
    const row = this.db.prepare(`
      SELECT u.id, u.tenant_id, u.name, u.email
      FROM api_tokens t
      JOIN users u ON u.id = t.user_id AND u.tenant_id = t.tenant_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > ?)
    `).get(tokenHash(token), now()) as Row | undefined
    if (row === undefined) throw new FlowboardError('UNAUTHORIZED', 'Invalid or expired access token', 401)
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      name: String(row.name),
      email: nullableString(row.email),
    }
  }

  snapshot(actor: ActorView, request: SnapshotRequest): FlowboardSnapshot {
    if (request.projectId !== undefined) this.requireProject(actor, request.projectId, false)
    const teams = this.db.prepare(`
      SELECT t.*, tm.role FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE t.tenant_id = ? AND tm.user_id = ?
      ORDER BY t.name
    `).all(actor.tenantId, actor.id) as Row[]
    const projectRows = request.projectId === undefined
      ? this.db.prepare(`
          SELECT p.*, CASE
            WHEN tm.role IN ('owner','admin') THEN tm.role
            ELSE pm.role
          END AS role
          FROM projects p
          JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = ?
          LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
          WHERE p.tenant_id = ? AND p.deleted_at IS NULL
            AND (tm.role IN ('owner','admin') OR pm.role IS NOT NULL)
          ORDER BY p.name
        `).all(actor.id, actor.id, actor.tenantId) as Row[]
      : this.db.prepare(`
          SELECT p.*, CASE
            WHEN tm.role IN ('owner','admin') THEN tm.role
            ELSE pm.role
          END AS role
          FROM projects p
          JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = ?
          LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
          WHERE p.tenant_id = ? AND p.id = ? AND p.deleted_at IS NULL
        `).all(actor.id, actor.id, actor.tenantId, request.projectId) as Row[]
    const projectIds = projectRows.map(row => String(row.id))
    const scoped = this.scope(projectIds)
    const people = this.db.prepare(`
      SELECT * FROM users WHERE tenant_id = ? ORDER BY name
    `).all(actor.tenantId) as Row[]
    const projectMembers = projectIds.length === 0 ? [] : this.db.prepare(`
      SELECT project_id, user_id, role FROM project_members
      WHERE project_id IN (${scoped.placeholders})
      ORDER BY project_id, user_id
    `).all(...scoped.values) as Row[]
    const columns = this.db.prepare(`
      SELECT * FROM board_columns WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY position, name
    `).all(actor.tenantId) as Row[]
    const categories = this.db.prepare(`
      SELECT * FROM categories WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name
    `).all(actor.tenantId) as Row[]
    const tasks = projectIds.length === 0 ? [] : this.db.prepare(`
      SELECT * FROM tasks WHERE project_id IN (${scoped.placeholders}) AND deleted_at IS NULL ORDER BY updated_at DESC
    `).all(...scoped.values) as Row[]
    const meetings = projectIds.length === 0 ? [] : this.db.prepare(`
      SELECT m.*, tf.content AS transcript, sf.content AS summary
      FROM meetings m
      JOIN files tf ON tf.id = m.transcript_file_id
      JOIN files sf ON sf.id = m.summary_file_id
      WHERE m.project_id IN (${scoped.placeholders}) AND m.deleted_at IS NULL
      ORDER BY m.updated_at DESC
    `).all(...scoped.values) as Row[]
    const library = projectIds.length === 0 ? [] : this.db.prepare(`
      SELECT l.*, COALESCE(f.content, '') AS content
      FROM library_items l LEFT JOIN files f ON f.id = l.file_id
      WHERE l.project_id IN (${scoped.placeholders}) AND l.deleted_at IS NULL
      ORDER BY l.updated_at DESC
    `).all(...scoped.values) as Row[]
    const events = projectIds.length === 0 ? [] : this.db.prepare(`
      SELECT * FROM calendar_events
      WHERE project_id IN (${scoped.placeholders}) AND deleted_at IS NULL
      ORDER BY start_at, title
    `).all(...scoped.values) as Row[]
    return {
      apiVersion: API_VERSION,
      cursor: this.cursor(actor.tenantId),
      actor,
      teams: teams.map(this.mapTeam),
      people: people.map(this.mapPerson),
      projects: projectRows.map(this.mapProject),
      projectMembers: projectMembers.map(this.mapProjectMember),
      columns: columns.map(this.mapColumn),
      categories: categories.map(this.mapCategory),
      tasks: tasks.map(this.mapTask),
      meetings: meetings.map(this.mapMeeting),
      library: library.map(this.mapLibrary),
      events: events.map(this.mapEvent),
    }
  }

  execute(actor: ActorView, request: CommandRequest): CommandResult {
    const hash = requestHash(request)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare(`
        SELECT request_hash, response_json FROM idempotency_keys WHERE tenant_id = ? AND key = ?
      `).get(actor.tenantId, request.idempotencyKey) as Row | undefined
      if (existing !== undefined) {
        if (existing.request_hash !== hash) {
          throw conflict('Idempotency key was already used for a different command', { key: request.idempotencyKey })
        }
        const replay = parseJson<CommandResult>(existing.response_json, {
          cursor: this.cursor(actor.tenantId), entityType: 'unknown', entityId: 'unknown', version: 0, replayed: true,
        })
        this.db.exec('COMMIT')
        return { ...replay, replayed: true }
      }
      const result = this.executeCommand(actor, request)
      this.db.prepare(`
        INSERT INTO idempotency_keys(tenant_id,key,request_hash,response_json,created_at) VALUES (?,?,?,?,?)
      `).run(actor.tenantId, request.idempotencyKey, hash, JSON.stringify(result), now())
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
    this.requireProjectEntity(actor, 'meetings', request.meetingId, true)
    if (request.size > MAX_UPLOAD_BYTES) throw new FlowboardError('UPLOAD_TOO_LARGE', 'Audio upload exceeds 32 MiB', 413)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    this.db.prepare(`
      INSERT INTO upload_tickets(token_hash,tenant_id,user_id,meeting_id,content_type,expected_size,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(tokenHash(token), actor.tenantId, actor.id, request.meetingId, request.contentType, request.size, expiresAt, now())
    return {
      uploadUrl: `${this.publicBaseUrl}/v1/uploads/${encodeURIComponent(token)}`,
      expiresAt,
      maxBytes: MAX_UPLOAD_BYTES,
    }
  }

  consumeUploadTicket(token: string, actualSize: number, audioPath: string, contentType: string): string {
    const hash = tokenHash(token)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const ticket = this.db.prepare(`
        SELECT * FROM upload_tickets WHERE token_hash = ?
      `).get(hash) as Row | undefined
      if (ticket === undefined || ticket.used_at !== null || String(ticket.expires_at) <= now()) {
        throw new FlowboardError('UPLOAD_TICKET_INVALID', 'Upload ticket is invalid, expired, or already used', 401)
      }
      if (actualSize !== Number(ticket.expected_size) || actualSize > MAX_UPLOAD_BYTES) {
        throw new FlowboardError('UPLOAD_SIZE_MISMATCH', 'Uploaded audio size does not match the ticket', 400)
      }
      if (contentType !== String(ticket.content_type)) {
        throw new FlowboardError('UPLOAD_CONTENT_TYPE_MISMATCH', 'Uploaded audio content type does not match the ticket', 400)
      }
      const id = randomUUID()
      const at = now()
      this.db.prepare('UPDATE upload_tickets SET used_at = ? WHERE token_hash = ?').run(at, hash)
      this.db.prepare(`
        INSERT INTO transcription_jobs(id,tenant_id,user_id,meeting_id,audio_path,state,created_at,updated_at)
        VALUES (?,?,?,?,?,'pending',?,?)
      `).run(id, ticket.tenant_id, ticket.user_id, ticket.meeting_id, audioPath, at, at)
      this.db.exec('COMMIT')
      return id
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  transcription(actor: ActorView, jobId: string): TranscriptionView {
    const row = this.db.prepare(`
      SELECT * FROM transcription_jobs WHERE id = ? AND tenant_id = ?
    `).get(jobId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('transcription job', jobId)
    this.requireProjectEntity(actor, 'meetings', String(row.meeting_id), false)
    return this.mapTranscription(row)
  }

  claimTranscription(): TranscriptionView & { audioPath: string; userId: string; tenantId: string } | undefined {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare(`
        SELECT * FROM transcription_jobs WHERE state = 'pending' ORDER BY created_at LIMIT 1
      `).get() as Row | undefined
      if (row === undefined) {
        this.db.exec('COMMIT')
        return undefined
      }
      const at = now()
      this.db.prepare(`UPDATE transcription_jobs SET state = 'processing', updated_at = ? WHERE id = ? AND state = 'pending'`)
        .run(at, row.id)
      this.db.exec('COMMIT')
      return {
        ...this.mapTranscription({ ...row, state: 'processing', updated_at: at }),
        audioPath: String(row.audio_path),
        userId: String(row.user_id),
        tenantId: String(row.tenant_id),
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  finishTranscription(jobId: string, text: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const job = this.db.prepare(`SELECT * FROM transcription_jobs WHERE id = ? AND state = 'processing'`).get(jobId) as Row | undefined
      if (job === undefined) throw notFound('processing transcription job', jobId)
      const meeting = asRow(this.db.prepare(`SELECT * FROM meetings WHERE id = ? AND deleted_at IS NULL`).get(job.meeting_id))
      const stamp = now()
      const currentFile = asRow(this.db.prepare('SELECT content, version FROM files WHERE id = ?').get(meeting.transcript_file_id))
      const line = `\n[${stamp}] 转写\n${text.trim()}\n`
      this.db.prepare('UPDATE files SET content = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(String(currentFile.content) + line, stamp, meeting.transcript_file_id)
      this.db.prepare('UPDATE meetings SET version = version + 1, updated_at = ? WHERE id = ?').run(stamp, meeting.id)
      this.db.prepare(`UPDATE transcription_jobs SET state = 'completed', text = ?, error = NULL, updated_at = ? WHERE id = ?`)
        .run(text, stamp, jobId)
      const updated = asRow(this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meeting.id))
      const cursor = this.recordMutation(
        { id: String(job.user_id), tenantId: String(job.tenant_id), name: 'Transcription Worker', email: null },
        'meeting', String(meeting.id), 'meeting.transcript.append', updated,
      )
      void cursor
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  failTranscription(jobId: string, message: string): void {
    this.db.prepare(`UPDATE transcription_jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .run(message.slice(0, 4_000), now(), jobId)
  }

  private executeCommand(actor: ActorView, request: CommandRequest): CommandResult {
    switch (request.type) {
      case 'person.create': return this.createPerson(actor, request)
      case 'project.create': return this.createProject(actor, request)
      case 'project.update': return this.updateProject(actor, request)
      case 'project.delete': return this.deleteProject(actor, request)
      case 'project.member.set': return this.setProjectMember(actor, request)
      case 'column.create': return this.createColumn(actor, request)
      case 'column.update': return this.updateColumn(actor, request)
      case 'column.delete': return this.deleteColumn(actor, request)
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
      case 'meeting.summary.set': return this.setMeetingSummary(actor, request)
      case 'library.create': return this.createLibrary(actor, request)
      case 'library.update': return this.updateLibrary(actor, request)
      case 'library.delete': return this.deleteLibrary(actor, request)
      case 'event.create': return this.createEvent(actor, request)
      case 'event.update': return this.updateEvent(actor, request)
      case 'event.delete': return this.deleteEvent(actor, request)
    }
  }

  private createPerson(actor: ActorView, request: Extract<CommandRequest, { type: 'person.create' }>): CommandResult {
    this.requireTeamAdmin(actor, request.payload.teamId)
    const id = randomUUID()
    const stamp = now()
    this.db.prepare(`
      INSERT INTO users(id,tenant_id,name,email,department,title,created_at) VALUES (?,?,?,?,?,?,?)
    `).run(
      id, actor.tenantId, request.payload.name, request.payload.email ?? null,
      request.payload.department ?? null, request.payload.title ?? null, stamp,
    )
    this.db.prepare(`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES (?,?,?,?)`)
      .run(request.payload.teamId, id, request.payload.role ?? 'member', stamp)
    const row = asRow(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id))
    return this.result(actor, 'person', id, 'person.create', 1, row)
  }

  private createProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.create' }>): CommandResult {
    this.requireTeamAdmin(actor, request.payload.teamId)
    if (request.payload.parentId !== undefined) {
      const parent = this.db.prepare(`SELECT id FROM projects WHERE id = ? AND team_id = ? AND deleted_at IS NULL`)
        .get(request.payload.parentId, request.payload.teamId)
      if (parent === undefined) throw notFound('parent project', request.payload.parentId)
    }
    const id = randomUUID()
    const stamp = now()
    this.db.prepare(`
      INSERT INTO projects(id,tenant_id,team_id,parent_id,name,description,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)
    `).run(
      id, actor.tenantId, request.payload.teamId, request.payload.parentId ?? null,
      request.payload.name, request.payload.description ?? '', stamp, stamp,
    )
    this.db.prepare(`INSERT INTO project_members(project_id,user_id,role,created_at) VALUES (?,?,?,?)`)
      .run(id, actor.id, 'owner', stamp)
    return this.result(actor, 'project', id, 'project.create', 1, this.entityRow('projects', id))
  }

  private updateProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.update' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.id, true)
    const version = this.expectVersion(access.project, request.expectedVersion)
    const stamp = now()
    this.db.prepare(`
      UPDATE projects SET name = ?, description = ?, version = ?, updated_at = ? WHERE id = ?
    `).run(
      request.payload.name ?? access.project.name,
      request.payload.description ?? access.project.description,
      version + 1, stamp, request.payload.id,
    )
    return this.result(actor, 'project', request.payload.id, 'project.update', version + 1, this.entityRow('projects', request.payload.id))
  }

  private deleteProject(actor: ActorView, request: Extract<CommandRequest, { type: 'project.delete' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.id, true)
    const version = this.expectVersion(access.project, request.expectedVersion)
    const stamp = now()
    this.db.prepare(`UPDATE projects SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`)
      .run(stamp, version + 1, stamp, request.payload.id)
    for (const table of ['tasks', 'meetings', 'library_items', 'calendar_events'] as const) {
      this.db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`)
        .run(stamp, stamp, request.payload.id)
    }
    this.db.prepare(`UPDATE files SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`)
      .run(stamp, stamp, request.payload.id)
    return this.result(actor, 'project', request.payload.id, 'project.delete', version + 1, this.entityRow('projects', request.payload.id))
  }

  private setProjectMember(actor: ActorView, request: Extract<CommandRequest, { type: 'project.member.set' }>): CommandResult {
    const access = this.requireProject(actor, request.payload.projectId, true)
    const version = this.expectVersion(access.project, request.expectedVersion)
    const user = this.db.prepare(`SELECT id FROM users WHERE id = ? AND tenant_id = ?`).get(request.payload.userId, actor.tenantId)
    if (user === undefined) throw notFound('user', request.payload.userId)
    this.db.prepare(`
      INSERT INTO project_members(project_id,user_id,role,created_at) VALUES (?,?,?,?)
      ON CONFLICT(project_id,user_id) DO UPDATE SET role = excluded.role
    `).run(request.payload.projectId, request.payload.userId, request.payload.role, now())
    this.db.prepare(`UPDATE projects SET version = ?, updated_at = ? WHERE id = ?`)
      .run(version + 1, now(), request.payload.projectId)
    return this.result(actor, 'project', request.payload.projectId, 'project.member.set', version + 1, this.entityRow('projects', request.payload.projectId))
  }

  private createColumn(actor: ActorView, request: Extract<CommandRequest, { type: 'column.create' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const id = randomUUID()
    const position = Number((this.db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS value FROM board_columns WHERE tenant_id = ? AND deleted_at IS NULL`)
      .get(actor.tenantId) as Row).value)
    this.db.prepare(`INSERT INTO board_columns(id,tenant_id,name,position,version) VALUES (?,?,?,?,1)`)
      .run(id, actor.tenantId, request.payload.name, position)
    return this.result(actor, 'column', id, 'column.create', 1, this.entityRow('board_columns', id))
  }

  private updateColumn(actor: ActorView, request: Extract<CommandRequest, { type: 'column.update' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const row = this.tenantEntity(actor, 'board_columns', request.payload.id)
    const version = this.expectVersion(row, request.expectedVersion)
    this.db.prepare(`UPDATE board_columns SET name = ?, position = ?, version = ? WHERE id = ?`)
      .run(request.payload.name ?? row.name, request.payload.position ?? row.position, version + 1, request.payload.id)
    return this.result(actor, 'column', request.payload.id, 'column.update', version + 1, this.entityRow('board_columns', request.payload.id))
  }

  private deleteColumn(actor: ActorView, request: Extract<CommandRequest, { type: 'column.delete' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const row = this.tenantEntity(actor, 'board_columns', request.payload.id)
    const version = this.expectVersion(row, request.expectedVersion)
    const use = this.db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE column_id = ? AND deleted_at IS NULL`).get(request.payload.id) as Row
    if (Number(use.count) > 0) throw conflict('Column is still used by active tasks', { id: request.payload.id })
    this.db.prepare(`UPDATE board_columns SET deleted_at = ?, version = ? WHERE id = ?`).run(now(), version + 1, request.payload.id)
    return this.result(actor, 'column', request.payload.id, 'column.delete', version + 1, this.entityRow('board_columns', request.payload.id))
  }

  private createCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.create' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const id = randomUUID()
    this.db.prepare(`INSERT INTO categories(id,tenant_id,name,color,version) VALUES (?,?,?,?,1)`)
      .run(id, actor.tenantId, request.payload.name, request.payload.color ?? '#3370ff')
    return this.result(actor, 'category', id, 'category.create', 1, this.entityRow('categories', id))
  }

  private updateCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.update' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const row = this.tenantEntity(actor, 'categories', request.payload.id)
    const version = this.expectVersion(row, request.expectedVersion)
    this.db.prepare(`UPDATE categories SET name = ?, color = ?, version = ? WHERE id = ?`)
      .run(request.payload.name ?? row.name, request.payload.color ?? row.color, version + 1, request.payload.id)
    return this.result(actor, 'category', request.payload.id, 'category.update', version + 1, this.entityRow('categories', request.payload.id))
  }

  private deleteCategory(actor: ActorView, request: Extract<CommandRequest, { type: 'category.delete' }>): CommandResult {
    this.requireTenantAdmin(actor)
    const row = this.tenantEntity(actor, 'categories', request.payload.id)
    const version = this.expectVersion(row, request.expectedVersion)
    const use = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM tasks WHERE category_id = ? AND deleted_at IS NULL)
           + (SELECT COUNT(*) FROM library_items WHERE category_id = ? AND deleted_at IS NULL) AS count
    `).get(request.payload.id, request.payload.id) as Row
    if (Number(use.count) > 0) throw conflict('Category is still used by active content', { id: request.payload.id })
    this.db.prepare(`UPDATE categories SET deleted_at = ?, version = ? WHERE id = ?`).run(now(), version + 1, request.payload.id)
    return this.result(actor, 'category', request.payload.id, 'category.delete', version + 1, this.entityRow('categories', request.payload.id))
  }

  private createTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.create' }>): CommandResult {
    this.requireProject(actor, request.payload.projectId, false, true)
    const columnId = request.payload.columnId ?? String(asRow(this.db.prepare(`
      SELECT id FROM board_columns WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY position LIMIT 1
    `).get(actor.tenantId)).id)
    this.validateTenantReference(actor, 'board_columns', columnId)
    if (request.payload.categoryId !== undefined) this.validateTenantReference(actor, 'categories', request.payload.categoryId)
    if (request.payload.assigneeId !== undefined) this.validateUser(actor, request.payload.assigneeId)
    const id = randomUUID()
    const stamp = now()
    this.db.prepare(`
      INSERT INTO tasks(
        id,tenant_id,project_id,title,summary,detail,column_id,category_id,assignee_id,priority,progress,due_at,
        custom_json,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).run(
      id, actor.tenantId, request.payload.projectId, request.payload.title, request.payload.summary ?? '', request.payload.detail ?? '',
      columnId, request.payload.categoryId ?? null, request.payload.assigneeId ?? null, request.payload.priority ?? 'medium',
      request.payload.progress ?? 0, request.payload.dueAt ?? null, JSON.stringify(request.payload.customData ?? {}), stamp, stamp,
    )
    return this.result(actor, 'task', id, 'task.create', 1, this.entityRow('tasks', id))
  }

  private updateTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.update' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'tasks', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    if (request.payload.columnId !== undefined) this.validateTenantReference(actor, 'board_columns', request.payload.columnId)
    if (request.payload.categoryId !== undefined && request.payload.categoryId !== null) this.validateTenantReference(actor, 'categories', request.payload.categoryId)
    if (request.payload.assigneeId !== undefined && request.payload.assigneeId !== null) this.validateUser(actor, request.payload.assigneeId)
    const stamp = now()
    this.db.prepare(`
      UPDATE tasks SET title=?,summary=?,detail=?,column_id=?,category_id=?,assignee_id=?,priority=?,progress=?,due_at=?,
        custom_json=?,version=?,updated_at=? WHERE id=?
    `).run(
      request.payload.title ?? row.title, request.payload.summary ?? row.summary, request.payload.detail ?? row.detail,
      request.payload.columnId ?? row.column_id,
      request.payload.categoryId === undefined ? row.category_id : request.payload.categoryId,
      request.payload.assigneeId === undefined ? row.assignee_id : request.payload.assigneeId,
      request.payload.priority ?? row.priority, request.payload.progress ?? row.progress,
      request.payload.dueAt === undefined ? row.due_at : request.payload.dueAt,
      request.payload.customData === undefined ? row.custom_json : JSON.stringify(request.payload.customData),
      version + 1, stamp, request.payload.id,
    )
    return this.result(actor, 'task', request.payload.id, 'task.update', version + 1, this.entityRow('tasks', request.payload.id))
  }

  private deleteTask(actor: ActorView, request: Extract<CommandRequest, { type: 'task.delete' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'tasks', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    this.db.prepare(`UPDATE tasks SET deleted_at=?,version=?,updated_at=? WHERE id=?`)
      .run(now(), version + 1, now(), request.payload.id)
    return this.result(actor, 'task', request.payload.id, 'task.delete', version + 1, this.entityRow('tasks', request.payload.id))
  }

  private createMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.create' }>): CommandResult {
    this.requireProject(actor, request.payload.projectId, false, true)
    const id = randomUUID()
    const transcriptId = randomUUID()
    const summaryId = randomUUID()
    const stamp = now()
    const settingsValue = { ...DEFAULT_SETTINGS, ...request.payload.settings }
    this.db.prepare(`
      INSERT INTO files(id,tenant_id,project_id,kind,content,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)
    `).run(transcriptId, actor.tenantId, request.payload.projectId, 'meeting-transcript', `# ${request.payload.title} · 转录\n\n`, stamp, stamp)
    this.db.prepare(`
      INSERT INTO files(id,tenant_id,project_id,kind,content,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)
    `).run(summaryId, actor.tenantId, request.payload.projectId, 'meeting-summary', `# ${request.payload.title} · 总结\n\n`, stamp, stamp)
    this.db.prepare(`
      INSERT INTO meetings(
        id,tenant_id,project_id,title,status,settings_json,transcript_file_id,summary_file_id,version,created_at,updated_at
      ) VALUES (?,?,?,?,'idle',?,?,?,1,?,?)
    `).run(id, actor.tenantId, request.payload.projectId, request.payload.title, JSON.stringify(settingsValue), transcriptId, summaryId, stamp, stamp)
    return this.result(actor, 'meeting', id, 'meeting.create', 1, this.entityRow('meetings', id))
  }

  private updateMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.update' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'meetings', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    const currentSettings = parseJson<MeetingSettings>(row.settings_json, DEFAULT_SETTINGS)
    const nextSettings = { ...currentSettings, ...request.payload.settings }
    const nextStatus = request.payload.status ?? String(row.status)
    const stamp = now()
    const startedAt = nextStatus === 'live' ? nullableString(row.started_at) ?? stamp : nullableString(row.started_at)
    const endedAt = nextStatus === 'ended' ? stamp : nullableString(row.ended_at)
    this.db.prepare(`
      UPDATE meetings SET title=?,status=?,settings_json=?,started_at=?,ended_at=?,version=?,updated_at=? WHERE id=?
    `).run(
      request.payload.title ?? row.title, nextStatus, JSON.stringify(nextSettings), startedAt, endedAt,
      version + 1, stamp, request.payload.id,
    )
    return this.result(actor, 'meeting', request.payload.id, 'meeting.update', version + 1, this.entityRow('meetings', request.payload.id))
  }

  private deleteMeeting(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.delete' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'meetings', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    const stamp = now()
    this.db.prepare(`UPDATE meetings SET deleted_at=?,version=?,updated_at=? WHERE id=?`)
      .run(stamp, version + 1, stamp, request.payload.id)
    this.db.prepare(`UPDATE files SET deleted_at=?,updated_at=? WHERE id IN (?,?)`)
      .run(stamp, stamp, row.transcript_file_id, row.summary_file_id)
    return this.result(actor, 'meeting', request.payload.id, 'meeting.delete', version + 1, this.entityRow('meetings', request.payload.id))
  }

  private appendTranscript(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.transcript.append' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'meetings', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    let speaker = actor.name
    if (request.payload.speakerId !== undefined) {
      const person = this.db.prepare(`SELECT name FROM users WHERE id=? AND tenant_id=?`).get(request.payload.speakerId, actor.tenantId) as Row | undefined
      if (person === undefined) throw notFound('speaker', request.payload.speakerId)
      speaker = String(person.name)
    }
    const stamp = now()
    const file = asRow(this.db.prepare(`SELECT content FROM files WHERE id=? AND deleted_at IS NULL`).get(row.transcript_file_id))
    const content = `${String(file.content)}\n[${stamp}] ${speaker}\n${request.payload.text.trim()}\n`
    this.db.prepare(`UPDATE files SET content=?,version=version+1,updated_at=? WHERE id=?`)
      .run(content, stamp, row.transcript_file_id)
    this.db.prepare(`UPDATE meetings SET version=?,updated_at=? WHERE id=?`).run(version + 1, stamp, request.payload.id)
    return this.result(actor, 'meeting', request.payload.id, 'meeting.transcript.append', version + 1, this.entityRow('meetings', request.payload.id))
  }

  private setMeetingSummary(actor: ActorView, request: Extract<CommandRequest, { type: 'meeting.summary.set' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'meetings', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    const stamp = now()
    this.db.prepare(`UPDATE files SET content=?,version=version+1,updated_at=? WHERE id=?`)
      .run(request.payload.content, stamp, row.summary_file_id)
    this.db.prepare(`UPDATE meetings SET version=?,updated_at=? WHERE id=?`).run(version + 1, stamp, request.payload.id)
    return this.result(actor, 'meeting', request.payload.id, 'meeting.summary.set', version + 1, this.entityRow('meetings', request.payload.id))
  }

  private createLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.create' }>): CommandResult {
    this.requireProject(actor, request.payload.projectId, false, true)
    if (request.payload.categoryId !== undefined) this.validateTenantReference(actor, 'categories', request.payload.categoryId)
    if (request.payload.type === 'link' && (request.payload.url === undefined || request.payload.url.trim().length === 0)) {
      throw new FlowboardError('VALIDATION_ERROR', 'A link library item requires a URL')
    }
    const id = randomUUID()
    const fileId = request.payload.type === 'doc' ? randomUUID() : null
    const stamp = now()
    if (fileId !== null) {
      this.db.prepare(`
        INSERT INTO files(id,tenant_id,project_id,kind,content,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)
      `).run(fileId, actor.tenantId, request.payload.projectId, 'library-document', request.payload.content ?? '', stamp, stamp)
    }
    this.db.prepare(`
      INSERT INTO library_items(id,tenant_id,project_id,type,title,file_id,url,category_id,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)
    `).run(
      id, actor.tenantId, request.payload.projectId, request.payload.type, request.payload.title,
      fileId, request.payload.url ?? null, request.payload.categoryId ?? null, stamp, stamp,
    )
    return this.result(actor, 'library', id, 'library.create', 1, this.entityRow('library_items', id))
  }

  private updateLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.update' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'library_items', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    if (request.payload.categoryId !== undefined && request.payload.categoryId !== null) this.validateTenantReference(actor, 'categories', request.payload.categoryId)
    const stamp = now()
    if (request.payload.content !== undefined) {
      if (row.file_id === null) throw conflict('Link items do not own document content')
      this.db.prepare(`UPDATE files SET content=?,version=version+1,updated_at=? WHERE id=?`)
        .run(request.payload.content, stamp, row.file_id)
    }
    this.db.prepare(`
      UPDATE library_items SET title=?,url=?,category_id=?,version=?,updated_at=? WHERE id=?
    `).run(
      request.payload.title ?? row.title,
      request.payload.url === undefined ? row.url : request.payload.url,
      request.payload.categoryId === undefined ? row.category_id : request.payload.categoryId,
      version + 1, stamp, request.payload.id,
    )
    return this.result(actor, 'library', request.payload.id, 'library.update', version + 1, this.entityRow('library_items', request.payload.id))
  }

  private deleteLibrary(actor: ActorView, request: Extract<CommandRequest, { type: 'library.delete' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'library_items', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    const stamp = now()
    this.db.prepare(`UPDATE library_items SET deleted_at=?,version=?,updated_at=? WHERE id=?`)
      .run(stamp, version + 1, stamp, request.payload.id)
    if (row.file_id !== null) this.db.prepare(`UPDATE files SET deleted_at=?,updated_at=? WHERE id=?`).run(stamp, stamp, row.file_id)
    return this.result(actor, 'library', request.payload.id, 'library.delete', version + 1, this.entityRow('library_items', request.payload.id))
  }

  private createEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.create' }>): CommandResult {
    this.requireProject(actor, request.payload.projectId, false, true)
    if (request.payload.ownerId !== undefined) this.validateUser(actor, request.payload.ownerId)
    for (const attendeeId of request.payload.attendeeIds ?? []) this.validateUser(actor, attendeeId)
    const id = randomUUID()
    const stamp = now()
    this.db.prepare(`
      INSERT INTO calendar_events(
        id,tenant_id,project_id,type,title,start_at,end_at,all_day,owner_id,attendee_ids_json,task_id,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).run(
      id, actor.tenantId, request.payload.projectId, request.payload.type, request.payload.title, request.payload.startAt,
      request.payload.endAt ?? null, request.payload.allDay ? 1 : 0, request.payload.ownerId ?? actor.id,
      JSON.stringify(request.payload.attendeeIds ?? []), request.payload.taskId ?? null, stamp, stamp,
    )
    return this.result(actor, 'event', id, 'event.create', 1, this.entityRow('calendar_events', id))
  }

  private updateEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.update' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'calendar_events', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    if (request.payload.ownerId !== undefined && request.payload.ownerId !== null) this.validateUser(actor, request.payload.ownerId)
    for (const attendeeId of request.payload.attendeeIds ?? []) this.validateUser(actor, attendeeId)
    const stamp = now()
    this.db.prepare(`
      UPDATE calendar_events SET type=?,title=?,start_at=?,end_at=?,all_day=?,owner_id=?,attendee_ids_json=?,task_id=?,
        version=?,updated_at=? WHERE id=?
    `).run(
      request.payload.type ?? row.type, request.payload.title ?? row.title, request.payload.startAt ?? row.start_at,
      request.payload.endAt === undefined ? row.end_at : request.payload.endAt,
      request.payload.allDay === undefined ? row.all_day : request.payload.allDay ? 1 : 0,
      request.payload.ownerId === undefined ? row.owner_id : request.payload.ownerId,
      request.payload.attendeeIds === undefined ? row.attendee_ids_json : JSON.stringify(request.payload.attendeeIds),
      request.payload.taskId === undefined ? row.task_id : request.payload.taskId,
      version + 1, stamp, request.payload.id,
    )
    return this.result(actor, 'event', request.payload.id, 'event.update', version + 1, this.entityRow('calendar_events', request.payload.id))
  }

  private deleteEvent(actor: ActorView, request: Extract<CommandRequest, { type: 'event.delete' }>): CommandResult {
    const row = this.requireProjectEntity(actor, 'calendar_events', request.payload.id, true)
    const version = this.expectVersion(row, request.expectedVersion)
    this.db.prepare(`UPDATE calendar_events SET deleted_at=?,version=?,updated_at=? WHERE id=?`)
      .run(now(), version + 1, now(), request.payload.id)
    return this.result(actor, 'event', request.payload.id, 'event.delete', version + 1, this.entityRow('calendar_events', request.payload.id))
  }

  private scope(ids: string[]): { placeholders: string; values: string[] } {
    return { placeholders: ids.map(() => '?').join(','), values: ids }
  }

  private cursor(tenantId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM change_events WHERE tenant_id = ?')
      .get(tenantId) as Row
    return Number(row.cursor)
  }

  private readonly mapTeam = (row: Row): TeamView => ({
    id: String(row.id), tenantId: String(row.tenant_id), parentId: nullableString(row.parent_id),
    name: String(row.name), role: String(row.role) as AccessRole, createdAt: String(row.created_at),
  })

  private readonly mapPerson = (row: Row): PersonView => ({
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), email: nullableString(row.email),
    department: nullableString(row.department), title: nullableString(row.title), createdAt: String(row.created_at),
  })

  private readonly mapProject = (row: Row): ProjectView => ({
    id: String(row.id), tenantId: String(row.tenant_id), teamId: String(row.team_id), parentId: nullableString(row.parent_id),
    name: String(row.name), description: String(row.description), role: String(row.role) as AccessRole,
    version: numberValue(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private readonly mapProjectMember = (row: Row): ProjectMemberView => ({
    projectId: String(row.project_id), userId: String(row.user_id), role: String(row.role) as AccessRole,
  })

  private readonly mapColumn = (row: Row): BoardColumnView => ({
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name),
    position: numberValue(row.position), version: numberValue(row.version),
  })

  private readonly mapCategory = (row: Row): CategoryView => ({
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name),
    color: String(row.color), version: numberValue(row.version),
  })

  private readonly mapTask = (row: Row): TaskView => ({
    id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), title: String(row.title),
    summary: String(row.summary), detail: String(row.detail), columnId: String(row.column_id),
    categoryId: nullableString(row.category_id), assigneeId: nullableString(row.assignee_id),
    priority: String(row.priority) as TaskView['priority'], progress: numberValue(row.progress),
    dueAt: nullableString(row.due_at), customData: parseJson(row.custom_json, {}), version: numberValue(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private readonly mapMeeting = (row: Row): MeetingView => ({
    id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id), title: String(row.title),
    status: String(row.status) as MeetingView['status'], settings: parseJson(row.settings_json, DEFAULT_SETTINGS),
    transcript: String(row.transcript ?? ''), summary: String(row.summary ?? ''),
    startedAt: nullableString(row.started_at), endedAt: nullableString(row.ended_at), version: numberValue(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private readonly mapLibrary = (row: Row): LibraryItemView => ({
    id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id),
    type: String(row.type) as LibraryItemView['type'], title: String(row.title), content: String(row.content ?? ''),
    url: nullableString(row.url), categoryId: nullableString(row.category_id), version: numberValue(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private readonly mapEvent = (row: Row): CalendarEventView => ({
    id: String(row.id), tenantId: String(row.tenant_id), projectId: String(row.project_id),
    type: String(row.type) as CalendarEventView['type'], title: String(row.title), startAt: String(row.start_at),
    endAt: nullableString(row.end_at), allDay: Number(row.all_day) === 1, ownerId: nullableString(row.owner_id),
    attendeeIds: parseJson(row.attendee_ids_json, []), taskId: nullableString(row.task_id), version: numberValue(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private readonly mapTranscription = (row: Row): TranscriptionView => ({
    id: String(row.id), meetingId: String(row.meeting_id), state: String(row.state) as TranscriptionView['state'],
    text: nullableString(row.text), error: nullableString(row.error),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })

  private requireTeamAdmin(actor: ActorView, teamId: string): void {
    const row = this.db.prepare(`
      SELECT tm.role FROM teams t JOIN team_members tm ON tm.team_id=t.id
      WHERE t.id=? AND t.tenant_id=? AND tm.user_id=?
    `).get(teamId, actor.tenantId, actor.id) as Row | undefined
    if (row === undefined) throw notFound('team', teamId)
    if (!ADMIN_ROLES.includes(String(row.role) as AccessRole)) throw forbidden('Team admin access is required')
  }

  private requireTenantAdmin(actor: ActorView): void {
    const row = this.db.prepare(`
      SELECT 1 FROM teams t JOIN team_members tm ON tm.team_id=t.id
      WHERE t.tenant_id=? AND tm.user_id=? AND tm.role IN ('owner','admin') LIMIT 1
    `).get(actor.tenantId, actor.id)
    if (row === undefined) throw forbidden('Tenant admin access is required')
  }

  private requireProject(actor: ActorView, projectId: string, admin = false, write = false): Access {
    const row = this.db.prepare(`
      SELECT p.*, tm.role AS team_role, pm.role AS project_role
      FROM projects p
      JOIN team_members tm ON tm.team_id=p.team_id AND tm.user_id=?
      LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=?
      WHERE p.id=? AND p.tenant_id=? AND p.deleted_at IS NULL
        AND (tm.role IN ('owner','admin') OR pm.role IS NOT NULL)
    `).get(actor.id, actor.id, projectId, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound('project', projectId)
    const teamRole = String(row.team_role) as AccessRole
    const role = ADMIN_ROLES.includes(teamRole) ? teamRole : String(row.project_role) as AccessRole
    if (admin && !ADMIN_ROLES.includes(role)) throw forbidden('Project admin access is required')
    if (write && !WRITE_ROLES.includes(role)) throw forbidden('Project write access is required')
    return { project: row, role }
  }

  private requireProjectEntity(
    actor: ActorView,
    table: 'tasks' | 'meetings' | 'library_items' | 'calendar_events',
    id: string,
    write: boolean,
  ): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND deleted_at IS NULL`)
      .get(id, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound(table, id)
    this.requireProject(actor, String(row.project_id), false, write)
    return row
  }

  private validateTenantReference(actor: ActorView, table: 'board_columns' | 'categories', id: string): void {
    const row = this.db.prepare(`SELECT id FROM ${table} WHERE id=? AND tenant_id=? AND deleted_at IS NULL`)
      .get(id, actor.tenantId)
    if (row === undefined) throw notFound(table, id)
  }

  private validateUser(actor: ActorView, id: string): void {
    const row = this.db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(id, actor.tenantId)
    if (row === undefined) throw notFound('user', id)
  }

  private tenantEntity(actor: ActorView, table: 'board_columns' | 'categories', id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND deleted_at IS NULL`)
      .get(id, actor.tenantId) as Row | undefined
    if (row === undefined) throw notFound(table, id)
    return row
  }

  private entityRow(
    table: 'projects' | 'board_columns' | 'categories' | 'tasks' | 'meetings' | 'library_items' | 'calendar_events',
    id: string,
  ): Row {
    return asRow(this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id))
  }

  private expectVersion(row: Row, expected: number | undefined): number {
    const current = numberValue(row.version)
    if (expected === undefined) throw conflict('expectedVersion is required for this command', { currentVersion: current })
    if (expected !== current) throw conflict('Entity version does not match', { expectedVersion: expected, currentVersion: current })
    return current
  }

  private result(
    actor: ActorView,
    entityType: string,
    entityId: string,
    operation: string,
    version: number,
    row: Row,
  ): CommandResult {
    return { cursor: this.recordMutation(actor, entityType, entityId, operation, row, version), entityType, entityId, version, replayed: false }
  }

  private recordMutation(
    actor: ActorView,
    entityType: string,
    entityId: string,
    operation: string,
    row: Row,
    explicitVersion?: number,
  ): number {
    const stamp = now()
    const version = explicitVersion ?? numberValue(row.version ?? 1)
    this.db.prepare(`
      INSERT INTO entity_versions(entity_type,entity_id,tenant_id,version,data_json,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(entityType, entityId, actor.tenantId, version, JSON.stringify(row), actor.id, stamp)
    this.db.prepare(`
      INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,meta_json,occurred_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(actor.tenantId, actor.id, operation, entityType, entityId, JSON.stringify({ version }), stamp)
    const result = this.db.prepare(`
      INSERT INTO change_events(tenant_id,entity_type,entity_id,operation,occurred_at) VALUES (?,?,?,?,?)
    `).run(actor.tenantId, entityType, entityId, operation, stamp)
    return Number(result.lastInsertRowid)
  }
}
