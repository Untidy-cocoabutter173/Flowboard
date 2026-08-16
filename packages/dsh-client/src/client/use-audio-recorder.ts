import { useCallback, useEffect, useRef } from 'react'

export interface VadRecorderOptions {
  active: boolean
  onSegment(blob: Blob, startedAt: string, endedAt: string): Promise<void>
  onState(recording: boolean): void
  onError(message: string): void
}

export function useVadRecorder(options: VadRecorderOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const stream = useRef<MediaStream | null>(null)
  const context = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)
  const speechAt = useRef(0)
  const segmentAt = useRef<string | null>(null)
  const noiseFloor = useRef(0.008)
  const calibrateUntil = useRef(0)

  const stopSegment = useCallback(() => {
    const current = recorder.current
    if (current !== null && current.state !== 'inactive') current.stop()
  }, [])

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    stopSegment()
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    void context.current?.close().catch(() => undefined)
    context.current = null
    analyser.current = null
    optionsRef.current.onState(false)
  }, [stopSegment])

  const startSegment = useCallback(() => {
    if (stream.current === null || recorder.current !== null) return
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
    const next = mimeType === undefined ? new MediaRecorder(stream.current) : new MediaRecorder(stream.current, { mimeType })
    chunks.current = []
    segmentAt.current = new Date().toISOString()
    next.ondataavailable = event => { if (event.data.size > 0) chunks.current.push(event.data) }
    next.onstop = () => {
      recorder.current = null
      optionsRef.current.onState(false)
      const blob = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' })
      const startedAt = segmentAt.current ?? new Date().toISOString()
      segmentAt.current = null
      if (blob.size > 0) void optionsRef.current.onSegment(blob, startedAt, new Date().toISOString()).catch(error => optionsRef.current.onError(error instanceof Error ? error.message : String(error)))
    }
    next.start()
    recorder.current = next
    optionsRef.current.onState(true)
  }, [])

  const start = useCallback(async () => {
    if (stream.current !== null) return
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined || typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持麦克风录音')
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(media)
      const nextAnalyser = audioContext.createAnalyser()
      nextAnalyser.fftSize = 2048
      source.connect(nextAnalyser)
      stream.current = media
      context.current = audioContext
      analyser.current = nextAnalyser
      calibrateUntil.current = Date.now() + 700
      const samples = new Uint8Array(nextAnalyser.fftSize)
      timer.current = window.setInterval(() => {
        nextAnalyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value }
        const rms = Math.sqrt(sum / samples.length)
        const now = Date.now()
        if (now < calibrateUntil.current) noiseFloor.current = Math.max(noiseFloor.current, rms)
        const threshold = Math.max(0.012, noiseFloor.current * 2.8)
        if (rms > threshold) { speechAt.current = now; startSegment() }
        else if (recorder.current !== null && now - speechAt.current > 800) stopSegment()
      }, 100)
    } catch (error) {
      release()
      optionsRef.current.onError(error instanceof Error ? error.message : String(error))
    }
  }, [release, startSegment, stopSegment])

  useEffect(() => {
    if (options.active) void start()
    else release()
    return release
  }, [options.active, release, start])

  return { stopSegment }
}
