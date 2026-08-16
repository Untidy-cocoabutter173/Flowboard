#!/usr/bin/env node
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { openDatabase } from './database.ts'
import { SqliteFlowboardRepository } from './repository.ts'
import { CommandTranscriber, processNextTranscription } from './worker.ts'

const command = process.env.FLOWBOARD_TRANSCRIBE_COMMAND
if (command === undefined) throw new Error('FLOWBOARD_TRANSCRIBE_COMMAND is required; stdout must be the transcript')
const args = JSON.parse(process.env.FLOWBOARD_TRANSCRIBE_ARGS ?? '[]') as unknown
if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error('FLOWBOARD_TRANSCRIBE_ARGS must be a JSON string array')
const db = openDatabase({ path: resolve(process.env.FLOWBOARD_DB ?? 'data/flowboard.db') })
const repository = new SqliteFlowboardRepository(db, process.env.FLOWBOARD_PUBLIC_URL ?? 'http://127.0.0.1:8787')
const transcriber = new CommandTranscriber(command, args)
while (true) {
  if (!await processNextTranscription(repository, transcriber)) await delay(1_000)
}
