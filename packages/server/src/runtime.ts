import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildServer } from './application.ts'
import { openDatabase } from './database.ts'
import { SqliteFlowboardRepository } from './repository.ts'
import { CommandTranscriber, runTranscriptionWorkers } from './worker.ts'
import { resolveWhisperCommand } from './whisper-runtime.ts'

export interface FlowboardRuntimeOptions {
  host?: string
  port?: number
  token?: string
  dataDirectory?: string
  logger?: boolean
}

export interface FlowboardRuntime {
  apiBase: string
  token: string
  close(): Promise<void>
}

export function createFlowboardAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function startFlowboardRuntime(options: FlowboardRuntimeOptions = {}): Promise<FlowboardRuntime> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 8787
  const token = options.token?.trim() || createFlowboardAccessToken()
  if (token.length < 16) throw new Error('Flowboard access tokens must contain at least 16 characters')
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataDirectory = resolve(options.dataDirectory ?? join(dshHome, 'flowboard'))
  const apiBase = `http://${host}:${port}`
  const database = openDatabase({ path: join(dataDirectory, 'flowboard.db'), bootstrapToken: token })
  const repository = new SqliteFlowboardRepository(database, apiBase)
  const app = buildServer({
    repository,
    uploadDirectory: join(dataDirectory, 'uploads'),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  const whisper = resolveWhisperCommand()
  const transcriber = new CommandTranscriber(whisper.command, whisper.args, whisper.env)
  const abort = new AbortController()

  try {
    await app.listen({ host, port })
  } catch (error) {
    database.close()
    throw error
  }

  const worker = runTranscriptionWorkers(repository, transcriber, abort.signal)

  return {
    apiBase,
    token,
    async close() {
      abort.abort()
      await Promise.allSettled([worker, app.close()])
      database.close()
    },
  }
}
