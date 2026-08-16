import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommandRequest, FlowboardSnapshot, TranscriptionView } from '@flowboard/contracts'
import { FlowboardRemoteClient } from './remote.ts'

export type FlowboardSection = 'projects' | 'board' | 'meetings' | 'library' | 'calendar' | 'people'
export type ClientCommand = CommandRequest extends infer Command
  ? Command extends CommandRequest ? Omit<Command, 'idempotencyKey'> : never
  : never
export interface FlowboardState {
  status: 'loading' | 'ready' | 'error'
  snapshot: FlowboardSnapshot | null
  selectedProjectId: string | null
  section: FlowboardSection
  busy: boolean
  error: string | null
}

export class FlowboardController implements HostObservable<FlowboardState> {
  private state: FlowboardState = { status: 'loading', snapshot: null, selectedProjectId: null, section: 'board', busy: false, error: null }
  private readonly listeners = new Set<() => void>()
  private abort = new AbortController()

  constructor(private readonly remote: FlowboardRemoteClient) {}
  getSnapshot = (): FlowboardState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  start(): void {
    void this.run()
  }
  dispose(): void {
    this.abort.abort()
    this.listeners.clear()
  }
  selectProject = (id: string): void => this.update({ selectedProjectId: id })
  selectSection = (section: FlowboardSection): void => this.update({ section })

  async refresh(): Promise<void> {
    const snapshot = await this.remote.snapshot({}, this.abort.signal)
    const selected = this.state.selectedProjectId
    this.update({
      snapshot,
      status: 'ready',
      selectedProjectId: selected !== null && snapshot.projects.some(project => project.id === selected)
        ? selected : snapshot.projects[0]?.id ?? null,
      error: null,
    })
  }

  async command(command: ClientCommand): Promise<void> {
    this.update({ busy: true, error: null })
    try {
      await this.remote.command({ ...command, idempotencyKey: crypto.randomUUID() } as CommandRequest, this.abort.signal)
      await this.refresh()
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      this.update({ busy: false })
    }
  }

  async uploadMeetingAudio(meetingId: string, blob: Blob): Promise<TranscriptionView> {
    this.update({ busy: true, error: null })
    try {
      const contentType = blob.type || 'audio/webm'
      const ticket = await this.remote.createUploadTicket({ meetingId, contentType, size: blob.size }, this.abort.signal)
      const response = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: blob, signal: this.abort.signal })
      if (!response.ok) throw new Error(`Audio upload failed with HTTP ${response.status}`)
      const { jobId } = await response.json() as { jobId: string }
      for (;;) {
        const job = await this.remote.transcription({ jobId }, this.abort.signal)
        if (job.state === 'completed') {
          await this.refresh()
          return job
        }
        if (job.state === 'failed') throw new Error(job.error ?? 'Transcription failed')
        await new Promise(resolve => setTimeout(resolve, 1_000))
      }
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      this.update({ busy: false })
    }
  }

  private async run(): Promise<void> {
    let retryMs = 1_000
    while (!this.abort.signal.aborted) {
      try {
        if (this.state.snapshot === null) await this.refresh()
        const cursor = this.state.snapshot?.cursor ?? 0
        const result = await this.remote.changes({ cursor, waitMs: 30_000 }, this.abort.signal)
        if (result.changed) await this.refresh()
        retryMs = 1_000
      } catch (error) {
        if (this.abort.signal.aborted) return
        this.fail(error)
        await this.delay(retryMs)
        retryMs = Math.min(retryMs * 2, 15_000)
      }
    }
  }
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = window.setTimeout(resolve, ms)
      this.abort.signal.addEventListener('abort', () => {
        window.clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
  private fail(error: unknown): void {
    if (this.abort.signal.aborted) return
    this.update({ status: this.state.snapshot === null ? 'error' : 'ready', error: error instanceof Error ? error.message : String(error) })
  }
  private update(patch: Partial<FlowboardState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}
