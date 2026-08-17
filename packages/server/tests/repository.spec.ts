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
    expect(snapshot.apiVersion).toBe(3)
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

  it('会议中的责任人纠正只修订同一意图，重复提交不会创建重复任务', () => {
    const actor = repository.authenticate('test-token')
    const zhang = repository.execute(actor, { idempotencyKey: 'intent-person-zhang', type: 'person.create', payload: { teamId: 'team-local', name: '张三' } })
    const li = repository.execute(actor, { idempotencyKey: 'intent-person-li', type: 'person.create', payload: { teamId: 'team-local', name: '李四' } })
    for (const personId of [zhang.entityId, li.entityId]) {
      repository.execute(actor, { idempotencyKey: `intent-member-${personId}`, type: 'project.member.set', payload: { projectId: 'project-local', userId: personId, role: 'member' } })
    }
    const meeting = repository.execute(actor, { idempotencyKey: 'intent-meeting-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '任务分工', settings: { automation: 'execute' } } })
    repository.execute(actor, { idempotencyKey: 'intent-meeting-live', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    repository.execute(actor, { idempotencyKey: 'intent-transcript-1', type: 'meeting.transcript.append', expectedVersion: 2, payload: { id: meeting.entityId, text: '发布检查交给张三', clientSegmentId: 'intent-segment-1' } })
    const intent = repository.execute(actor, { idempotencyKey: 'intent-upsert-1', type: 'meeting.intent.upsert', payload: { meetingId: meeting.entityId, intentKey: 'release-check', kind: 'task', payload: { projectId: 'project-local', title: '发布检查', assigneeId: zhang.entityId }, evidenceFromSequence: 1, evidenceToSequence: 1 } })
    repository.execute(actor, { idempotencyKey: 'intent-transcript-2', type: 'meeting.transcript.append', expectedVersion: 3, payload: { id: meeting.entityId, text: '不对，交给李四', clientSegmentId: 'intent-segment-2' } })
    repository.execute(actor, { idempotencyKey: 'intent-upsert-2', type: 'meeting.intent.upsert', payload: { meetingId: meeting.entityId, intentKey: 'release-check', kind: 'task', payload: { projectId: 'project-local', title: '发布检查', assigneeId: li.entityId }, evidenceFromSequence: 1, evidenceToSequence: 2 } })
    repository.execute(actor, { idempotencyKey: 'intent-commit-1', type: 'meeting.intent.commit', payload: { id: intent.entityId, revision: 2, basisSequence: 2 } })
    const replay = repository.execute(actor, { idempotencyKey: 'intent-commit-2', type: 'meeting.intent.commit', payload: { id: intent.entityId, revision: 2, basisSequence: 2 } })
    const snapshot = repository.snapshot(actor, { meetingId: meeting.entityId })
    expect(snapshot.meetingIntents).toHaveLength(1)
    expect(snapshot.meetingIntents[0]).toMatchObject({ revision: 2, status: 'applied', payload: { assigneeId: li.entityId } })
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]?.assigneeId).toBe(li.entityId)
    expect(replay.replayed).toBe(true)
  })

  it('意图提交前有新转录到达时拒绝旧 basisSequence', () => {
    const actor = repository.authenticate('test-token')
    const meeting = repository.execute(actor, { idempotencyKey: 'stale-meeting-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '游标校验', settings: { automation: 'execute' } } })
    repository.execute(actor, { idempotencyKey: 'stale-meeting-live', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    repository.execute(actor, { idempotencyKey: 'stale-transcript-1', type: 'meeting.transcript.append', expectedVersion: 2, payload: { id: meeting.entityId, text: '创建回归任务' } })
    const intent = repository.execute(actor, { idempotencyKey: 'stale-intent', type: 'meeting.intent.upsert', payload: { meetingId: meeting.entityId, intentKey: 'regression', kind: 'task', payload: { projectId: 'project-local', title: '回归任务' }, evidenceFromSequence: 1, evidenceToSequence: 1 } })
    repository.execute(actor, { idempotencyKey: 'stale-transcript-2', type: 'meeting.transcript.append', expectedVersion: 3, payload: { id: meeting.entityId, text: '先不要创建' } })
    expect(() => repository.execute(actor, { idempotencyKey: 'stale-commit', type: 'meeting.intent.commit', payload: { id: intent.entityId, revision: 1, basisSequence: 1 } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT', details: { latestSequence: 2, basisSequence: 1 } }))
    expect(repository.snapshot(actor, {}).tasks).toHaveLength(0)
  })

  it('finalize 会等待分析水位和未决意图收敛，并关闭 Session 绑定', () => {
    const actor = repository.authenticate('test-token')
    const meeting = repository.execute(actor, { idempotencyKey: 'finalize-gate-create', type: 'meeting.create', payload: { teamId: 'team-local', projectIds: ['project-local'], title: '收敛检查', settings: { automation: 'suggest' } } })
    repository.execute(actor, { idempotencyKey: 'finalize-gate-live', type: 'meeting.update', expectedVersion: 1, payload: { id: meeting.entityId, status: 'live' } })
    repository.execute(actor, { idempotencyKey: 'finalize-gate-bind', type: 'meeting.agent.bind', payload: { id: meeting.entityId, sessionId: 'session-finalize' } })
    repository.execute(actor, { idempotencyKey: 'finalize-gate-transcript', type: 'meeting.transcript.append', expectedVersion: 2, payload: { id: meeting.entityId, text: '先记录一个待确认事项' } })
    repository.execute(actor, { idempotencyKey: 'finalize-gate-delivered', type: 'meeting.agent.progress', payload: { id: meeting.entityId, deliveredSequence: 1 } })
    repository.execute(actor, { idempotencyKey: 'finalize-gate-stopping', type: 'meeting.update', expectedVersion: 3, payload: { id: meeting.entityId, status: 'finalizing' } })
    expect(() => repository.execute(actor, { idempotencyKey: 'finalize-before-ack', type: 'meeting.finalize', expectedVersion: 4, payload: { id: meeting.entityId, summary: '不应成功' } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT', details: { latestSequence: 1, analyzedSequence: 0 } }))
    repository.execute(actor, { idempotencyKey: 'finalize-gate-ack', type: 'meeting.agent.progress', payload: { id: meeting.entityId, analyzedSequence: 1 } })
    const intent = repository.execute(actor, { idempotencyKey: 'finalize-gate-intent', type: 'meeting.intent.upsert', payload: { meetingId: meeting.entityId, intentKey: 'pending-note', kind: 'note', payload: { title: '待确认事项' }, evidenceFromSequence: 1, evidenceToSequence: 1 } })
    expect(() => repository.execute(actor, { idempotencyKey: 'finalize-before-intent', type: 'meeting.finalize', expectedVersion: 4, payload: { id: meeting.entityId, summary: '仍不应成功' } }))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT', details: { unresolvedIntents: 1 } }))
    repository.execute(actor, { idempotencyKey: 'finalize-reject-intent', type: 'meeting.intent.status', payload: { id: intent.entityId, revision: 1, status: 'rejected' } })
    repository.execute(actor, { idempotencyKey: 'finalize-complete', type: 'meeting.finalize', expectedVersion: 4, payload: { id: meeting.entityId, summary: '会议完成' } })
    const snapshot = repository.snapshot(actor, { meetingId: meeting.entityId })
    expect(snapshot.meetings[0]).toMatchObject({ status: 'ended', summary: '会议完成', version: 5 })
    expect(snapshot.meetingAgentBindings[0]?.state).toBe('closed')
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
