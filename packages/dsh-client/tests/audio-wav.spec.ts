import { describe, expect, it } from 'vitest'
import { encodePcm16Wav, resampleMono } from '../src/client/audio-wav.ts'

describe('PCM WAV encoder', () => {
  it('downsamples mono audio by averaging the source window', () => {
    expect([...resampleMono(new Float32Array([1, 1, 1, -1, -1, -1]), 48_000, 16_000)]).toEqual([1, -1])
  })

  it('writes a valid 16 kHz mono PCM header and clamped samples', () => {
    const buffer = encodePcm16Wav([new Float32Array([-2, 0.5, 2])], 16_000)
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(-32_768)
    expect(view.getInt16(46, true)).toBe(16_383)
    expect(view.getInt16(48, true)).toBe(32_767)
  })
})
