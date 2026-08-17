import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommandRequest, CommandResult, FlowboardSnapshot, TranscriptionView } from '@flowboard/contracts'
import { FlowboardRemoteClient } from './remote.ts'

export type ProjectTab = 'overview' | 'board' | 'table' | 'meetings' | 'library' | 'members'
export type PersonalTab = 'tasks' | 'calendar' | 'board'
export type OrganizationTab = 'people' | 'teams'
export type FlowboardRoute =
  | { area: 'home' }
  | { area: 'projects'; projectId: string | null; tab: ProjectTab }
  | { area: 'meetings'; meetingId: string | null }
  | { area: 'library'; libraryId: string | null }
  | { area: 'my'; tab: PersonalTab }
  | { area: 'organization'; tab: OrganizationTab }

export type ClientCommand = CommandRequest extends infer Command
  ? Command extends CommandRequest ? Omit<Command, 'idempotencyKey'> : never
  : never

export interface MeetingRuntime {
  meetingId: string | null
  recording: boolean
  uploading: boolean
  stopping: boolean
  candidate: string
  error: string | null
}

export interface FlowboardState {
  status: 'loading' | 'ready' | 'error'
  snapshot: FlowboardSnapshot | null
  route: FlowboardRoute
  selectedPersonId: string | null
  meetingRuntimes: Record<string, MeetingRuntime>
  busy: boolean
  error: string | null
}

const emptyRuntime = (): MeetingRuntime => ({ meetingId: null, recording: false, uploading: false, stopping: false, candidate: '', error: null })

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export class FlowboardController implements HostObservable<FlowboardState> {
  private state: FlowboardState = { status: 'loading', snapshot: null, route: { area: 'home' }, selectedPersonId: null, meetingRuntimes: {}, busy: false, error: null }
  private readonly listeners = new Set<() => void>()
  private abort = new AbortController()

  constructor(private readonly remote: FlowboardRemoteClient) {}
  getSnapshot = (): FlowboardState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  start(): void { void this.run() }
  dispose(): void { this.abort.abort(); this.listeners.clear() }
  navigate = (route: FlowboardRoute): void => {
    this.update({ route })
    if (route.area === 'meetings' && route.meetingId !== null) void this.refresh().catch(error => this.fail(error))
  }
  selectPerson = (personId: string): void => {
    if (this.state.snapshot?.people.some(person => person.id === personId) === true) this.update({ selectedPersonId: personId })
  }
  meetingRuntime = (sessionId: string): MeetingRuntime => this.state.meetingRuntimes[sessionId] ?? emptyRuntime()
  setMeetingRuntime = (sessionId: string, patch: Partial<MeetingRuntime>): void => {
    const current = this.meetingRuntime(sessionId)
    this.update({ meetingRuntimes: { ...this.state.meetingRuntimes, [sessionId]: { ...current, ...patch } } })
  }

  async refresh(): Promise<void> {
    let snapshot = await this.remote.snapshot({}, this.abort.signal)
    if (this.state.route.area === 'meetings' && this.state.route.meetingId !== null) {
      const detail = await this.remote.snapshot({ meetingId: this.state.route.meetingId }, this.abort.signal)
      snapshot = {
        ...snapshot,
        cursor: Math.max(snapshot.cursor, detail.cursor),
        utterances: detail.utterances,
        aiActions: detail.aiActions,
      }
    }
    let route = this.state.route
    if (route.area === 'projects') {
      const projectId = route.projectId
      if (projectId !== null && !snapshot.projects.some(project => project.id === projectId)) route = { area: 'projects', projectId: snapshot.projects[0]?.id ?? null, tab: route.tab }
    }
    if (route.area === 'meetings') {
      const meetingId = route.meetingId
      if (meetingId !== null && !snapshot.meetings.some(meeting => meeting.id === meetingId)) route = { area: 'meetings', meetingId: null }
    }
    const selectedPersonId = snapshot.people.some(person => person.id === this.state.selectedPersonId)
      ? this.state.selectedPersonId
      : snapshot.people.find(person => person.id === snapshot.actor.id)?.id ?? snapshot.people[0]?.id ?? null
    this.update({ snapshot, status: 'ready', route, selectedPersonId, error: null })
  }

  async command(command: ClientCommand): Promise<CommandResult> {
    this.update({ busy: true, error: null })
    try {
      const result = await this.remote.command({ ...command, idempotencyKey: crypto.randomUUID() } as CommandRequest, this.abort.signal)
      await this.refresh()
      return result
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      this.update({ busy: false })
    }
  }

  async uploadMeetingAudio(meetingId: string, blob: Blob, clientSegmentId: string = crypto.randomUUID(), startedAt?: string, endedAt?: string): Promise<TranscriptionView> {
    const contentType = blob.type || 'audio/webm'
    const request = { meetingId, contentType, size: blob.size, clientSegmentId, ...(startedAt === undefined ? {} : { startedAt }), ...(endedAt === undefined ? {} : { endedAt }) }
    const { jobId } = await this.remote.uploadAudio(request, encodeBase64(await blob.arrayBuffer()), this.abort.signal)
    for (;;) {
      const job = await this.remote.transcription({ jobId }, this.abort.signal)
      if (job.state === 'completed') { await this.refresh(); return job }
      if (job.state === 'failed') throw new Error(job.error ?? '转写失败')
      await new Promise(resolve => window.setTimeout(resolve, 750))
    }
  }

  private async run(): Promise<void> {
    let retryMs = 1_000
    while (!this.abort.signal.aborted) {
      try {
        if (this.state.snapshot === null) await this.refresh()
        const result = await this.remote.changes({ cursor: this.state.snapshot?.cursor ?? 0, waitMs: 30_000 }, this.abort.signal)
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
      this.abort.signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve() }, { once: true })
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
