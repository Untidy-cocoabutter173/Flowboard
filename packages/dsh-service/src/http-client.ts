import type {
  ChangesRequest,
  ChangesResult,
  CommandRequest,
  CommandResult,
  FlowboardErrorBody,
  FlowboardSnapshot,
  SnapshotRequest,
  TranscriptionRequest,
  TranscriptionView,
  UploadTicketRequest,
  UploadTicketResult,
  WorkspaceSummary,
} from '@flowboard/contracts'

export class FlowboardRemoteError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'FlowboardRemoteError'
  }
}

export interface HttpClientConfig {
  apiBase: string
  token: string
  requestTimeoutMs?: number
}

export class FlowboardHttpClient {
  private readonly base: string
  private readonly timeoutMs: number

  constructor(readonly config: HttpClientConfig, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = config.apiBase.replace(/\/$/, '')
    this.timeoutMs = config.requestTimeoutMs ?? 15_000
  }

  snapshot(request: SnapshotRequest, signal?: AbortSignal): Promise<FlowboardSnapshot> {
    const query = new URLSearchParams()
    if (request.projectId !== undefined) query.set('projectId', request.projectId)
    if (request.meetingId !== undefined) query.set('meetingId', request.meetingId)
    if (request.compact !== undefined) query.set('compact', String(request.compact))
    const suffix = query.size === 0 ? '' : `?${query}`
    return this.request(`/v1/snapshot${suffix}`, { method: 'GET' }, signal)
  }

  summary(signal?: AbortSignal): Promise<WorkspaceSummary> {
    return this.request('/v1/summary', { method: 'GET' }, signal)
  }

  command(request: CommandRequest, signal?: AbortSignal): Promise<CommandResult> {
    return this.request('/v1/commands', { method: 'POST', body: JSON.stringify(request) }, signal)
  }

  changes(request: ChangesRequest, signal?: AbortSignal): Promise<ChangesResult> {
    const query = new URLSearchParams({ cursor: String(request.cursor), waitMs: String(request.waitMs ?? 30_000) })
    return this.request(`/v1/changes?${query}`, { method: 'GET' }, signal, Math.max(this.timeoutMs, (request.waitMs ?? 30_000) + 2_000))
  }

  createUploadTicket(request: UploadTicketRequest, signal?: AbortSignal): Promise<UploadTicketResult> {
    return this.request('/v1/uploads/tickets', { method: 'POST', body: JSON.stringify(request) }, signal)
  }

  transcription(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionView> {
    return this.request(`/v1/transcriptions/${encodeURIComponent(request.jobId)}`, { method: 'GET' }, signal)
  }

  private async request<T>(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.config.token}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      signal: combined,
    })
    const body = await response.json() as T | FlowboardErrorBody
    if (!response.ok) {
      const failure = body as FlowboardErrorBody
      throw new FlowboardRemoteError(
        failure.error?.code ?? 'UPSTREAM_ERROR',
        failure.error?.message ?? `Flowboard API returned HTTP ${response.status}`,
        response.status,
        failure.error?.details,
      )
    }
    return body as T
  }
}
