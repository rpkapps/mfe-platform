/** §9.2 item 4 and §9.3: the one reactive shape in the platform. */
export interface Observer<T> {
  get(): T
  subscribe(listener: (value: T) => void, options?: { signal?: AbortSignal }): () => void
}

export interface ObserverStore<T> extends Observer<T> {
  /** Commits `next` and notifies synchronously in registration order; no-op when `Object.is(previous, next)`. */
  set(next: T): void
  /** After dispose: reads return the last snapshot, new subscriptions are no-ops, `set` is ignored (§9.3 Lifetime). */
  dispose(): void
  readonly disposed: boolean
}

export interface ObserverStoreOptions {
  /** Where a throwing listener is reported; defaults to console.error. Delivery to other listeners continues. */
  onListenerError?: (error: unknown) => void
}

export function createObserverStore<T>(initial: T, options: ObserverStoreOptions = {}): ObserverStore<T> {
  let value = initial
  let disposed = false
  const listeners = new Set<(value: T) => void>()
  const report = options.onListenerError ?? (e => console.error(e))

  return {
    get: () => value,
    get disposed() {
      return disposed
    },
    set(next) {
      if (disposed || Object.is(value, next)) return
      value = next
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue
        try {
          listener(next)
        } catch (error) {
          report(error)
        }
      }
    },
    subscribe(listener, opts) {
      const signal = opts?.signal
      if (disposed || signal?.aborted) return () => {}
      listeners.add(listener)
      let active = true
      const cleanup = () => {
        if (!active) return
        active = false
        listeners.delete(listener)
        signal?.removeEventListener('abort', cleanup)
      }
      signal?.addEventListener('abort', cleanup, { once: true })
      return cleanup
    },
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}

/** A read-only view over a store, so consumers cannot `set` (§9.3 Snapshot identity). */
export function readonlyObserver<T>(store: Observer<T>): Observer<T> {
  return { get: () => store.get(), subscribe: (l, o) => store.subscribe(l, o) }
}

/**
 * Derives an observer with `select`; notifies only when the selected value changes by `Object.is`.
 * Repeated calls on the same source/selector pair should be memoised by the caller (§9.3 Keyed observers).
 */
export function selectObserver<T, U>(source: Observer<T>, select: (value: T) => U): Observer<U> {
  let last = select(source.get())
  let lastSource = source.get()
  const current = () => {
    const s = source.get()
    if (!Object.is(s, lastSource)) {
      lastSource = s
      last = select(s)
    }
    return last
  }
  return {
    get: current,
    subscribe(listener, options) {
      let seen = current()
      return source.subscribe(() => {
        const next = current()
        if (Object.is(next, seen)) return
        seen = next
        listener(next)
      }, options)
    },
  }
}
