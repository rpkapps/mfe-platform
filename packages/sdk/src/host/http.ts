import { HttpError, PlatformError } from '../errors'
import type { HttpClient, HttpReadOptions, HttpWriteOptions } from '../http'
import { anySignal } from './util'

export interface HttpClientOptions {
  /** The instance lifetime; every request is bounded by it. */
  signal: AbortSignal
  fetch?: typeof fetch
  /** Origins that receive platform credentials and CSRF metadata. Same-origin is always approved. */
  apiOrigins: readonly string[]
  pageOrigin: string
  /** Called with a 401 so the shell can react. The response is still returned to the caller. */
  onUnauthorized?: (response: Response) => void
  /** Sent as `X-CSRF-Token` to approved destinations when present. */
  csrfToken?: () => string | undefined
  traceId?: () => string
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const approved = new Set([options.pageOrigin,...options.apiOrigins.map(o => o.replace(/\/+$/, ''))])

  const isApproved = (url: URL) => approved.has(url.origin)

  async function doFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Relative URLs resolve against the page origin; `Request` itself requires absolute URLs.
    const base = input instanceof Request ? input: new Request(new URL(String(input), options.pageOrigin))
    const request = new Request(base, init)
    const url = new URL(request.url, options.pageOrigin)
    const signal = anySignal([options.signal, init?.signal ?? (input instanceof Request ? input.signal: undefined)])
    const headers = new Headers(request.headers)
    const platformInit: RequestInit = { signal, redirect: init?.redirect ?? 'follow' }
    if (isApproved(url)) {
      platformInit.credentials = init?.credentials ?? 'include'
      const csrf = options.csrfToken?.()
      if (csrf && !headers.has('X-CSRF-Token') && request.method !== 'GET' && request.method !== 'HEAD') headers.set('X-CSRF-Token', csrf)
      const trace = options.traceId?.()
      if (trace && !headers.has('traceparent')) headers.set('traceparent', trace)
    } else {
      // Outside the destination policy: no platform credentials or sensitive metadata.
      platformInit.credentials = 'omit'
      headers.delete('X-CSRF-Token')
      headers.delete('traceparent')
    }
    platformInit.headers = headers
    const response = await fetchImpl(new Request(request, platformInit))
    if (response.status === 401 && isApproved(url)) options.onUnauthorized?.(response)
    return response
  }

  async function json<T>(method: string, url: string | URL, opts: HttpWriteOptions | HttpReadOptions = {}): Promise<T | null> {
    const { json: jsonBody, body,...rest } = opts as HttpWriteOptions & { json?: unknown; body?: BodyInit | null }
    if (jsonBody !== undefined && body !== undefined) {
      throw new PlatformError('core/invalid-input', 'Supply either `json` or `body`, not both', { capability: 'http' })
    }
    if (method === 'GET' && (jsonBody !== undefined || body !== undefined)) {
      throw new PlatformError('core/invalid-input', '`get` accepts no body', { capability: 'http' })
    }
    const headers = new Headers(rest.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    let payload: BodyInit | null | undefined = body
    if (jsonBody !== undefined) {
      payload = JSON.stringify(jsonBody)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
    const response = await doFetch(url, {...rest, method, headers, body: payload })
    if (!response.ok) throw new HttpError(response)
    if (response.status === 204 || response.status === 205) return null
    const text = await response.text()
    if (text.length === 0) return null
    return JSON.parse(text) as T
  }

  return {
    fetch: doFetch,
    get: (url, o) => json('GET', url, o),
    post: (url, o) => json('POST', url, o),
    put: (url, o) => json('PUT', url, o),
    patch: (url, o) => json('PATCH', url, o),
    delete: (url, o) => json('DELETE', url, o),
  }
}
