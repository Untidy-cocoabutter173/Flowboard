#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises'

const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const plugin = await readJson('packages/dsh/package.json')
const root = await readJson('package.json')
const internalPackages = [
  'packages/contracts/package.json',
  'packages/dsh-client/package.json',
  'packages/dsh-service/package.json',
  'packages/server/package.json',
  'packages/typert-protocol-meta/package.json',
]

if (plugin.name !== '@flowboard/dsh') throw new Error('The public DSH package must be @flowboard/dsh')
if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(plugin.version)) throw new Error('Public releases must use an alpha prerelease version')
if (root.version !== plugin.version) throw new Error('Workspace and public plugin versions must match')
if (plugin.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Missing dsh.bundle patch manifest')
if (plugin.dsh?.client?.platform !== 'web') throw new Error('Missing web dsh.client manifest')
if (plugin.exports?.['./client'] !== './lib/client.js') throw new Error('The public package must export ./client')
if (plugin.exports?.['./typert'] !== './lib/typert.host.js') throw new Error('The public package must export ./typert')
if (!plugin.files?.includes('vendor/whisper/**/*')) throw new Error('The public package must ship bundled Whisper assets')
if (!plugin.files?.includes('LICENSE')) throw new Error('The public package must ship its MIT license')
if (plugin.publishConfig?.access !== 'public') throw new Error('The public package must opt into public scoped publishing')
if (root.private !== true) throw new Error('The workspace root must never be published')
if (Object.keys(plugin.dependencies ?? {}).some(name => name.startsWith('@flowboard/'))) {
  throw new Error('The public plugin must not depend on unpublished internal @flowboard packages')
}

for (const file of internalPackages) {
  const manifest = await readJson(file)
  if (manifest.private !== true) throw new Error(`${file} must remain private implementation detail`)
}

const patch = await readFile('packages/dsh/cordis.patch.yml', 'utf8')
if (!patch.includes("name: '@flowboard/dsh'")) throw new Error('Bundle patch must mount the public package')
if (patch.includes('@flowboard/dsh-service') || patch.includes('@flowboard/dsh-client')) {
  throw new Error('Bundle patch must not expose internal packages')
}
if (/token\s*:/.test(patch)) throw new Error('Bundle patch must not contain a static access token')

try {
  await access('.codex-plugin/plugin.json')
  throw new Error('Flowboard has one plugin identity: remove the unrelated Codex plugin manifest')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

console.log('The single public @flowboard/dsh plugin manifest is valid')
