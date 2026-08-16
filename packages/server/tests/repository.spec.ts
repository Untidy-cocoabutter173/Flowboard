import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, tokenHash } from '../src/database.ts'
import { SqliteFlowboardRepository } from '../src/repository.ts'
import type { DatabaseSync } from 'node:sqlite'

describe('SqliteFlowboardRepository', () => {
  let db: DatabaseSync
  let repository: SqliteFlowboardRepository

  beforeEach(() => {
    db = openDatabase({ path: ':memory:', bootstrapToken: 'test-token', actorName: '测试负责人' })
    repository = new SqliteFlowboardRepository(db, 'http://localhost:8787')
  })
  afterEach(() => db.close())

  it('鉴权后返回当前租户快照', () => {
    expect(() => repository.authenticate('wrong-token')).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }))
    const actor = repository.authenticate('test-token')
    const snapshot = repository.snapshot(actor, {})
    expect(snapshot.actor.name).toBe('测试负责人')
    expect(snapshot.projects.map(project => project.id)).toEqual(['project-local'])
    expect(snapshot.columns).toHaveLength(3)
  })

  it('同一幂等命令只执行一次，复用键发送不同命令会冲突', () => {
    const actor = repository.authenticate('test-token')
    const request = { idempotencyKey: 'task-create-0001', type: 'task.create' as const, payload: { projectId: 'project-local', title: '发布检查' } }
    const created = repository.execute(actor, request)
    const replayed = repository.execute(actor, request)
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(repository.snapshot(actor, {}).tasks).toHaveLength(1)
    expect(() => repository.execute(actor, { ...request, payload: { ...request.payload, title: '另一个任务' } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('更新必须携带当前版本，并记录版本、审计和变更游标', () => {
    const actor = repository.authenticate('test-token')
    const created = repository.execute(actor, { idempotencyKey: 'task-create-0002', type: 'task.create', payload: { projectId: 'project-local', title: '契约测试' } })
    expect(() => repository.execute(actor, { idempotencyKey: 'task-update-no-version', type: 'task.update', payload: { id: created.entityId, title: '缺少版本' } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => repository.execute(actor, { idempotencyKey: 'task-update-old-version', type: 'task.update', expectedVersion: 9, payload: { id: created.entityId, title: '旧版本' } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    const updated = repository.execute(actor, { idempotencyKey: 'task-update-current', type: 'task.update', expectedVersion: 1, payload: { id: created.entityId, title: '已更新' } })
    expect(updated.version).toBe(2)
    expect(repository.changes(actor, created.cursor)).toEqual({ cursor: updated.cursor, changed: true })
    expect(Number((db.prepare('SELECT COUNT(*) AS value FROM entity_versions WHERE entity_id=?').get(created.entityId) as { value: number }).value)).toBe(2)
    expect(Number((db.prepare('SELECT COUNT(*) AS value FROM audit_events WHERE entity_id=?').get(created.entityId) as { value: number }).value)).toBe(2)
  })

  it('租户之间不能读取项目', () => {
    const stamp = new Date().toISOString()
    db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('tenant-other', '其他租户', stamp)
    db.prepare('INSERT INTO users(id,tenant_id,name,created_at) VALUES (?,?,?,?)').run('user-other', 'tenant-other', '其他用户', stamp)
    db.prepare('INSERT INTO api_tokens(token_hash,tenant_id,user_id,label,created_at) VALUES (?,?,?,?,?)').run(tokenHash('other-token'), 'tenant-other', 'user-other', 'test', stamp)
    const other = repository.authenticate('other-token')
    expect(repository.snapshot(other, {}).projects).toEqual([])
    expect(() => repository.snapshot(other, { projectId: 'project-local' })).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
})
