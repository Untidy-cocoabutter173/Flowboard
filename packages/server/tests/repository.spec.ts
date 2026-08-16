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
    expect(snapshot.apiVersion).toBe(2)
    expect(snapshot.workflowStatuses).toHaveLength(3)
    expect(snapshot.savedViews.map(view => view.type).sort()).toEqual(['board', 'table'])
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

  it('会议范围快照只返回关联项目，summary 使用聚合计数', () => {
    const actor = repository.authenticate('test-token')
    repository.execute(actor, { idempotencyKey: 'project-create-second', type: 'project.create', payload: { teamId: 'team-local', key: 'NEXT', name: '第二项目' } })
    const meeting = repository.execute(actor, { idempotencyKey: 'meeting-create-scoped', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '范围会议' } })
    expect(repository.snapshot(actor, { meetingId: meeting.entityId }).projects.map(project => project.id)).toEqual(['project-local'])
    expect(repository.summary(actor).counts).toMatchObject({ projects: 2, meetings: 1, tasks: 0, documents: 0, people: 1 })
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
    db.prepare('INSERT INTO users(id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('user-other', 'tenant-other', '其他用户', stamp, stamp)
    db.prepare('INSERT INTO api_tokens(token_hash,tenant_id,user_id,label,created_at) VALUES (?,?,?,?,?)').run(tokenHash('other-token'), 'tenant-other', 'user-other', 'test', stamp)
    const other = repository.authenticate('other-token')
    expect(repository.snapshot(other, {}).projects).toEqual([])
    expect(() => repository.snapshot(other, { projectId: 'project-local' })).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('多维字段支持多选、改类型清值，负责人必须属于项目', () => {
    const actor = repository.authenticate('test-token')
    const person = repository.execute(actor, { idempotencyKey: 'person-for-fields', type: 'person.create', payload: { teamId: 'team-local', name: '周宁' } })
    const field = repository.execute(actor, { idempotencyKey: 'field-create-channels', type: 'field.create', payload: { projectId: 'project-local', key: 'channels', name: '发布渠道', fieldType: 'multi_select', options: ['Web', 'App'] } })
    expect(() => repository.execute(actor, { idempotencyKey: 'task-before-membership', type: 'task.create', payload: { projectId: 'project-local', title: '渠道验收', assigneeId: person.entityId, customData: { channels: ['Web'] } } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    repository.execute(actor, { idempotencyKey: 'project-member-add', type: 'project.member.set', payload: { projectId: 'project-local', userId: person.entityId, role: 'member' } })
    const task = repository.execute(actor, { idempotencyKey: 'task-after-membership', type: 'task.create', payload: { projectId: 'project-local', title: '渠道验收', assigneeId: person.entityId, customData: { channels: ['Web', 'App'] } } })
    expect(repository.snapshot(actor, {}).tasks.find(item => item.id === task.entityId)?.customData.channels).toEqual(['Web', 'App'])
    repository.execute(actor, { idempotencyKey: 'field-change-type', type: 'field.update', expectedVersion: 1, payload: { id: field.entityId, fieldType: 'date' } })
    const changed = repository.snapshot(actor, {})
    expect(changed.fieldDefinitions.find(item => item.id === field.entityId)?.type).toBe('date')
    expect(changed.tasks.find(item => item.id === task.entityId)?.customData.channels).toBeUndefined()
    repository.execute(actor, { idempotencyKey: 'project-member-remove', type: 'project.member.remove', payload: { projectId: 'project-local', userId: person.entityId } })
    expect(repository.snapshot(actor, {}).projectMembers.map(item => item.userId)).not.toContain(person.entityId)
    expect(() => repository.execute(actor, { idempotencyKey: 'last-owner-remove', type: 'project.member.remove', payload: { projectId: 'project-local', userId: actor.id } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('会议转录稿和 Markdown 总结可以人工修订', () => {
    const actor = repository.authenticate('test-token')
    const meeting = repository.execute(actor, { idempotencyKey: 'meeting-markdown-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '设计评审' } })
    repository.execute(actor, { idempotencyKey: 'meeting-markdown-update', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, transcript: '# 转录\n确认范围', summary: '## 总结\n按计划推进' } })
    expect(repository.snapshot(actor, {}).meetings.find(item => item.id === meeting.entityId)).toMatchObject({ transcript: '# 转录\n确认范围', summary: '## 总结\n按计划推进', version: 2 })
  })

  it('团队管理员可以管理成员角色，移出团队同时清理项目成员关系', () => {
    const actor = repository.authenticate('test-token')
    const person = repository.execute(actor, { idempotencyKey: 'team-person-create', type: 'person.create', payload: { teamId: 'team-local', name: '团队成员' } })
    repository.execute(actor, { idempotencyKey: 'team-person-project', type: 'project.member.set', payload: { projectId: 'project-local', userId: person.entityId, role: 'member' } })
    repository.execute(actor, { idempotencyKey: 'team-person-admin', type: 'team.member.set', payload: { teamId: 'team-local', userId: person.entityId, role: 'admin' } })
    expect(repository.snapshot(actor, {}).teamMembers.find(item => item.userId === person.entityId)?.role).toBe('admin')
    repository.execute(actor, { idempotencyKey: 'team-person-remove', type: 'team.member.remove', payload: { teamId: 'team-local', userId: person.entityId } })
    const snapshot = repository.snapshot(actor, {})
    expect(snapshot.teamMembers.some(item => item.userId === person.entityId)).toBe(false)
    expect(snapshot.projectMembers.some(item => item.userId === person.entityId)).toBe(false)
    expect(() => repository.execute(actor, { idempotencyKey: 'team-last-owner-remove', type: 'team.member.remove', payload: { teamId: 'team-local', userId: actor.id } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })
})
