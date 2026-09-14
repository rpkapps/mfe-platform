import type { AppDefinition, WidgetDefinition } from '../definitions'
import type { AppManifest, Manifest, Release, WidgetManifest } from '../manifest'
import { PROTOCOL_VERSION, CAPABILITY_VERSIONS } from '../manifest'
import { createObserverStore } from '../observer'
import type { ActionState, ActionRunResult, InstanceStatus, NavigateOptions, ThemeSnapshot, UserSnapshot } from '../context'
import { createHostRuntime, type HostRuntime } from '../host/runtime'
import { createMemoryHistory } from '../host/history'
import type { IdentitySession } from '../host/identity'
import type { InstanceRun } from '../host/lifecycle'
import type { ConfirmationLog, RegistrationRecord } from '../host/actions'

export interface TestHostOptions {
  user?: Partial<UserSnapshot> & { id: string }
  permissions?: string[]
  config?: Record<string, unknown>
  release?: Partial<Release>
  /** Definitions of other MFEs the test needs (widgets, other apps), keyed by id. */
  definitions?: Record<string, AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>>
  url?: string
  timeouts?: Partial<{ resolve: number; load: number; mount: number; ready: number }>
  /** Default `true`: confirmations are auto-accepted. */
  autoConfirm?: boolean
  /** What the shell's "unsaved changes" prompt answers; default proceed. */
  promptLeave?: () => Promise<'proceed' | 'stay'>
}

export interface TestInstance {
  id: string
  status: InstanceStatus
  unmount(): Promise<void>
  readonly run: InstanceRun
}

export interface HttpCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

type Matcher = string | RegExp | ((request: Request) => boolean)
interface Mock {
  matcher: Matcher
  response: Response | ((request: Request) => Response | Promise<Response>)
}

