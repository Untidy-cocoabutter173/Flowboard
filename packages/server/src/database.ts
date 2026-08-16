import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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
  migrate(db)
  seed(db, options)
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      email TEXT,
      department TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      parent_id TEXT REFERENCES teams(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      team_id TEXT NOT NULL REFERENCES teams(id),
      parent_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS projects_tenant_team ON projects(tenant_id, team_id, deleted_at);

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS board_columns (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      column_id TEXT NOT NULL REFERENCES board_columns(id),
      category_id TEXT REFERENCES categories(id),
      assignee_id TEXT REFERENCES users(id),
      priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
      progress REAL NOT NULL DEFAULT 0,
      due_at TEXT,
      custom_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(tenant_id, project_id, deleted_at);

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('idle','live','ended')),
      settings_json TEXT NOT NULL,
      transcript_file_id TEXT NOT NULL REFERENCES files(id),
      summary_file_id TEXT NOT NULL REFERENCES files(id),
      started_at TEXT,
      ended_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS meetings_project ON meetings(tenant_id, project_id, deleted_at);

    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      type TEXT NOT NULL CHECK (type IN ('doc','link')),
      title TEXT NOT NULL,
      file_id TEXT REFERENCES files(id),
      url TEXT,
      category_id TEXT REFERENCES categories(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS library_project ON library_items(tenant_id, project_id, deleted_at);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      type TEXT NOT NULL CHECK (type IN ('meeting','deadline','event','reminder')),
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT REFERENCES users(id),
      attendee_ids_json TEXT NOT NULL DEFAULT '[]',
      task_id TEXT REFERENCES tasks(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS events_project ON calendar_events(tenant_id, project_id, deleted_at);

    CREATE TABLE IF NOT EXISTS entity_versions (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, version)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS changes_tenant_cursor ON change_events(tenant_id, id);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );

    CREATE TABLE IF NOT EXISTS upload_tickets (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      content_type TEXT NOT NULL,
      expected_size INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcription_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      audio_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','processing','completed','failed')),
      text TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (1, datetime('now'));
  `)
}

function seed(db: DatabaseSync, options: DatabaseOptions): void {
  const now = new Date().toISOString()
  const actorName = options.actorName?.trim() || 'Local Owner'
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)')
      .run('tenant-local', 'Local Workspace', now)
    db.prepare('INSERT OR IGNORE INTO users(id,tenant_id,name,email,department,title,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('user-local', 'tenant-local', actorName, null, null, 'Owner', now)
    db.prepare('INSERT OR IGNORE INTO teams(id,tenant_id,parent_id,name,created_at) VALUES (?,?,?,?,?)')
      .run('team-local', 'tenant-local', null, 'Default Team', now)
    db.prepare('INSERT OR IGNORE INTO team_members(team_id,user_id,role,created_at) VALUES (?,?,?,?)')
      .run('team-local', 'user-local', 'owner', now)
    db.prepare('INSERT OR IGNORE INTO projects(id,tenant_id,team_id,parent_id,name,description,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('project-local', 'tenant-local', 'team-local', null, 'Default Project', '', 1, now, now)
    db.prepare('INSERT OR IGNORE INTO project_members(project_id,user_id,role,created_at) VALUES (?,?,?,?)')
      .run('project-local', 'user-local', 'owner', now)
    for (const [id, name, position] of [
      ['column-todo', '待办', 0], ['column-doing', '进行中', 1], ['column-done', '已完成', 2],
    ] as const) {
      db.prepare('INSERT OR IGNORE INTO board_columns(id,tenant_id,name,position,version) VALUES (?,?,?,?,1)')
        .run(id, 'tenant-local', name, position)
    }
    for (const [id, name, color] of [
      ['category-product', '产品', '#3370ff'], ['category-engineering', '研发', '#00a870'], ['category-operations', '运营', '#f79009'],
    ] as const) {
      db.prepare('INSERT OR IGNORE INTO categories(id,tenant_id,name,color,version) VALUES (?,?,?,?,1)')
        .run(id, 'tenant-local', name, color)
    }
    if (options.bootstrapToken !== undefined && options.bootstrapToken.length > 0) {
      db.prepare('INSERT OR IGNORE INTO api_tokens(token_hash,tenant_id,user_id,label,created_at) VALUES (?,?,?,?,?)')
        .run(tokenHash(options.bootstrapToken), 'tenant-local', 'user-local', 'bootstrap', now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
