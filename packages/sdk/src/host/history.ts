import type { Observer } from '../observer'
import { createObserverStore } from '../observer'

/** The only thing that touches `window.history`; the test host uses the memory implementation. */
export interface HistoryAdapter {
  location(): URL
  push(url: URL, state: unknown): void
  replace(url: URL, state: unknown): void
  go(delta: number): void
  state(): unknown
  /** Fired for browser-initiated changes (popstate). */
  onPop(listener: (url: URL, state: unknown) => void): () => void
  length(): number
}

export function createBrowserHistory(win: Window = window): HistoryAdapter {
  return {
    location: () => new URL(win.location.href),
    push: (url, state) => win.history.pushState(state, '', url.toString()),
    replace: (url, state) => win.history.replaceState(state, '', url.toString()),
    go: delta => win.history.go(delta),
    state: () => win.history.state,
    length: () => win.history.length,
    onPop(listener) {
      const handler = () => listener(new URL(win.location.href), win.history.state)
      win.addEventListener('popstate', handler)
      return () => win.removeEventListener('popstate', handler)
    },
  }
}

export interface MemoryHistory extends HistoryAdapter {
  entries: Observer<Array<{ url: URL; state: unknown }>>
  index: Observer<number>
}

export function createMemoryHistory(initial = 'http://localhost/'): MemoryHistory {
  const entries = createObserverStore<Array<{ url: URL; state: unknown }>>([{ url: new URL(initial), state: null }])
  const index = createObserverStore(0)
  const pops = new Set<(url: URL, state: unknown) => void>()
  const current = () => entries.get()[index.get()]!
  return {
    entries,
    index,
    location: () => new URL(current().url.toString()),
    state: () => current().state,
    length: () => entries.get().length,
    push(url, state) {
      const next = entries.get().slice(0, index.get() + 1)
      next.push({ url: new URL(url.toString()), state })
      entries.set(next)
      index.set(next.length - 1)
    },
    replace(url, state) {
      const next = entries.get().slice()
      next[index.get()] = { url: new URL(url.toString()), state }
      entries.set(next)
    },
    go(delta) {
      const target = index.get() + delta
      if (target < 0 || target >= entries.get().length) return
      index.set(target)
      const entry = current()
      // Browsers deliver popstate asynchronously; so do we.
      queueMicrotask(() => pops.forEach(l => l(new URL(entry.url.toString()), entry.state)))
    },
    onPop(listener) {
      pops.add(listener)
      return () => pops.delete(listener)
    },
  }
}
