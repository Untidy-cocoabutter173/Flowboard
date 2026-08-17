import { useCallback, useEffect, useRef } from 'react'
import { encodePcm16Wav } from './audio-wav.ts'

export interface VadRecorderOptions {
  active: boolean
  onSegment(blob: Blob, startedAt: string, endedAt: string): Promise<void>
  onState(recording: boolean): void
  onError(message: string): void
}

const PRE_ROLL_MS = 350
const SILENCE_MS = 800
const MAX_SEGMENT_MS = 15_000

export function useVadRecorder(options: VadRecorderOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const stream = useRef<MediaStream | null>(null)
  const context = useRef<AudioContext | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const silentGain = useRef<GainNode | null>(null)
  const preRoll = useRef<Float32Array[]>([])
  const preRollSamples = useRef(0)
  const segment = useRef<Float32Array[] | null>(null)
  const segmentStartedAt = useRef<number | null>(null)
  const speechAt = useRef(0)
  const noiseFloor = useRef(0.008)
  const calibrateUntil = useRef(0)
  const pendingSegments = useRef(new Set<Promise<void>>())

  const finishSegment = useCallback((): Promise<void> => {
    const chunks = segment.current
    const startedAt = segmentStartedAt.current
    const sampleRate = context.current?.sampleRate
    segment.current = null
    segmentStartedAt.current = null
    optionsRef.current.onState(false)
    if (chunks === null || chunks.length === 0 || startedAt === null || sampleRate === undefined) return Promise.resolve()
    const blob = new Blob([encodePcm16Wav(chunks, sampleRate)], { type: 'audio/wav' })
    const task = optionsRef.current.onSegment(blob, new Date(startedAt).toISOString(), new Date().toISOString())
      .catch(error => {
        optionsRef.current.onError(error instanceof Error ? error.message : String(error))
        throw error
      })
    pendingSegments.current.add(task)
    void task.finally(() => pendingSegments.current.delete(task)).catch(() => undefined)
    return task
  }, [])

  const stopSegment = useCallback(async (): Promise<void> => {
    await finishSegment()
    await Promise.all([...pendingSegments.current])
  }, [finishSegment])

  const release = useCallback(() => {
    void finishSegment().catch(() => undefined)
    processor.current?.disconnect()
    silentGain.current?.disconnect()
    processor.current = null
    silentGain.current = null
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    void context.current?.close().catch(() => undefined)
    context.current = null
    preRoll.current = []
    preRollSamples.current = 0
    optionsRef.current.onState(false)
  }, [finishSegment])

  const acceptChunk = useCallback((chunk: Float32Array) => {
    const audioContext = context.current
    if (audioContext === null) return
    let sum = 0
    for (const sample of chunk) sum += sample * sample
    const rms = Math.sqrt(sum / chunk.length)
    const now = Date.now()
    if (now < calibrateUntil.current) noiseFloor.current = Math.max(noiseFloor.current, rms)
    const threshold = Math.max(0.012, noiseFloor.current * 2.8)

    if (segment.current === null) {
      preRoll.current.push(chunk)
      preRollSamples.current += chunk.length
      const maximum = audioContext.sampleRate * PRE_ROLL_MS / 1_000
      while (preRollSamples.current > maximum && preRoll.current.length > 1) {
        preRollSamples.current -= preRoll.current.shift()!.length
      }
      if (rms > threshold) {
        speechAt.current = now
        segment.current = preRoll.current
        segmentStartedAt.current = now - preRollSamples.current / audioContext.sampleRate * 1_000
        preRoll.current = []
        preRollSamples.current = 0
        optionsRef.current.onState(true)
      }
      return
    }

    segment.current.push(chunk)
    if (rms > threshold) speechAt.current = now
    if (now - speechAt.current > SILENCE_MS || now - (segmentStartedAt.current ?? now) >= MAX_SEGMENT_MS) void finishSegment().catch(() => undefined)
  }, [finishSegment])

  const start = useCallback(async () => {
    if (stream.current !== null) return
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined || typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持麦克风录音')
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(media)
      const nextProcessor = audioContext.createScriptProcessor(4_096, 1, 1)
      const nextGain = audioContext.createGain()
      nextGain.gain.value = 0
      nextProcessor.onaudioprocess = event => acceptChunk(event.inputBuffer.getChannelData(0).slice())
      source.connect(nextProcessor)
      nextProcessor.connect(nextGain)
      nextGain.connect(audioContext.destination)
      stream.current = media
      context.current = audioContext
      processor.current = nextProcessor
      silentGain.current = nextGain
      calibrateUntil.current = Date.now() + 700
    } catch (error) {
      release()
      optionsRef.current.onError(error instanceof Error ? error.message : String(error))
    }
  }, [acceptChunk, release])

  useEffect(() => {
    if (options.active) void start()
    else release()
    return release
  }, [options.active, release, start])

  return { stopSegment }
}
