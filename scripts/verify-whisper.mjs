#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceRoot = resolve('packages/server/vendor/whisper')
const stagedRoot = resolve('packages/dsh/vendor/whisper')
const checksumFile = resolve(sourceRoot, 'SHA256SUMS')

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verify(root) {
  await access(resolve(root, 'linux-x64/bin/whisper-cli'), constants.X_OK)
  const entries = (await readFile(checksumFile, 'utf8'))
    .trim()
    .split('\n')
    .map(line => {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
      if (match === null) throw new Error(`Invalid SHA256SUMS line: ${line}`)
      return { expected: match[1], relative: match[2] }
    })

  for (const { expected, relative } of entries) {
    const file = resolve(root, relative)
    const info = await stat(file)
    if (relative.endsWith('ggml-small.bin') && info.size < 400_000_000) {
      throw new Error(`${file} is not the complete bundled Whisper model (${info.size} bytes)`)
    }
    const actual = await sha256(file)
    if (actual !== expected) throw new Error(`${file} checksum mismatch: ${actual}`)
  }
}

await verify(sourceRoot)
try {
  await access(stagedRoot)
  await verify(stagedRoot)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

console.log('bundled Whisper 1.9.2 runtime and ggml-small model checksums are valid')
