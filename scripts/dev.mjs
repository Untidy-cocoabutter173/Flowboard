#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(`Flowboard requires Node.js 22.19+; current version is ${process.versions.node}`)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const dsh = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`))
    })
  })
}

async function ensureWorkspaceLink(packageName, packagePath) {
  const scopeDirectory = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'node_modules', '@flowboard')
  const linkPath = join(scopeDirectory, packageName)
  await mkdir(scopeDirectory, { recursive: true })
  try {
    const stat = await lstat(linkPath)
    if (stat.isSymbolicLink() && resolve(scopeDirectory, await readlink(linkPath)) === packagePath) return
    throw new Error(`${linkPath} already exists and does not point to ${packagePath}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await symlink(packagePath, linkPath, 'dir')
}

console.log('[Flowboard] validating sources and building the static plugin...')
await run(pnpm, ['run', 'dynamic:check'])
await run(pnpm, ['run', 'typecheck'])
await run(pnpm, ['run', 'build'])

const apiPort = 8787
const webPort = 3080
await ensureWorkspaceLink('dsh-service', resolve(root, 'packages/dsh-service'))
await ensureWorkspaceLink('dsh-client', resolve(root, 'packages/dsh-client'))
const patchDirectory = await mkdtemp(resolve(tmpdir(), 'flowboard-dev-'))
const patchPath = resolve(patchDirectory, 'cordis.patch.yml')
await writeFile(patchPath, `- insert:
    - id: flowboard-service
      name: '@flowboard/dsh-service'
      config:
        embedded: true
        apiBase: 'http://127.0.0.1:${apiPort}'
        host: '127.0.0.1'
        port: ${apiPort}
        token: 'flowboard-local'
        dataDirectory: ${JSON.stringify(resolve(root, 'data'))}
    - id: flowboard-client
      name: '@flowboard/dsh-client'
`)

console.log('[Flowboard] starting DSH with the local Flowboard workspace...')
console.log(`[Flowboard] Web: http://127.0.0.1:${webPort} · API: http://127.0.0.1:${apiPort} · bundled AI transcription: ready`)
const child = spawn(dsh, ['web', '--patch', patchPath, '--port', String(webPort)], {
  cwd: root,
  env: process.env,
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
await rm(patchDirectory, { recursive: true, force: true })
if (result.signal !== null && !stopping) throw new Error(`dsh stopped by ${result.signal}`)
process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 0)
