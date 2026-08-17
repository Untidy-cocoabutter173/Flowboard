#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { glob, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dsh = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const tarballs = []
for await (const file of glob('artifacts/flowboard-dsh-*.tgz')) tarballs.push(resolve(file))
if (tarballs.length !== 1) throw new Error(`Expected one plugin tarball, found ${tarballs.length}`)

const home = await mkdtemp(resolve(tmpdir(), 'flowboard-dsh-install-'))
const environment = {
  ...process.env,
  CI: 'true',
  DSH_HOME: home,
  XDG_CACHE_HOME: resolve(home, 'cache'),
  XDG_DATA_HOME: resolve(home, 'data'),
}

function run(args, capture = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(dsh, args, {
      env: environment,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let output = ''
    if (capture) {
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun(output)
      else reject(new Error(`dsh ${args.join(' ')} failed (${signal ?? code})\n${output}`))
    })
  })
}

async function verifyBoot() {
  const port = 39080
  const child = spawn(dsh, ['web', '--port', String(port)], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  let exited = false
  const exit = new Promise(resolveExit => child.once('exit', (code, signal) => {
    exited = true
    resolveExit({ code, signal })
  }))

  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (exited) throw new Error(`DSH exited before becoming ready\n${output}`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}`)
        if (response.ok) return
      } catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 250))
    }
    throw new Error(`DSH did not become ready within 30 seconds\n${output}`)
  } finally {
    if (!exited) child.kill('SIGTERM')
    await exit
  }
}

try {
  await run(['plugin', '--profile', 'web', 'add', '--force', tarballs[0]])
  const config = await run(['--profile', 'web', '--dump-config'], true)
  if (!config.includes('@flowboard/dsh') || !config.includes('flowboard-service')) {
    throw new Error('Installed profile does not contain the Flowboard bundle layer')
  }
  await verifyBoot()
  await run(['plugin', '--profile', 'web', 'remove', '@flowboard/dsh'])
  console.log('isolated dsh plugin add, config composition, web boot, and remove lifecycle passed')
} finally {
  await rm(home, { recursive: true, force: true })
}
