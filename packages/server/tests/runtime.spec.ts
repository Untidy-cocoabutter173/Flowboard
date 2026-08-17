import { describe, expect, it } from 'vitest'
import { createFlowboardAccessToken } from '../src/runtime.ts'

describe('embedded Flowboard runtime credentials', () => {
  it('generates a fresh high-entropy token for each runtime', () => {
    const first = createFlowboardAccessToken()
    const second = createFlowboardAccessToken()
    expect(first).toHaveLength(43)
    expect(second).toHaveLength(43)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
