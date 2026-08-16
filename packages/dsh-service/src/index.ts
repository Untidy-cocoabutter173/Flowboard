import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  changesRequestSchema,
  commandRequestSchema,
  snapshotRequestSchema,
  transcriptionRequestSchema,
  uploadTicketRequestSchema,
  type CommandRequest,
  type SnapshotRequest,
  type TranscriptionRequest,
  type UploadTicketRequest,
} from '@flowboard/contracts'
import { startFlowboardRuntime } from '@flowboard/server'
import { FlowboardHttpClient, type HttpClientConfig } from './http-client.ts'
import { registerFlowboardTools } from './tools.ts'

export interface Config extends Partial<HttpClientConfig> {
  embedded?: boolean
  host?: string
  port?: number
  dataDirectory?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    flowboard: FlowboardService
  }
}

export class FlowboardService extends TypertRemoteService {
  static inject = ['tools']
  private readonly client: FlowboardHttpClient

  constructor(ctx: Context, config: Config) {
    super(ctx, 'flowboard')
    const host = config.host ?? '127.0.0.1'
    const port = config.port ?? 8787
    const apiBase = config.apiBase ?? `http://${host}:${port}`
    const token = config.token ?? 'flowboard-local'
    if (apiBase.trim() === '' || token.length < 8) throw new Error('Flowboard apiBase and an access token of at least 8 characters are required')
    this.client = new FlowboardHttpClient({
      apiBase,
      token,
      ...(config.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: config.requestTimeoutMs }),
    })
    if (config.embedded ?? true) {
      ctx.effect(async () => {
        const runtime = await startFlowboardRuntime({
          host,
          port,
          token,
          logger: false,
          ...(config.dataDirectory === undefined ? {} : { dataDirectory: config.dataDirectory }),
        })
        return () => runtime.close()
      }, 'flowboard.embeddedRuntime')
    }
    registerFlowboardTools(ctx, this.client)
  }

  @Remote('snapshot')
  async remoteSnapshot(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.snapshot(snapshotRequestSchema.parse(JSON.parse(requestJson) as SnapshotRequest), signal))
  }

  @Remote('command')
  async remoteCommand(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.command(commandRequestSchema.parse(JSON.parse(requestJson) as CommandRequest), signal))
  }

  @Remote('changes')
  async remoteChanges(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.changes(changesRequestSchema.parse(JSON.parse(requestJson)), signal))
  }

  @Remote('createUploadTicket')
  async remoteCreateUploadTicket(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.createUploadTicket(uploadTicketRequestSchema.parse(JSON.parse(requestJson) as UploadTicketRequest), signal))
  }

  @Remote('transcription')
  async remoteTranscription(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.transcription(transcriptionRequestSchema.parse(JSON.parse(requestJson) as TranscriptionRequest), signal))
  }
}

export { FlowboardHttpClient, FlowboardRemoteError, type HttpClientConfig } from './http-client.ts'
export default FlowboardService
