import { createObserverStore } from '@platform/sdk'
import type { IdentitySession, IdentitySource } from '@platform/sdk/host'
import { shellConfig } from '../config'

export interface DevIdentity extends IdentitySource {
  profiles: typeof shellConfig.devProfiles
  signIn(profileId: string): void
}

const KEY = 'platform.dev.profile'

/** A development identity provider with selectable permission profiles; Authentik comes later. */
export function createDevIdentity(): DevIdentity {
  const profileOf = (id: string | null) => shellConfig.devProfiles.find(p => p.id === id)
  const toSession = (id: string | null): IdentitySession | null => {
    const p = profileOf(id)
    return p ? { user: p.user, groups: p.groups }: null
  }
  let stored: string | null = null
  try {
    stored = localStorage.getItem(KEY)
  } catch {
    stored = null
  }
  const session = createObserverStore<IdentitySession | null>(toSession(stored))
  const signIn = (profileId: string) => {
    try {
      localStorage.setItem(KEY, profileId)
    } catch {
      /* ignore */
    }
    session.set(toSession(profileId))
  }
  // Cross-tab coordination: storage events end or switch the session everywhere.
  window.addEventListener('storage', e => {
    if (e.key === KEY) session.set(toSession(e.newValue))
  })
  return {
    profiles: shellConfig.devProfiles,
    session,
    signIn,
    login: async () => signIn(shellConfig.devProfiles[0]!.id),
    logout: async () => {
      try {
        localStorage.removeItem(KEY)
      } catch {
        /* ignore */
      }
      session.set(null)
    },
  }
}
