import type {
  ChangesRequest, ChangesResult, CommandRequest, CommandResult, FlowboardSnapshot,
  SnapshotRequest, TranscriptionRequest, TranscriptionView, UploadTicketRequest, UploadTicketResult,
} from '@flowboard/contracts'

interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details: object }
}

export interface FlowboardRemotePort {
  snapshot(request: string, signal?: AbortSignal): Promise<RemoteResult<string>>
  command(request: string, signal?: AbortSignal): Promise<RemoteResult<string>>
  changes(request: string, signal?: AbortSignal): Promise<RemoteResult<string>>
  createUploadTicket(request: string, signal?: AbortSignal): Promise<RemoteResult<string>>
  uploadAudio(request: string, audioBase64: string, signal?: AbortSignal): Promise<RemoteResult<string>>
  transcription(request: string, signal?: AbortSignal): Promise<RemoteResult<string>>
}

export interface AudioUploadResult { jobId: string }

function value<T>(result: RemoteResult<string>): T {
  if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? 'Flowboard Remote request failed')
  return JSON.parse(result.value) as T
}

export class FlowboardRemoteClient {
  constructor(private readonly remote: FlowboardRemotePort) {}
  async snapshot(request: SnapshotRequest, signal?: AbortSignal): Promise<FlowboardSnapshot> {
    return value(await this.remote.snapshot(JSON.stringify(request), signal))
  }
  async command(request: CommandRequest, signal?: AbortSignal): Promise<CommandResult> {
    return value(await this.remote.command(JSON.stringify(request), signal))
  }
  async changes(request: ChangesRequest, signal?: AbortSignal): Promise<ChangesResult> {
    return value(await this.remote.changes(JSON.stringify(request), signal))
  }
  async createUploadTicket(request: UploadTicketRequest, signal?: AbortSignal): Promise<UploadTicketResult> {
    return value(await this.remote.createUploadTicket(JSON.stringify(request), signal))
  }
  async uploadAudio(request: UploadTicketRequest, audioBase64: string, signal?: AbortSignal): Promise<AudioUploadResult> {
    return value(await this.remote.uploadAudio(JSON.stringify(request), audioBase64, signal))
  }
  async transcription(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionView> {
    return value(await this.remote.transcription(JSON.stringify(request), signal))
  }
}
