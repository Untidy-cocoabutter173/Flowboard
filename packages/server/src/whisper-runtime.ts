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
  return {
    command: resolve(root, 'bin/whisper-cli'),
    args: ['-m', resolve(root, 'models/ggml-base.bin'), '-l', 'auto', '-np', '-nt'],
    env: {
      ...environment,
      LD_LIBRARY_PATH: inheritedLibraryPath === undefined || inheritedLibraryPath === ''
        ? libraryDirectory
        : `${libraryDirectory}${delimiter}${inheritedLibraryPath}`,
    },
  }
}
