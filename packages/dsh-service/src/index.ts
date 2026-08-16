import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  changesRequestSchema,
  commandRequestSchema,
  snapshotRequestSchema,
  transcriptionRequestSchema,
  uploadTicketRequestSchema,
} from '@flowboard/contracts'
import { FlowboardHttpClient, type HttpClientConfig } from './http-client.ts'
import { registerFlowboardTools } from './tools.ts'

export interface Config extends HttpClientConfig {}

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
    if (config.apiBase.trim() === '' || config.token.length < 8) throw new Error('Flowboard apiBase and an access token of at least 8 characters are required')
    this.client = new FlowboardHttpClient(config)
    registerFlowboardTools(ctx, this)
  }

  @Remote('snapshot')
  async remoteSnapshot(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.snapshot(snapshotRequestSchema.parse(JSON.parse(requestJson)), signal))
  }

  @Remote('command')
  async remoteCommand(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.command(commandRequestSchema.parse(JSON.parse(requestJson)), signal))
  }

  @Remote('changes')
  async remoteChanges(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.changes(changesRequestSchema.parse(JSON.parse(requestJson)), signal))
  }

  @Remote('createUploadTicket')
  async remoteCreateUploadTicket(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.createUploadTicket(uploadTicketRequestSchema.parse(JSON.parse(requestJson)), signal))
  }

  @Remote('transcription')
  async remoteTranscription(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.transcription(transcriptionRequestSchema.parse(JSON.parse(requestJson)), signal))
  }
}

export { FlowboardHttpClient, FlowboardRemoteError, type HttpClientConfig } from './http-client.ts'
export default FlowboardService
