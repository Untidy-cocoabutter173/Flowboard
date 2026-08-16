import { unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { SqliteFlowboardRepository } from './repository.ts'

export interface Transcriber {
  transcribe(audioPath: string, signal?: AbortSignal): Promise<string>
}

export class CommandTranscriber implements Transcriber {
  constructor(readonly command: string, readonly args: string[], readonly env?: NodeJS.ProcessEnv) {}

  transcribe(audioPath: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, [...this.args, audioPath], { signal, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
      child.on('error', reject)
      child.on('close', code => code === 0
        ? resolve(Buffer.concat(stdout).toString('utf8').trim())
        : reject(new Error(`transcriber exited with ${String(code)}: ${Buffer.concat(stderr).toString('utf8').slice(-2_000)}`)))
    })
  }
}

export async function processNextTranscription(repository: SqliteFlowboardRepository, transcriber: Transcriber, signal?: AbortSignal): Promise<boolean> {
  const job = repository.claimTranscription()
  if (job === undefined) return false
  try {
    const text = await transcriber.transcribe(job.audioPath, signal)
    repository.finishTranscription(job.id, text)
  } catch (error) {
    repository.failTranscription(job.id, error instanceof Error ? error.message : String(error))
  } finally {
    await unlink(job.audioPath).catch(() => undefined)
  }
  return true
}
