import { PlatformError, abortedError } from '../errors'

/** `AbortSignal.any` without relying on the runtime having it (jsdom does not). */
export function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController()
  const present = signals.filter((s): s is AbortSignal => !!s)
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason)
      return controller.signal
    }
  }
  const onAbort = (e: Event) => controller.abort((e.target as AbortSignal).reason)
  for (const s of present) s.addEventListener('abort', onAbort, { once: true })
  controller.signal.addEventListener('abort', () => present.forEach(s => s.removeEventListener('abort', onAbort)), { once: true })
  return controller.signal
}

export interface TimeoutOptions {
  ms: number
  signal?: AbortSignal
  what: string
}

/** Rejects with `core/timeout` after `ms`, or `core/aborted` when the signal fires first. */
export function withTimeout<T>(work: Promise<T>, { ms, signal, what }: TimeoutOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError(signal.reason))
    const timer = setTimeout(() => {
      cleanup()
      reject(new PlatformError('core/timeout', `${what} did not complete within ${ms} ms`))
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(abortedError(signal?.reason))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    work.then(
      v => {
        cleanup()
        resolve(v)
      },
      e => {
        cleanup()
        reject(e)
      },
    )
  })
}

let counter = 0
export function uniqueId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function toPlatformError(error: unknown, code = 'core/unavailable'): PlatformError {
  if (error instanceof PlatformError) return error
  if (error instanceof DOMException && error.name === 'AbortError') return abortedError(error)
  return new PlatformError(code, error instanceof Error ? error.message : String(error), { cause: error })
}

/** Sorted, frozen copy so consumers see a stable immutable snapshot (§33). */
export function frozenSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}

export function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
