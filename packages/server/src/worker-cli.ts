#!/usr/bin/env node
import { resolve } from 'node:path'
import { openDatabase } from './database.ts'
import { SqliteFlowboardRepository } from './repository.ts'
import { CommandTranscriber, runTranscriptionWorkers } from './worker.ts'
import { resolveWhisperCommand } from './whisper-runtime.ts'

const whisper = resolveWhisperCommand()
const db = openDatabase({ path: resolve(process.env.FLOWBOARD_DB ?? 'data/flowboard.db') })
const repository = new SqliteFlowboardRepository(db, process.env.FLOWBOARD_PUBLIC_URL ?? 'http://127.0.0.1:8787')
const transcriber = new CommandTranscriber(whisper.command, whisper.args, whisper.env)
await runTranscriptionWorkers(repository, transcriber, new AbortController().signal)
