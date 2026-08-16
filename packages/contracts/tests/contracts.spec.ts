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

  it('rejects oversized upload tickets', () => {
    expect(() => uploadTicketRequestSchema.parse({
      meetingId: 'meeting-1',
      contentType: 'audio/webm',
      size: MAX_UPLOAD_BYTES + 1,
    })).toThrow()
  })
})
