import { describe, expect, it } from 'vitest'
import { commandRequestSchema, MAX_UPLOAD_BYTES, uploadTicketRequestSchema } from '../src/index.ts'

describe('Flowboard contracts', () => {
  it('accepts a versioned task command', () => {
    const command = commandRequestSchema.parse({
      idempotencyKey: 'request-12345678',
      type: 'task.update',
      expectedVersion: 3,
      payload: { id: 'task-1', progress: 0.5, categoryId: null },
    })
    expect(command.type).toBe('task.update')
    expect(command.expectedVersion).toBe(3)
  })

  it('accepts configurable fields and multi-select task values', () => {
    const field = commandRequestSchema.parse({
      idempotencyKey: 'field-update-1234',
      type: 'field.update',
      expectedVersion: 1,
      payload: { id: 'field-1', name: '发布渠道', fieldType: 'multi_select', options: ['Web', 'App'] },
    })
    const task = commandRequestSchema.parse({
      idempotencyKey: 'task-fields-1234',
      type: 'task.update',
      expectedVersion: 2,
      payload: { id: 'task-1', customData: { channels: ['Web', 'App'], estimate: 8, approved: true } },
    })
    expect(field.type).toBe('field.update')
    expect(task.type).toBe('task.update')
  })

  it('rejects oversized upload tickets', () => {
    expect(() => uploadTicketRequestSchema.parse({
      meetingId: 'meeting-1',
      contentType: 'audio/webm',
      size: MAX_UPLOAD_BYTES + 1,
      clientSegmentId: 'segment-1',
    })).toThrow()
  })

  it('accepts versioned meeting intent upsert and commit commands', () => {
    expect(commandRequestSchema.parse({
      idempotencyKey: 'meeting-intent-upsert', type: 'meeting.intent.upsert',
      payload: { meetingId: 'meeting-1', intentKey: 'release-owner', kind: 'task', payload: { projectId: 'project-1', title: '发布检查', assigneeId: 'user-1' }, evidenceFromSequence: 1, evidenceToSequence: 2 },
    }).type).toBe('meeting.intent.upsert')
    expect(commandRequestSchema.parse({
      idempotencyKey: 'meeting-question-upsert', type: 'meeting.intent.upsert',
      payload: { meetingId: 'meeting-1', intentKey: 'owner-question', kind: 'note', payload: { title: '谁负责？', origin: 'assistant', question: '谁负责？' }, evidenceFromSequence: 2, evidenceToSequence: 2 },
    }).payload.payload.origin).toBe('assistant')
    expect(commandRequestSchema.parse({
      idempotencyKey: 'meeting-intent-commit', type: 'meeting.intent.commit',
      payload: { id: 'intent-1', revision: 2, basisSequence: 2 },
    }).type).toBe('meeting.intent.commit')
    expect(commandRequestSchema.parse({
      idempotencyKey: 'meeting-intent-record', type: 'meeting.intent.record',
      payload: { meetingId: 'meeting-1', intentKey: 'batch-1-2-0', title: '创建发布项目', evidenceFromSequence: 1, evidenceToSequence: 2 },
    }).type).toBe('meeting.intent.record')
    expect(commandRequestSchema.parse({
      idempotencyKey: 'meeting-project-action', type: 'meeting.action.append',
      payload: { id: 'meeting-1', kind: 'project', summary: '创建项目：发布平台' },
    }).payload.kind).toBe('project')
  })
})
