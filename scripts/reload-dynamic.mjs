#!/usr/bin/env node
// 读取 dynamic 源码 → 解析环境变量 → 语法校验 → 产出可直接传给 cordis_define 的 code.host / code.client
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const apiBase = process.env.FLOWBOARD_API_BASE || 'http://127.0.0.1:8787'
const token = process.env.FLOWBOARD_TOKEN || 'flowboard-local-debug-token'

const read = (p) => readFile(resolve(root, p), 'utf8')

let host = await read('dynamic/flowboard.host.js')
host = host.replaceAll('${FLOWBOARD_API_BASE:-http://127.0.0.1:8787}', apiBase)
host = host.replaceAll('${FLOWBOARD_TOKEN:?FLOWBOARD_TOKEN is required}', token)

const client = await read('dynamic/flowboard.client.js')

// 语法校验（function body 平衡性）
try {
  new Function(host)
} catch (e) {
  console.error('host 语法错误:', e.message)
  process.exit(1)
}
try {
  new Function(client)
} catch (e) {
  console.error('client 语法错误:', e.message)
  process.exit(1)
}

const leftoverHost = (host.match(/\$\{/g) || []).length
const leftoverClient = (client.match(/\$\{/g) || []).length
if (leftoverHost > 0 || leftoverClient > 0) {
  console.error(`仍有未解析占位符: host=${leftoverHost} client=${leftoverClient}`)
  process.exit(1)
}

await mkdir(resolve(root, 'data'), { recursive: true })
await writeFile(resolve(root, 'data/.resolved-host.js'), host)
await writeFile(resolve(root, 'data/.resolved-client.js'), client)

console.log(JSON.stringify({
  apiBase,
  token,
  hostLen: host.length,
  clientLen: client.length,
  ok: true,
}))
