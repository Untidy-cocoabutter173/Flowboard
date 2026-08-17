import { constants, accessSync, chmodSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import process from 'node:process'

export interface WhisperCommand {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

function parseArgs(value: string | undefined): string[] {
  const parsed = JSON.parse(value ?? '[]') as unknown
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('FLOWBOARD_TRANSCRIBE_ARGS must be a JSON string array')
  }
  return parsed
}

function ensureExecutable(command: string): void {
  try {
    accessSync(command, constants.X_OK)
  } catch {
    try {
      chmodSync(command, 0o755)
      accessSync(command, constants.X_OK)
    } catch (cause) {
      throw new Error(`Bundled Whisper CLI is not executable: ${command}`, { cause })
    }
  }
}

export function resolveWhisperCommand(environment: NodeJS.ProcessEnv = process.env): WhisperCommand {
  if (environment.FLOWBOARD_TRANSCRIBE_COMMAND !== undefined) {
    return { command: environment.FLOWBOARD_TRANSCRIBE_COMMAND, args: parseArgs(environment.FLOWBOARD_TRANSCRIBE_ARGS) }
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`The bundled Flowboard transcriber does not support ${process.platform}-${process.arch}`)
  }

  const root = resolve(import.meta.dirname, '../vendor/whisper/linux-x64')
  const libraryDirectory = resolve(root, 'lib')
  const inheritedLibraryPath = environment.LD_LIBRARY_PATH
  const language = environment.FLOWBOARD_TRANSCRIBE_LANGUAGE?.trim() || 'zh'
  const command = resolve(root, 'bin/whisper-cli')
  ensureExecutable(command)
  return {
    command,
    args: ['-m', resolve(root, 'models/ggml-small.bin'), '-l', language, '-np', '-nt'],
    env: {
      ...environment,
      LD_LIBRARY_PATH: inheritedLibraryPath === undefined || inheritedLibraryPath === ''
        ? libraryDirectory
        : `${libraryDirectory}${delimiter}${inheritedLibraryPath}`,
    },
  }
}
