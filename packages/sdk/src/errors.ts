export interface PlatformErrorOptions {
  capability?: string
  retryable?: boolean
  cause?: unknown
  details?: Record<string, unknown>
}

const RETRYABLE = new Set(['core/unavailable', 'core/timeout', 'core/network'])

/** §15. */
export class PlatformError extends Error {
  readonly code: string
  readonly capability?: string
  readonly retryable: boolean
  readonly details?: Record<string, unknown>
  override readonly cause?: unknown

  constructor(code: string, message: string, options: PlatformErrorOptions = {}) {
    super(message)
    this.name = 'PlatformError'
    this.code = code
    this.capability = options.capability
    this.retryable = options.retryable ?? RETRYABLE.has(code)
    this.details = options.details
    this.cause = options.cause
  }
}

/** §36.2: a non-2xx response from a convenience method; the response is unconsumed. */
export class HttpError extends PlatformError {
  override readonly code = 'http/status' as const
  readonly status: number
  readonly response: Response
  constructor(response: Response) {
    super('http/status', `HTTP ${response.status} for ${response.url}`, {
      capability: 'http',
      retryable: response.status === 429 || response.status >= 500,
      details: { status: response.status },
    })
    this.name = 'HttpError'
    this.status = response.status
    this.response = response
  }
}

export function isPlatformError(error: unknown, code?: string): error is PlatformError {
  return error instanceof PlatformError && (code === undefined || error.code === code)
}

export function abortedError(reason?: unknown): PlatformError {
  return new PlatformError('core/aborted', 'The operation was aborted', { cause: reason })
}
