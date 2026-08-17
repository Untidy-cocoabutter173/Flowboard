const WAV_HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

export function resampleMono(input: Float32Array, inputRate: number, outputRate = 16_000): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) {
    throw new Error('Audio sample rates must be positive numbers')
  }
  if (input.length === 0 || inputRate === outputRate) return input.slice()

  const ratio = inputRate / outputRate
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)))
  const cutoff = Math.min(1, outputRate / inputRate) * 0.94
  const lobes = 12
  const support = lobes / cutoff
  const sinc = (value: number): number => Math.abs(value) < 1e-8 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value)

  for (let target = 0; target < output.length; target += 1) {
    const center = (target + 0.5) * ratio - 0.5
    const first = Math.max(0, Math.ceil(center - support))
    const last = Math.min(input.length - 1, Math.floor(center + support))
    let weighted = 0
    let weight = 0
    for (let source = first; source <= last; source += 1) {
      const normalized = (source - center) * cutoff
      const kernel = cutoff * sinc(normalized) * sinc(normalized / lobes)
      weighted += input[source]! * kernel
      weight += kernel
    }
    output[target] = weight === 0 ? 0 : weighted / weight
  }
  return output
}

export function encodePcm16Wav(chunks: readonly Float32Array[], inputRate: number, outputRate = 16_000): ArrayBuffer {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const input = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    input.set(chunk, offset)
    offset += chunk.length
  }
  const samples = resampleMono(input, inputRate, outputRate)
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, outputRate, true)
  view.setUint32(28, outputRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!))
    view.setInt16(WAV_HEADER_BYTES + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}
