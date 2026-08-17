#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import { access, glob, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const tarballs = []
for await (const file of glob('artifacts/flowboard-dsh-*.tgz')) tarballs.push(resolve(file))
if (tarballs.length !== 1) throw new Error(`Expected one plugin tarball, found ${tarballs.length}`)

function extract(tarball, destination) {
  return new Promise((resolveExtract, reject) => {
    const child = spawn('tar', ['-xzf', tarball, '-C', destination], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveExtract()
      else reject(new Error(`tar extraction failed (${signal ?? code})`))
    })
  })
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

const temporary = await mkdtemp(resolve(tmpdir(), 'flowboard-package-audit-'))
try {
  await extract(tarballs[0], temporary)
  const root = resolve(temporary, 'package')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (manifest.name !== '@flowboard/dsh') throw new Error(`Unexpected package name: ${manifest.name}`)
  if (Object.keys(manifest.dependencies ?? {}).some(name => name.startsWith('@flowboard/'))) {
    throw new Error('Packed plugin contains an internal @flowboard runtime dependency')
  }

  const required = [
    'README.md',
    'README.zh-CN.md',
    'LICENSE',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/client.js',
    'lib/typert.host.js',
    'vendor/whisper/LICENSE.whisper.cpp',
    'vendor/whisper/SHA256SUMS',
  ]
  for (const file of required) await access(resolve(root, file))
  await access(resolve(root, 'vendor/whisper/linux-x64/bin/whisper-cli'), constants.X_OK)

  for (const file of ['lib/index.js', 'lib/client.js', 'lib/typert.host.js']) {
    const source = await readFile(resolve(root, file), 'utf8')
    if (source.includes('@flowboard/dsh-service') || source.includes('@flowboard/dsh-client')) {
      throw new Error(`${file} leaks a private workspace package identity`)
    }
  }

  const whisperRoot = resolve(root, 'vendor/whisper')
  const checksumLines = (await readFile(resolve(whisperRoot, 'SHA256SUMS'), 'utf8')).trim().split('\n')
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (match === null) throw new Error(`Invalid packed SHA256SUMS line: ${line}`)
    const file = resolve(whisperRoot, match[2])
    const info = await stat(file)
    if (match[2].endsWith('ggml-small.bin') && info.size < 400_000_000) {
      throw new Error(`Packed Whisper model is incomplete (${info.size} bytes)`)
    }
    const actual = await sha256(file)
    if (actual !== match[1]) throw new Error(`Packed ${match[2]} checksum mismatch: ${actual}`)
  }

  console.log('packed @flowboard/dsh identity, contents, and Whisper checksums are valid')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
