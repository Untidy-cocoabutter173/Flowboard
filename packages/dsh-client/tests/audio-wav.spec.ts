import { describe, expect, it } from 'vitest'
import { encodePcm16Wav, resampleMono } from '../src/client/audio-wav.ts'

describe('PCM WAV encoder', () => {
  it('preserves a constant signal when downsampling', () => {
    const output = resampleMono(new Float32Array(480).fill(0.5), 48_000, 16_000)
    expect(output).toHaveLength(160)
    expect(Math.max(...output.map(sample => Math.abs(sample - 0.5)))).toBeLessThan(1e-6)
  })

  it('attenuates frequencies above the target Nyquist limit', () => {
    const input = Float32Array.from({ length: 480 }, (_, index) => index % 2 === 0 ? 1 : -1)
    const output = resampleMono(input, 48_000, 16_000)
    expect(Math.max(...output.slice(16, -16).map(Math.abs))).toBeLessThan(0.02)
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