export function createTestHost(options: TestHostOptions = {}) {
  const doc = document
  const content = doc.createElement('div')
  content.id = 'mfe-content'
  const overlays = doc.createElement('div')
  overlays.id = 'mfe-overlays'
  doc.body.append(content, overlays)

  const user: UserSnapshot = { id: 'test-user', displayName: 'Test User', email: 'test@example.com', ...(options.user ?? {}) }
  const session = createObserverStore<IdentitySession | null>({ user, groups: options.permissions ?? [] })
  const history = createMemoryHistory(options.url ?? 'http://localhost/')
  const definitions = new Map<string, AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>>()
  const mfes: Record<string, Manifest> = { ...(options.release?.mfes ?? {}) }
  for (const [id, def] of Object.entries(options.definitions ?? {})) {
    definitions.set(id, def)
    mfes[id] = syntheticManifest(id, def)
  }
  const release: Release = {
    id: 'test',
    createdAt: new Date().toISOString(),
    shell: 'test',
    protocol: PROTOCOL_VERSION,
    capabilities: { ...CAPABILITY_VERSIONS },
    shared: {},
    importMaps: [],
    ...options.release,
    mfes,
  }
  const calls: HttpCall[] = []
  const mocks: Mock[] = []
  const theme = createObserverStore<ThemeSnapshot>({ scheme: 'light' })
  let autoConfirm: boolean | undefined = options.autoConfirm ?? true

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => (headers[k] = v))
    calls.push({ url: request.url, method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().text() })
    for (const mock of [...mocks].reverse()) {
      const m = mock.matcher
      const hit = typeof m === 'string' ? request.url === new URL(m, request.url).toString() : m instanceof RegExp ? m.test(request.url) : m(request)
      if (hit) {
        const produce = typeof mock.response === 'function' ? mock.response(request) : Promise.resolve(mock.response.clone())
        return new Promise<Response>((resolve, reject) => {
          const abort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
          if (request.signal.aborted) return abort()
          request.signal.addEventListener('abort', abort, { once: true })
          Promise.resolve(produce).then(resolve, reject)
        })
      }
    }
    return new Response(JSON.stringify({ error: 'no mock' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const runtime: HostRuntime = createHostRuntime({
    release,
    document: doc,
    history,
    identity: { session, login: async () => {}, logout: async () => session.set(null) },
    fetch: fetchImpl,
    apiOrigins: [],
    pageOrigin: 'http://localhost',
    definitions,
    timeouts: options.timeouts,
    theme,
    confirmOverride: () => autoConfirm,
    promptLeave: options.promptLeave,
    product: 'Test',
  })
  runtime.attach({ content, overlays })

  const unmountedIds = new Set<string>()

  function wrap(run: InstanceRun): TestInstance {
    return {
      id: run.id,
      get status() {
        return run.status.get()
      },
      run,
      unmount: async () => {
        unmountedIds.add(run.id)
        await run.unmount()
      },
    }
  }

  async function mount(
    definition: AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>,
    opts: { url?: string; props?: unknown; contract?: number; id?: string } = {},
  ): Promise<TestInstance> {
    const id = opts.id ?? definition.id ?? ('basePath' in definition ? 'test-app' : 'test-widget')
    definitions.set(id, definition)
    release.mfes[id] = syntheticManifest(id, definition)
    if ('basePath' in definition) {
      await runtime.navigateUrl(new URL(opts.url ?? definition.basePath, 'http://localhost'))
      const app = runtime.currentApp()
      if (!app) throw new Error(`The test host did not mount ${id}: view is ${JSON.stringify(runtime.view.get())}`)
      await app.run.settled
      return wrap(app.run)
    }
    const element = doc.createElement('div')
    content.appendChild(element)
    const handle = await runtime.mountWidget(
      { id, contract: opts.contract ?? definition.contract.version, element, props: opts.props },
      { instanceId: 'test-consumer', mfeId: 'test', chain: ['test'], signal: runtime.signal },
    )
    const run = runtime.instances().find(r => r.id === handle.instanceId)!
    await run.settled
    return wrap(run)
  }

  return {
    runtime,
    release,
    elements: { content, overlays },
    mount,
    async settle() {
      for (let i = 0; i < 5; i += 1) await new Promise(r => setTimeout(r, 0))
    },
    state: (instance: TestInstance): InstanceStatus => instance.status,
    leaks() {
      const leaks: string[] = []
      for (const r of runtime.actions.registered()) if (unmountedIds.has(r.instanceId)) leaks.push(`action registration ${r.actionId} (${r.registrationId})`)
      for (const el of overlays.querySelectorAll('[data-mfe-instance]')) {
        const id = el.getAttribute('data-mfe-instance')!
        if (unmountedIds.has(id)) leaks.push(`overlay root of ${id}`)
      }
      for (const el of content.querySelectorAll('[data-mfe-instance]')) {
        const id = el.getAttribute('data-mfe-instance')!
        if (unmountedIds.has(id)) leaks.push(`element of ${id}`)
      }
      return leaks
    },
    navigation: {
      navigate: (o: NavigateOptions) => runtime.navigate(o),
      back: () => runtime.back(),
      forward: () => runtime.forward(),
      current: () => runtime.current.get(),
      view: () => runtime.view.get(),
    },
    identity: {
      set: (next: IdentitySession | null) => session.set(next),
      get: () => runtime.identity.get(),
    },
    permissions: {
      set(groups: string[]) {
        const s = session.get()
        if (s) session.set({ ...s, groups })
      },
    },
    theme: { set: (scheme: 'light' | 'dark') => theme.set({ scheme }) },
    actions: {
      registered: (): RegistrationRecord[] => runtime.actions.registered(),
      state: (o: { id: string; registrationId?: string }): ActionState => runtime.actions.state(o),
      run: (o: { id: string; registrationId?: string; confirm?: boolean }): Promise<ActionRunResult> => {
        const previous = autoConfirm
        if (o.confirm === false) autoConfirm = false
        return runtime.actions.run({ id: o.id, registrationId: o.registrationId, initiator: 'user' }).finally(() => (autoConfirm = previous))
      },
      confirmations: (): ConfirmationLog[] => runtime.actions.confirmations(),
    },
    page: { get: () => runtime.page.get() },
    http: {
      calls: () => calls.slice(),
      mock(matcher: Matcher, response: Response | Record<string, unknown> | ((request: Request) => Response | Promise<Response>)) {
        const r = response instanceof Response || typeof response === 'function' ? response : new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })
        mocks.push({ matcher, response: r })
      },
    },
    telemetry: { records: () => runtime.telemetry.records() },
    overlays: () => [...overlays.querySelectorAll('.mfe-overlay-root > *')],
    blockers: { active: () => runtime.blockersActive() },
    async dispose() {
      await runtime.dispose()
      content.remove()
      overlays.remove()
    },
  }
}

export type TestHost = ReturnType<typeof createTestHost>

function syntheticManifest(id: string, def: AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>): Manifest {
  const base = {
    manifest: 1 as const,
    id,
    version: '0.0.0',
    protocol: PROTOCOL_VERSION,
    title: def.title,
    capabilities: {},
    runtime: { framework: 'none' as const, shared: {} },
    entries: { main: { url: `./${id}.entry.js`, integrity: '' }, styles: [] },
    contributions: { releaseNotes: [], actions: [] },
    definitions: { pageEvents: [], storage: [] },
    dependencies: { widgets: [], links: [], permissions: [], serverEvents: [] },
    build: { sdk: 'test', builtAt: new Date().toISOString() },
  }
  if ('basePath' in def) {
    const m: AppManifest = { ...base, kind: 'app', basePath: def.basePath, paths: {}, redirects: def.redirects ?? {}, permissions: def.permissions, icon: def.icon }
    return m
  }
  const m: WidgetManifest = { ...base, kind: 'widget', contract: def.contract, props: {}, events: {} }
  return m
}
