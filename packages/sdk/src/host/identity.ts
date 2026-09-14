import type { Observer } from '../observer'
import { createObserverStore, selectObserver } from '../observer'
import type { IdentityClient, IdentitySnapshot, PermissionsClient, UserSnapshot } from '../context'
import { frozenSorted, sameStringArray } from './util'

/** What an identity provider supplies. */
export interface IdentitySession {
  user: UserSnapshot
  groups: readonly string[]
  expiresAt?: string
}
export interface IdentitySource {
  session: Observer<IdentitySession | null>
  login(): Promise<void>
  logout(): Promise<void>
}

export interface IdentityState {
  /** Normalised snapshots, reference-stable while unchanged. */
  identity: Observer<IdentitySnapshot | null>
  groups: Observer<readonly string[]>
  /** Creates an instance-bound client that stops observing when `signal` aborts. */
  clientFor(signal: AbortSignal): { identity: IdentityClient; permissions: PermissionsClient }
  dispose(): void
}

export function createIdentityState(source: IdentitySource, hostSignal: AbortSignal): IdentityState {
  const toSnapshot = (s: IdentitySession | null): IdentitySnapshot | null =>
    s ? Object.freeze({ user: Object.freeze({...s.user }),...(s.expiresAt ? { expiresAt: s.expiresAt }: {}) }): null

  const identity = createObserverStore<IdentitySnapshot | null>(toSnapshot(source.session.get()))
  const groups = createObserverStore<readonly string[]>(frozenSorted(source.session.get()?.groups ?? []))

  const apply = (s: IdentitySession | null) => {
    const prev = identity.get()
    const next = toSnapshot(s)
    const changed = !prev !== !next || prev?.user.id !== next?.user.id || prev?.user.displayName !== next?.user.displayName || prev?.user.email !== next?.user.email || prev?.expiresAt !== next?.expiresAt
    if (changed) identity.set(next)
    const g = frozenSorted(s?.groups ?? [])
    if (!sameStringArray(g, groups.get())) groups.set(g)
  }
  const stop = source.session.subscribe(apply, { signal: hostSignal })
  // Reconcile once after subscribing so an intervening update is not missed.
  apply(source.session.get())

  return {
    identity,
    groups,
    clientFor(signal) {
      const keyed = new Map<string, Observer<boolean>>()
      const identityClient: IdentityClient = {
        get: () => identity.get(),
        subscribe: (l, o) => identity.subscribe(l, { signal: o?.signal ? anySig(signal, o.signal): signal }),
        login: () => source.login(),
        logout: () => source.logout(),
      }
      const permissions: PermissionsClient = {
        can: id => groups.get().includes(id),
        observe(id) {
          let o = keyed.get(id)
          if (!o) {
            o = selectObserver(groups, g => g.includes(id))
            keyed.set(id, o)
          }
          return o
        },
        subscribe: (l, o) => groups.subscribe(l, { signal: o?.signal ? anySig(signal, o.signal): signal }),
      }
      return { identity: identityClient, permissions }
    },
    dispose() {
      stop()
      identity.dispose()
      groups.dispose()
    },
  }
}

function anySig(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController()
  const abort = () => c.abort()
  if (a.aborted || b.aborted) c.abort()
  else {
    a.addEventListener('abort', abort, { once: true })
    b.addEventListener('abort', abort, { once: true })
  }
  return c.signal
}
