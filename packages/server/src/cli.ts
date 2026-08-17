#!/usr/bin/env node
import { resolve } from 'node:path'
import { buildServer } from './application.ts'
import { openDatabase } from './database.ts'
import { SqliteFlowboardRepository } from './repository.ts'

const host = process.env.FLOWBOARD_HOST ?? '127.0.0.1'
const port = Number(process.env.FLOWBOARD_PORT ?? 8787)
const token = process.env.FLOWBOARD_TOKEN
if (token === undefined || token.length < 16) throw new Error('FLOWBOARD_TOKEN must contain at least 16 characters')
const db = openDatabase({ path: resolve(process.env.FLOWBOARD_DB ?? 'data/flowboard.db'), bootstrapToken: token })
const publicBaseUrl = process.env.FLOWBOARD_PUBLIC_URL ?? `http://${host}:${port}`
const repository = new SqliteFlowboardRepository(db, publicBaseUrl)
const app = buildServer({ repository, uploadDirectory: resolve(process.env.FLOWBOARD_UPLOAD_DIR ?? 'data/uploads'), logger: true })
await app.listen({ host, port })
