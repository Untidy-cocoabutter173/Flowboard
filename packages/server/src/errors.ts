export class FlowboardError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details: Record<string, string | number | boolean | null> | undefined

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: Record<string, string | number | boolean | null>,
  ) {
    super(message)
    this.name = 'FlowboardError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export function notFound(resource: string, id: string): FlowboardError {
  return new FlowboardError('NOT_FOUND', `${resource} "${id}" was not found`, 404, { resource, id })
}

export function forbidden(message = 'You do not have permission to perform this operation'): FlowboardError {
  return new FlowboardError('FORBIDDEN', message, 403)
}

export function conflict(message: string, details?: Record<string, string | number | boolean | null>): FlowboardError {
  return new FlowboardError('CONFLICT', message, 409, details)
}
