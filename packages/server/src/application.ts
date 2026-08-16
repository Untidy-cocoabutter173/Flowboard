import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  MAX_UPLOAD_BYTES,
  changesRequestSchema,
  commandRequestSchema,
  snapshotRequestSchema,
  transcriptionRequestSchema,
  uploadTicketRequestSchema,
} from '@flowboard/contracts'
import { FlowboardError } from './errors.ts'
import type { SqliteFlowboardRepository } from './repository.ts'

export interface ServerOptions {
  repository: SqliteFlowboardRepository
  uploadDirectory: string
  logger?: boolean
}

const uploadCorsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function tokenOf(request: FastifyRequest): string {
  const authorization = request.headers.authorization
  if (authorization === undefined || !authorization.startsWith('Bearer ') || authorization.length <= 7) {
    throw new FlowboardError('UNAUTHORIZED', 'A Bearer access token is required', 401)
  }
  return authorization.slice(7)
}

function numberQuery(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

async function waitForChanges(repository: SqliteFlowboardRepository, actor: ReturnType<SqliteFlowboardRepository['authenticate']>, cursor: number, waitMs: number) {
  const deadline = Date.now() + waitMs
  let result = repository.changes(actor, cursor)
  while (!result.changed && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))))
    result = repository.changes(actor, cursor)
  }
  return result
}

export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: MAX_UPLOAD_BYTES })
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body))
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body))

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof FlowboardError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } })
    }
    const validation = error as { name?: string; issues?: unknown }
    if (validation.name === 'ZodError') {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } })
    }
    app.log.error(error)
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  })

  app.get('/health', async () => ({ ok: true }))
  app.get('/v1/snapshot', async request => {
    const actor = options.repository.authenticate(tokenOf(request))
    const query = request.query as { projectId?: string }
    return options.repository.snapshot(actor, snapshotRequestSchema.parse({ projectId: query.projectId }))
  })
  app.post('/v1/commands', async request => {
    const actor = options.repository.authenticate(tokenOf(request))
    return options.repository.execute(actor, commandRequestSchema.parse(request.body))
  })
  app.get('/v1/changes', async request => {
    const actor = options.repository.authenticate(tokenOf(request))
    const query = request.query as { cursor?: string; waitMs?: string }
    const parsed = changesRequestSchema.parse({ cursor: numberQuery(query.cursor), waitMs: numberQuery(query.waitMs, 0) })
    return waitForChanges(options.repository, actor, parsed.cursor, parsed.waitMs ?? 0)
  })
  app.post('/v1/uploads/tickets', async request => {
    const actor = options.repository.authenticate(tokenOf(request))
    return options.repository.createUploadTicket(actor, uploadTicketRequestSchema.parse(request.body))
  })
  app.options('/v1/uploads/:token', async (_request, reply) => reply.headers(uploadCorsHeaders).status(204).send())
  app.put('/v1/uploads/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const body = request.body
    if (!Buffer.isBuffer(body)) throw new FlowboardError('INVALID_UPLOAD', 'Audio body is required')
    const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0] ?? ''
    await mkdir(options.uploadDirectory, { recursive: true })
    const path = join(options.uploadDirectory, `${randomUUID()}.audio`)
    await writeFile(path, body, { flag: 'wx' })
    try {
      const jobId = options.repository.consumeUploadTicket(token, body.byteLength, path, contentType)
      return reply.headers(uploadCorsHeaders).status(202).send({ jobId })
    } catch (error) {
      await unlink(path).catch(() => undefined)
      throw error
    }
  })
  app.get('/v1/transcriptions/:jobId', async request => {
    const actor = options.repository.authenticate(tokenOf(request))
    const parsed = transcriptionRequestSchema.parse(request.params)
    return options.repository.transcription(actor, parsed.jobId)
  })
  return app
}
