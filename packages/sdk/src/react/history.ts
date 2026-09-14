import { createHistory, parseHref, type NavigationBlocker, type ParsedHistoryState, type RouterHistory } from '@tanstack/history'
import type { RouterBridge } from '../context'

/** A TanStack `RouterHistory` whose every push/replace goes through the bridge. */
export function createPlatformHistory(bridge: RouterBridge, signal: AbortSignal): RouterHistory {
  const origin = bridge.current().origin
  let lastHref = hrefOf(bridge.current())
  let state: unknown = null
  // `createHistory` keeps no blocker list of its own; `useBlocker` registers through these.
  let blockers: NavigationBlocker[] = []

  const history = createHistory({
    getBlockers: () => blockers,
    setBlockers: next => (blockers = next),
    getLocation: () => parseHref(hrefOf(bridge.current()), toState(state)),
    getLength: () => 1,
    pushState: (path, s) => {
      lastHref = path
      state = s
      void bridge.navigate(new URL(path, origin), { state: s })
    },
    replaceState: (path, s) => {
      lastHref = path
      state = s
      void bridge.navigate(new URL(path, origin), { replace: true, state: s })
    },
    go: n => bridge.go(n),
    back: () => bridge.go(-1),
    forward: () => bridge.go(1),
    createHref: path => path,
  })

  const stop = bridge.onNavigate((url, info) => {
    const href = hrefOf(url)
    state = info.state ?? null
    if (href === lastHref) return
    lastHref = href
    history.notify({ type: 'PUSH' })
  })
  signal.addEventListener('abort', stop, { once: true })

  // Cross-app navigations ask the router's own blockers.
  const unregister = bridge.registerBlocker({
    shouldBlock: async tx => {
      for (const blocker of blockers) {
        const blocked = await blocker.blockerFn({
          currentLocation: parseHref(hrefOf(tx.current), undefined),
          nextLocation: parseHref(hrefOf(tx.next), undefined),
          action: 'PUSH',
        })
        if (blocked) return true
      }
      return false
    },
  })
  signal.addEventListener('abort', unregister, { once: true })

  return history
}

function toState(state: unknown): ParsedHistoryState | undefined {
  if (!state || typeof state !== 'object') return undefined
  const s = state as Record<string, unknown>
  return {...s, __TSR_index: typeof s.__TSR_index === 'number' ? s.__TSR_index: 0 }
}

function hrefOf(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`
}
