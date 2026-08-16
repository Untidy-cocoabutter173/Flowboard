import { describe, expect, it } from 'vitest'
import { resolveWhisperCommand } from '../src/whisper-runtime.ts'

describe('bundled whisper runtime', () => {
  it('uses the packaged executable and model with no configuration', () => {
    const resolved = resolveWhisperCommand({})
    expect(resolved.command).toMatch(/vendor\/whisper\/linux-x64\/bin\/whisper-cli$/)
    expect(resolved.args).toEqual(expect.arrayContaining(['-m', expect.stringMatching(/ggml-base\.bin$/), '-l', 'auto', '-np', '-nt']))
    expect(resolved.env?.LD_LIBRARY_PATH).toMatch(/vendor\/whisper\/linux-x64\/lib/)
  })

  it('retains an explicit advanced command override', () => {
    expect(resolveWhisperCommand({ FLOWBOARD_TRANSCRIBE_COMMAND: 'custom-asr', FLOWBOARD_TRANSCRIBE_ARGS: '["--fast"]' }))
      .toEqual({ command: 'custom-asr', args: ['--fast'] })
  })
})
