import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/database.ts'

describe('Flowboard database schema', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('检测到旧 schema 时拒绝启动且不执行迁移', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flowboard-schema-'))
    directories.push(directory)
    const path = join(directory, 'flowboard.db')
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,\'2026-01-01T00:00:00Z\')')
    old.close()
    expect(() => openDatabase({ path })).toThrow(/schema 1 is unsupported; remove the development database/)
  })
})
