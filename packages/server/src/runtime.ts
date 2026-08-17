import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildServer } from './application.ts'
import { openDatabase } from './database.ts'
import { SqliteFlowboardRepository } from './repository.ts'
import { CommandTranscriber, processNextTranscription } from './worker.ts'
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

export async function startFlowboardRuntime(options: FlowboardRuntimeOptions = {}): Promise<FlowboardRuntime> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 8787
  const token = options.token ?? 'flowboard-local'
  const dataDirectory = resolve(options.dataDirectory ?? join(homedir(), '.dsh', 'flowboard'))
  const apiBase = `http://${host}:${port}`
  const database = openDatabase({ path: join(dataDirectory, 'flowboard.db'), bootstrapToken: token })
  const repository = new SqliteFlowboardRepository(database, apiBase)
  const app = buildServer({
    repository,
    uploadDirectory: join(dataDirectory, 'uploads'),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  const whisper = resolveWhisperCommand()
  const transcriber = new CommandTranscriber(whisper.command, whisper.args, whisper.env, whisper.promptFlag)
  const abort = new AbortController()

  try {
    await app.listen({ host, port })
  } catch (error) {
    database.close()
    throw error
  }

  const worker = (async () => {
    while (!abort.signal.aborted) {
      if (await processNextTranscription(repository, transcriber, abort.signal)) continue
      try {
        await delay(1_000, undefined, { signal: abort.signal })
      } catch (error) {
        if (!abort.signal.aborted) throw error
      }
    }
  })()

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
