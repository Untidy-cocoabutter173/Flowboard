#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const source = resolve('packages/server/vendor/whisper')
const target = resolve('packages/dsh/vendor/whisper')

await rm(target, { recursive: true, force: true })
await mkdir(resolve(target, '..'), { recursive: true })
await cp(source, target, { recursive: true, force: true, preserveTimestamps: true })
await chmod(resolve(target, 'linux-x64/bin/whisper-cli'), 0o755)

const internalPackage = '@flowboard/dsh-service'
const publicPackage = '@flowboard/dsh'
const hostTypertSource = await readFile('packages/dsh-service/lib/typert.host.js', 'utf8')
await writeFile('packages/dsh/lib/typert.host.js', hostTypertSource.replaceAll(internalPackage, publicPackage))
const clientBundle = await readFile('packages/dsh/lib/client.js', 'utf8')
await writeFile('packages/dsh/lib/client.js', clientBundle.replaceAll(internalPackage, publicPackage))

await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, ['scripts/verify-whisper.mjs'], { stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Whisper verification failed (${code})`)))
})
