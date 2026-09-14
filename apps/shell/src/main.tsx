import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Release } from '@platform/sdk'
import { createObserverStore, type ThemeSnapshot } from '@platform/sdk'
import { applyDevOverrides, createBrowserHistory, createHostRuntime, devtoolsEnabled, readDevOverrides, type HostRuntime, type OverrideResult } from '@platform/sdk/host'
import { createDevIdentity, type DevIdentity } from './providers/dev-identity'
import { shellConfig } from './config'
import { Shell } from './ui/Shell'
import { MaintenancePage } from './ui/pages'
import '@platform/sdk/styles.css'
import './styles.css'

export interface PlatformEnv {
  PLATFORM_ENVIRONMENT: string
  PLATFORM_REGISTRY_URL: string
  PLATFORM_CDN_URL: string
  PLATFORM_API_ORIGINS: string
  PLATFORM_IDENTITY_URL: string
  [key: string]: string
}

export interface ShellBoot {
  env: PlatformEnv
  release: Release
  runtime: HostRuntime
  identity: DevIdentity
  confirmations: ConfirmationBridge
  theme: ReturnType<typeof createObserverStore<ThemeSnapshot>>
  /** Set when localStorage `platform.devtools` is "true": the panel module is loaded only then. */
  devtools: { overrides: Pick<OverrideResult, 'applied' | 'errors'> } | undefined
}

/** The confirmation dialog lives in React; the runtime asks through this bridge. */
export interface ConfirmationBridge {
  ask(request: Parameters<NonNullable<Parameters<typeof createHostRuntime>[0]['confirm']>>[0]): Promise<boolean>
  set(handler: ConfirmationBridge['ask']): void
}

const mount = document.getElementById('shell')!
const root = createRoot(mount)

boot().then(
  b => root.render(<StrictMode><Shell boot={b} /></StrictMode>),
  (error: Error) => root.render(<MaintenancePage message={error.message} />),
)

async function boot(): Promise<ShellBoot> {
  // Environment values come from the container, never from the bundle.
  const env = (await fetch('/platform-env.json', { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`platform-env.json: HTTP ${r.status}`)
    return r.json()
  })) as PlatformEnv
  for (const key of ['PLATFORM_ENVIRONMENT', 'PLATFORM_REGISTRY_URL', 'PLATFORM_CDN_URL'] as const) {
    if (!env[key]) throw new Error(`Shell configuration is missing ${key}`)
  }
  let release = await loadRelease(env.PLATFORM_REGISTRY_URL)
  // Developer remaps from the DevTools panel apply here, before the release is pinned for the page.
  const devtools = devtoolsEnabled() ? { overrides: { applied: {}, errors: {} } as Pick<OverrideResult, 'applied' | 'errors'> } : undefined
  const overrides = readDevOverrides()
  if (Object.keys(overrides).length > 0) {
    const result = await applyDevOverrides(release, overrides)
    release = result.release
    if (devtools) devtools.overrides = { applied: result.applied, errors: result.errors }
    for (const [id, error] of Object.entries(result.errors)) console.warn(`DevTools override for "${id}" failed: ${error}`)
  }
  const identity = createDevIdentity()
  const theme = createObserverStore<ThemeSnapshot>({ scheme: readTheme() })
  theme.subscribe(t => document.documentElement.classList.toggle('dark', t.scheme === 'dark'))
  document.documentElement.classList.toggle('dark', theme.get().scheme === 'dark')

  let ask: ConfirmationBridge['ask'] = async () => true
  const confirmations: ConfirmationBridge = { ask: r => ask(r), set: h => (ask = h) }

  history.scrollRestoration = 'manual'
  const runtime = createHostRuntime({
    release,
    document,
    history: createBrowserHistory(),
    identity,
    apiOrigins: env.PLATFORM_API_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    cdnUrl: env.PLATFORM_CDN_URL,
    theme,
    product: shellConfig.product,
    confirm: r => confirmations.ask(r),
    promptLeave: async tx => {
      const ok = await confirmations.ask({
        actionId: 'shell.leave',
        content: { title: 'Unsaved changes', message: tx.kind === 'unload' ? 'Sign out and discard your changes?': 'Leave this page and discard your changes?', confirmLabel: 'Leave' },
        signal: new AbortController().signal,
      })
      return ok ? 'proceed': 'stay'
    },
    telemetry: env.PLATFORM_ENVIRONMENT === 'dev' ? record => console.debug('[telemetry]', record.type, record): undefined,
    onActionError: (error, info) => window.dispatchEvent(new CustomEvent('platform:action-error', { detail: { error, info } })),
  })
  return { env, release, runtime, identity, confirmations, theme, devtools }
}

const RELEASE_CACHE = 'platform.release'

/** One release per page; the last good one is kept for registry outages. */
async function loadRelease(registryUrl: string): Promise<Release> {
  try {
    const response = await fetch(`${registryUrl.replace(/\/+$/, '')}/release`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
    const release = (await response.json()) as Release
    try {
      localStorage.setItem(RELEASE_CACHE, JSON.stringify(release))
    } catch {
      /* ignore */
    }
    return release
  } catch (error) {
    let cached: string | null = null
    try {
      cached = localStorage.getItem(RELEASE_CACHE)
    } catch {
      cached = null
    }
    if (cached) {
      console.warn('registry unavailable; using the cached release', error)
      return JSON.parse(cached) as Release
    }
    throw new Error(`The registry at ${registryUrl} is unavailable and no release is cached (${error instanceof Error ? error.message: String(error)})`)
  }
}

function readTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('platform.theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* ignore */
  }
  return shellConfig.theme.default
}
