#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { glob, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(`Flowboard requires Node.js 22.19+; current version is ${process.versions.node}`)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dsh = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const dshHome = resolve(process.env.FLOWBOARD_DEV_DSH_HOME ?? resolve(root, '.dsh-dev'))
const environment = { ...process.env, DSH_HOME: dshHome }

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`))
    })
  })
}

console.log('[Flowboard] building the same DSH bundle that is distributed to users...')
await run(pnpm, ['run', 'check'])
await run(pnpm, ['run', 'plugin:pack'])

const tarballs = []
for await (const file of glob('artifacts/flowboard-dsh-*.tgz', { cwd: root })) tarballs.push(resolve(root, file))
if (tarballs.length !== 1) throw new Error(`Expected one Flowboard plugin tarball, found ${tarballs.length}`)

await mkdir(dshHome, { recursive: true })
console.log(`[Flowboard] installing ${tarballs[0]} into isolated DSH_HOME ${dshHome}`)
await run(dsh, ['plugin', '--profile', 'web', 'add', '--force', tarballs[0]])

const webPort = 3080
console.log('[Flowboard] starting the DSH web profile with the installed Flowboard bundle...')
console.log(`[Flowboard] Web: http://127.0.0.1:${webPort} · bundled Whisper: ready`)
const child = spawn(dsh, ['web', '--port', String(webPort)], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
})

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  child.kill(signal)
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

const result = await new Promise((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolveExit({ code, signal }))
})
if (result.signal !== null && !stopping) throw new Error(`dsh stopped by ${result.signal}`)
process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 0)
