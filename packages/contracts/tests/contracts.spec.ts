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
})
