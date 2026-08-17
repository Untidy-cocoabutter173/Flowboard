import { unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { SqliteFlowboardRepository } from './repository.ts'

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

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

export async function runTranscriptionWorkers(
  repository: SqliteFlowboardRepository,
  transcriber: Transcriber,
  signal: AbortSignal,
  concurrency = 2,
  pollMs = 200,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Transcription concurrency must be a positive integer')
  const active = new Set<Promise<void>>()
  let commitTail = Promise.resolve()

  const launch = (job: NonNullable<ReturnType<SqliteFlowboardRepository['claimTranscription']>>) => {
    const inference = transcriber.transcribe(job.audioPath, signal).then(
      text => ({ ok: true as const, text }),
      error => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
    )
    let committed: Promise<void>
    committed = commitTail.then(async () => {
      const result = await inference
      try {
        if (result.ok) repository.finishTranscription(job.id, result.text)
        else repository.failTranscription(job.id, result.error)
      } finally {
        await unlink(job.audioPath).catch(() => undefined)
      }
    }).finally(() => active.delete(committed))
    commitTail = committed.catch(() => undefined)
    active.add(committed)
  }

  while (!signal.aborted) {
    while (active.size < concurrency) {
      const job = repository.claimTranscription()
      if (job === undefined) break
      launch(job)
    }
    if (signal.aborted) break
    await Promise.race([
      active.size === 0 ? new Promise<void>(() => undefined) : Promise.race(active),
      wait(pollMs, signal),
    ])
  }
  await Promise.allSettled(active)
}
