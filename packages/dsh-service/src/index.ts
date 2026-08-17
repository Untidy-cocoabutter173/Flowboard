import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  MAX_UPLOAD_BYTES,
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
import { MeetingCoordinator } from './meeting-coordinator.ts'
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
  static inject = ['tools', 'agents', 'systemPrompt']
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
    ctx.effect(() => (ctx.get('systemPrompt') as {
      context(value: { name: string; order: number; text: string }): () => void
    }).context({
      name: 'flowboard:act-first',
      order: 210,
      text: [
        '# Flowboard 即时行动原则',
        '对创建项目、任务、资料、会议等安全且可逆的操作，先调用工具执行，再用结果继续沟通。',
        '名称、负责人、日期、描述等非关键字段缺失时使用“未命名”或空值创建临时实体，不要因此只提问而不行动。',
        '用户后续补充或纠正时，先读取最新 version，再更新同一实体。只有缺少可写团队/项目、权限不足、删除或不可逆操作时才暂停并询问。',
      ].join('\n'),
    }), 'flowboard.actFirstContext')
    const coordinator = new MeetingCoordinator(
      ctx,
      this.client,
      ctx.get('agents') as never,
      ctx.get('systemPrompt') as never,
    )
    coordinator.start()
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

  @Remote('uploadAudio')
  async remoteUploadAudio(requestJson: string, audioBase64: string, signal: AbortSignal): Promise<string> {
    const parsed = uploadTicketRequestSchema.parse(JSON.parse(requestJson) as UploadTicketRequest)
    const request = { ...parsed, contentType: parsed.contentType.split(';', 1)[0]!.trim().toLowerCase() }
    if (audioBase64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) throw new Error('Audio segment exceeds the upload limit')
    const audio = Buffer.from(audioBase64, 'base64')
    if (audio.byteLength !== request.size) throw new Error('Audio segment size does not match the upload request')
    return JSON.stringify(await this.client.uploadAudio(request, audio, signal))
  }

  @Remote('transcription')
  async remoteTranscription(requestJson: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.client.transcription(transcriptionRequestSchema.parse(JSON.parse(requestJson) as TranscriptionRequest), signal))
  }
}

export { FlowboardHttpClient, FlowboardRemoteError, type HttpClientConfig } from './http-client.ts'
export { MeetingCoordinator } from './meeting-coordinator.ts'
export default FlowboardService
