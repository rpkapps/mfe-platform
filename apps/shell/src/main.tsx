import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Release } from '@platform/sdk'
import { createObserverStore, type ThemeSnapshot } from '@platform/sdk'
import { createBrowserHistory, createHostRuntime, type HostRuntime, type OverrideResult } from '@platform/sdk/host'
import type { PlatformBoot, SharedSet } from './bootstrap'
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
  /** The shared-library sets the boot script loaded, one per React major. */
  sharedSets: SharedSet[]
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
  // src/bootstrap.ts ran before this module: environment, release, overrides and the import map are ready.
  const pre = (window as unknown as { __platform?: PlatformBoot }).__platform
  if (!pre) throw new Error('The boot script did not run; index.html is missing the platform bootstrap')
  if (pre.error || !pre.env || !pre.release) throw new Error(pre.error ?? 'The boot script produced no release')
  const env = pre.env as PlatformEnv
  const release = pre.release
  const devtools = pre.devtools ? { overrides: pre.overrides ?? { applied: {}, errors: {} } } : undefined
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
        content: { title: 'Unsaved changes', message: tx.kind === 'unload' ? 'Sign out and discard your changes?' : 'Leave this page and discard your changes?', confirmLabel: 'Leave' },
        signal: new AbortController().signal,
      })
      return ok ? 'proceed' : 'stay'
    },
    telemetry: env.PLATFORM_ENVIRONMENT === 'dev' ? record => console.debug('[telemetry]', record.type, record) : undefined,
    onActionError: (error, info) => window.dispatchEvent(new CustomEvent('platform:action-error', { detail: { error, info } })),
  })
  return { env, release, runtime, identity, confirmations, theme, devtools, sharedSets: pre.sharedSets ?? [] }
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
