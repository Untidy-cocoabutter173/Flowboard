import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 2

export interface DatabaseOptions {
  path: string
  bootstrapToken?: string
  actorName?: string
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function openDatabase(options: DatabaseOptions): DatabaseSync {
  if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true })
  const db = new DatabaseSync(options.path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  assertFreshOrV2(db)
  createSchema(db)
  seed(db, options)
  return db
}

function assertFreshOrV2(db: DatabaseSync): void {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get()
  if (table === undefined) return
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: number | null }
  if (Number(row.version ?? 0) !== SCHEMA_VERSION) {
    db.close()
    throw new Error(`Flowboard database schema ${String(row.version ?? 'unknown')} is unsupported; remove the development database and start with schema ${SCHEMA_VERSION}`)
  }
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, email TEXT,
      department TEXT, title TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(tenant_id,email)
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), parent_id TEXT REFERENCES teams(id),
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(tenant_id,name)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id), user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')), created_at TEXT NOT NULL,
      PRIMARY KEY(team_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), team_id TEXT NOT NULL REFERENCES teams(id),
      parent_id TEXT REFERENCES projects(id), project_key TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#4D6BFE', next_task_sequence INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      UNIQUE(tenant_id,project_key)
    );
    CREATE INDEX IF NOT EXISTS projects_team ON projects(tenant_id,team_id,deleted_at);
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')), created_at TEXT NOT NULL,
      PRIMARY KEY(project_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS workflow_statuses (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL, category TEXT NOT NULL CHECK(category IN ('backlog','active','done')),
      version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, UNIQUE(project_id,name)
    );
    CREATE TABLE IF NOT EXISTS task_field_definitions (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id),
      field_key TEXT NOT NULL, name TEXT NOT NULL, field_type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT, UNIQUE(project_id,field_key)
    );
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL, view_type TEXT NOT NULL CHECK(view_type IN ('board','table','calendar')),
      filters_json TEXT NOT NULL DEFAULT '{}', sorts_json TEXT NOT NULL DEFAULT '[]', group_by TEXT,
      fields_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, color TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, UNIQUE(tenant_id,name)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL REFERENCES projects(id),
      sequence INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
      status_id TEXT NOT NULL REFERENCES workflow_statuses(id), category_id TEXT REFERENCES categories(id), assignee_id TEXT REFERENCES users(id),
      priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','urgent')), progress REAL NOT NULL DEFAULT 0,
      due_at TEXT, custom_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(project_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(tenant_id,project_id,deleted_at);
    CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(tenant_id,assignee_id,deleted_at);
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), team_id TEXT NOT NULL REFERENCES teams(id),
      title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('scheduled','live','finalizing','ended','cancelled')),
      settings_json TEXT NOT NULL, transcript TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
      decisions_json TEXT NOT NULL DEFAULT '[]', risks_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, ended_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_meetings (
      project_id TEXT NOT NULL REFERENCES projects(id), meeting_id TEXT NOT NULL REFERENCES meetings(id), created_at TEXT NOT NULL,
      PRIMARY KEY(project_id,meeting_id)
    );
    CREATE TABLE IF NOT EXISTS meeting_utterances (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), sequence INTEGER NOT NULL,
      client_segment_id TEXT, speaker_id TEXT REFERENCES users(id), text TEXT NOT NULL, started_at TEXT, ended_at TEXT,
      created_at TEXT NOT NULL, UNIQUE(meeting_id,sequence), UNIQUE(meeting_id,client_segment_id)
    );
    CREATE TABLE IF NOT EXISTS meeting_ai_actions (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), call_id TEXT, kind TEXT NOT NULL,
      summary TEXT NOT NULL, entity_type TEXT, entity_id TEXT, ok INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      UNIQUE(meeting_id,call_id)
    );
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), team_id TEXT NOT NULL REFERENCES teams(id),
      type TEXT NOT NULL CHECK(type IN ('doc','link')), title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', url TEXT,
      category_id TEXT REFERENCES categories(id), source_meeting_id TEXT REFERENCES meetings(id), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_library_items (
      project_id TEXT NOT NULL REFERENCES projects(id), library_item_id TEXT NOT NULL REFERENCES library_items(id), created_at TEXT NOT NULL,
      PRIMARY KEY(project_id,library_item_id)
    );
    CREATE TABLE IF NOT EXISTS meeting_library_items (
      meeting_id TEXT NOT NULL REFERENCES meetings(id), library_item_id TEXT NOT NULL REFERENCES library_items(id), created_at TEXT NOT NULL,
      PRIMARY KEY(meeting_id,library_item_id)
    );
    CREATE TABLE IF NOT EXISTS task_meetings (
      task_id TEXT NOT NULL REFERENCES tasks(id), meeting_id TEXT NOT NULL REFERENCES meetings(id), created_at TEXT NOT NULL,
      PRIMARY KEY(task_id,meeting_id)
    );
    CREATE TABLE IF NOT EXISTS task_library_items (
      task_id TEXT NOT NULL REFERENCES tasks(id), library_item_id TEXT NOT NULL REFERENCES library_items(id), created_at TEXT NOT NULL,
      PRIMARY KEY(task_id,library_item_id)
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT REFERENCES projects(id),
      type TEXT NOT NULL CHECK(type IN ('meeting','deadline','event','reminder')), title TEXT NOT NULL, start_at TEXT NOT NULL,
      end_at TEXT, all_day INTEGER NOT NULL DEFAULT 0, owner_id TEXT REFERENCES users(id), attendee_ids_json TEXT NOT NULL DEFAULT '[]',
      task_id TEXT REFERENCES tasks(id), meeting_id TEXT REFERENCES meetings(id), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS events_owner ON calendar_events(tenant_id,owner_id,deleted_at,start_at);
    CREATE TABLE IF NOT EXISTS entity_versions (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, tenant_id TEXT NOT NULL, version INTEGER NOT NULL,
      data_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(entity_type,entity_id,version)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, meta_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, operation TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS changes_tenant_cursor ON change_events(tenant_id,id);
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      tenant_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,key)
    );
    CREATE TABLE IF NOT EXISTS upload_tickets (
      token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES meetings(id),
      client_segment_id TEXT NOT NULL, content_type TEXT NOT NULL, expected_size INTEGER NOT NULL, started_at TEXT, ended_at TEXT,
      expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcription_jobs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES meetings(id),
      client_segment_id TEXT NOT NULL, audio_path TEXT NOT NULL, started_at TEXT, ended_at TEXT,
      state TEXT NOT NULL CHECK(state IN ('pending','processing','completed','failed')), text TEXT, utterance_sequence INTEGER,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(meeting_id,client_segment_id)
    );
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,datetime('now'));
  `)
}

function seed(db: DatabaseSync, options: DatabaseOptions): void {
  const stamp = new Date().toISOString()
  const actorName = options.actorName?.trim() || 'Local Owner'
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES(?,?,?)').run('tenant-local', 'Local Workspace', stamp)
    db.prepare('INSERT OR IGNORE INTO users(id,tenant_id,name,email,department,title,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
      .run('user-local', 'tenant-local', actorName, null, null, 'Owner', stamp, stamp)
    db.prepare('INSERT OR IGNORE INTO teams(id,tenant_id,parent_id,name,description,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)')
      .run('team-local', 'tenant-local', null, 'Default Team', '', stamp, stamp)
    db.prepare('INSERT OR IGNORE INTO team_members(team_id,user_id,role,created_at) VALUES(?,?,?,?)').run('team-local', 'user-local', 'owner', stamp)
    db.prepare('INSERT OR IGNORE INTO projects(id,tenant_id,team_id,parent_id,project_key,name,description,color,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)')
      .run('project-local', 'tenant-local', 'team-local', null, 'FLOW', 'Default Project', '', '#4D6BFE', stamp, stamp)
    db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id,role,created_at) VALUES(?,?,?,?)').run('project-local', 'user-local', 'owner', stamp)
    for (const [id, name, color, position, category] of [
      ['status-backlog', '待办', '#8A8D93', 0, 'backlog'], ['status-active', '进行中', '#4D6BFE', 1, 'active'], ['status-done', '已完成', '#2B8A5A', 2, 'done'],
    ] as const) {
      db.prepare('INSERT OR IGNORE INTO workflow_statuses(id,tenant_id,project_id,name,color,position,category,version) VALUES(?,?,?,?,?,?,?,1)')
        .run(id, 'tenant-local', 'project-local', name, color, position, category)
    }
    for (const [id, name, type, groupBy, fields] of [
      ['view-board', '项目看板', 'board', 'status', ['title', 'priority', 'assigneeId', 'dueAt']],
      ['view-table', '任务表', 'table', null, ['sequence', 'title', 'status', 'priority', 'assigneeId', 'dueAt']],
    ] as const) {
      db.prepare('INSERT OR IGNORE INTO saved_views(id,tenant_id,project_id,name,view_type,filters_json,sorts_json,group_by,fields_json,version) VALUES(?,?,?,?,?,\'{}\',\'[]\',?,?,1)')
        .run(id, 'tenant-local', 'project-local', name, type, groupBy, JSON.stringify(fields))
    }
    for (const [id, name, color] of [['category-product', '产品', '#3370FF'], ['category-engineering', '研发', '#00A870'], ['category-operations', '运营', '#F79009']] as const) {
      db.prepare('INSERT OR IGNORE INTO categories(id,tenant_id,name,color,version) VALUES(?,?,?,?,1)').run(id, 'tenant-local', name, color)
    }
    if (options.bootstrapToken !== undefined && options.bootstrapToken.length > 0) {
      db.prepare('INSERT OR IGNORE INTO api_tokens(token_hash,tenant_id,user_id,label,created_at) VALUES(?,?,?,?,?)')
        .run(tokenHash(options.bootstrapToken), 'tenant-local', 'user-local', 'bootstrap', stamp)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
