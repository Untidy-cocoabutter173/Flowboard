import { useCallback, useEffect, useRef, useState } from 'react'

export function useAudioRecorder(onAudio: (blob: Blob) => Promise<unknown>) {
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = useCallback(() => {
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      if (navigator.mediaDevices?.getUserMedia === undefined || typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录音')
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      const next = new MediaRecorder(stream.current)
      next.ondataavailable = event => { if (event.data.size > 0) chunks.current.push(event.data) }
      next.onstop = () => {
        const blob = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' })
        release()
        void onAudio(blob).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
      }
      recorder.current = next
      next.start()
      setRecording(true)
    } catch (reason) {
      release()
      setRecording(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [onAudio, release])

  const stop = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }, [])
  useEffect(() => () => {
    if (recorder.current?.state === 'recording') {
      recorder.current.onstop = null
      recorder.current.stop()
    }
    recorder.current = null
    release()
  }, [release])

  return { recording, error, start, stop }
}
