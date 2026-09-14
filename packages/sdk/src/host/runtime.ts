import { PlatformError } from '../errors'
import type {
  ActionsClient,
  AppInstance,
  AppMountContext,
  BlockedTransaction,
  BlockerHandle,
  IdentitySnapshot,
  InstanceStatus,
  LocaleSnapshot,
  NavigateOptions,
  NavigationBlocker,
  NavigationClient,
  NavigationOutcome,
  PageMeta,
  PlatformClient,
  RouterBridge,
  ThemeSnapshot,
  WidgetHandle,
  WidgetInstance,
  WidgetMountContext,
  WidgetMountOptions,
  WidgetsClient,
} from '../context'
import type { AppDefinition, WidgetDefinition } from '../definitions'
import { requirementSatisfied } from '../definitions'
import type { AppManifest, Manifest, ManifestAction, Release, WidgetManifest } from '../manifest'
import { PROTOCOL_VERSION, CAPABILITY_VERSIONS, scopeToken } from '../manifest'
import type { Observer, ObserverStore } from '../observer'
import { createObserverStore } from '../observer'
import { validate } from '../schema'
import { createActionHost, type ActionHost, type ConfirmationRequest } from './actions'
import type { HistoryAdapter } from './history'
import { createHttpClient } from './http'
import { createIdentityState, type IdentitySource } from './identity'
import { DEFAULT_TIMEOUTS, runInstance, type InstanceRun, type LifecycleTimeouts } from './lifecycle'
import { buildPath, findOwningApp } from './paths'
import { createStyleLoader, markScope } from './scope'
import { createTelemetry, type TelemetryWriter } from './telemetry'
import { anySignal, toPlatformError, uniqueId } from './util'

export interface HostRuntimeOptions {
  release: Release
  document: Document
  history: HistoryAdapter
  identity: IdentitySource
  /** Origins that receive platform credentials; the page origin is always included. */
  apiOrigins?: readonly string[]
  pageOrigin?: string
  /** Base for relative artifact URLs in manifests (PLATFORM_CDN_URL). */
  cdnUrl?: string
  fetch?: typeof fetch
  importModule?: (url: string) => Promise<unknown>
  /** Definitions available without loading: dev overrides and the test host. */
  definitions?: Map<string, AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>>
  timeouts?: Partial<LifecycleTimeouts>
  telemetry?: TelemetryWriter
  /** Shell-rendered confirmation. */
  confirm?: (request: ConfirmationRequest) => Promise<boolean>
  /** Shell-rendered "unsaved changes" prompt. Default: proceed. */
  promptLeave?: (tx: BlockedTransaction) => Promise<'proceed' | 'stay'>
  onActionError?: (error: PlatformError, info: { actionId: string; registrationId: string }) => void
  theme?: ObserverStore<ThemeSnapshot>
  locale?: ObserverStore<LocaleSnapshot>
  product?: string
  /** Test-only confirmation override. */
  confirmOverride?: () => boolean | undefined
}

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'app'; mfeId: string; instanceId: string; status: InstanceStatus; error?: PlatformError }
  | { kind: 'not-found'; url: URL }
  | { kind: 'forbidden'; mfeId: string }
  | { kind: 'signed-out'; intended: URL }

interface AppRecord {
  run: InstanceRun<AppInstance>
  manifest: AppManifest
  element: HTMLElement
  overlayRoot: HTMLElement
  bridgeListeners: Set<(url: URL, info: { replace: boolean; state: unknown }) => void>
  page: ObserverStore<PageMeta>
  scroll?: { x: number; y: number }
}

interface BlockerRecord {
  blocker: NavigationBlocker
  instanceId: string
  /** Router-bridged blockers already ran for within-app navigations the router initiated. */
  fromRouter: boolean
  status: ObserverStore<'idle' | 'blocked'>
  resolveBlocked?: (decision: 'proceed' | 'stay') => void
}

interface PlatformState {
  txId: string
  appId?: string
  scroll?: { x: number; y: number }
}

export function createHostRuntime(options: HostRuntimeOptions) {
  const doc = options.document
  const hostController = new AbortController()
  const hostSignal = hostController.signal
  const telemetry = createTelemetry(options.telemetry)
  const timeouts = {...DEFAULT_TIMEOUTS,...options.timeouts }
  const pageOrigin = options.pageOrigin ?? options.history.location().origin
  const cdnUrl = options.cdnUrl ?? pageOrigin
  const importModule = options.importModule ?? (url => import(/* @vite-ignore */ url))
  const theme = options.theme ?? createObserverStore<ThemeSnapshot>({ scheme: 'light' })
  const locale = options.locale ?? createObserverStore<LocaleSnapshot>({ locale: 'en', direction: 'ltr' })
  const identityState = createIdentityState(options.identity, hostSignal)
  const styles = createStyleLoader(doc, url => new URL(url, cdnUrl).toString())
  const release = options.release
  const definitions = options.definitions ?? new Map()

  let content: HTMLElement | undefined
  let overlays: HTMLElement | undefined
  let currentApp: AppRecord | undefined
  let navSeq = 0
  const current = createObserverStore<URL>(options.history.location())
  const view = createObserverStore<ViewState>({ kind: 'idle' })
  const blockers = new Map<string, BlockerRecord>()
  const instances = new Map<string, InstanceRun>()
  // Ticks when an instance is added, removed, or changes state; DevTools subscribes to it.
  const instancesChanged = createObserverStore(0)
  const trackInstance = (run: InstanceRun) => {
    instances.set(run.id, run)
    instancesChanged.set(instancesChanged.get() + 1)
    run.state.subscribe(() => instancesChanged.set(instancesChanged.get() + 1))
  }
  const widgetChains = new Map<string, string[]>()
  const pageMetaListeners = new Set<(meta: PageMeta) => void>()

  // Computed per call: the release is pinned, but the test host and dev overrides may add manifests after start.
  const staticActions = () => {
    const map = new Map<string, ManifestAction>()
    for (const m of Object.values(release.mfes)) for (const a of m.contributions.actions) map.set(a.id, a)
    return map
  }

  const actions: ActionHost = createActionHost({
    groups: identityState.groups,
    staticActions,
    confirm: options.confirm ?? (async () => true),
    navigate: o => navigate(o),
    telemetry,
    onError: options.onActionError,
    confirmOverride: options.confirmOverride,
  })

  function checkCompatible(manifest: Manifest) {
    if (manifest.protocol !== PROTOCOL_VERSION) {
      throw new PlatformError('core/incompatible', `${manifest.id} needs protocol ${manifest.protocol}; this shell provides ${PROTOCOL_VERSION}`)
    }
    for (const [cap, major] of Object.entries(manifest.capabilities)) {
      if (CAPABILITY_VERSIONS[cap] !== major) {
        throw new PlatformError('core/incompatible', `${manifest.id} needs ${cap} v${major}; this shell provides v${CAPABILITY_VERSIONS[cap] ?? 'none'}`)
      }
    }
  }

  async function loadDefinition(manifest: Manifest, signal: AbortSignal): Promise<AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>> {
    const local = definitions.get(manifest.id)
    if (local) return local
    await styles.ensure(manifest, signal)
    const url = new URL(manifest.entries.main.url, cdnUrl).toString()
    const mod = (await importModule(url)) as { default?: unknown }
    const def = mod?.default as Record<string, unknown> | undefined
    if (!def || typeof def.mount !== 'function') {
      throw new PlatformError('core/invalid-input', `${manifest.id}: entry module default export is not a definition`)
    }
    if (manifest.kind === 'app' && typeof def.basePath !== 'string') throw new PlatformError('core/invalid-input', `${manifest.id}: app definition has no basePath`)
    if (manifest.kind === 'widget' && typeof def.contract !== 'object') throw new PlatformError('core/invalid-input', `${manifest.id}: widget definition has no contract`)
    return def as unknown as AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>
  }

  // ---- per-instance platform client ----

  function platformFor(instanceId: string, mfeId: string, signal: AbortSignal, chain: string[]): PlatformClient {
    const ids = identityState.clientFor(signal)
    const navigationClient: NavigationClient = {
      navigate: o => navigate(o),
      href: o => buildPath(o),
      current,
      block(o) {
        return registerBlocker({ shouldBlock: o.shouldBlock, prompt: o.prompt }, instanceId, false, anySignal([signal, o.signal]))
      },
    }
    const http = createHttpClient({
      signal,
      fetch: options.fetch,
      apiOrigins: options.apiOrigins ?? [],
      pageOrigin,
      onUnauthorized: () => signOut(),
    })
    const widgets: WidgetsClient = {
      mount: o => mountWidget(o, { instanceId, mfeId, chain, signal }),
    }
    const actionsClient: ActionsClient = {
      run: o => actions.run({...o, initiator: 'system', focusedInstanceId: instanceId }),
    }
    return { identity: ids.identity, permissions: ids.permissions, navigation: navigationClient, http, widgets, actions: actionsClient }
  }

  function reportErrorFor(run: () => InstanceRun | undefined, mfeId: string) {
    return (error: unknown, info?: { fatal?: boolean }) => {
      const err = toPlatformError(error)
      telemetry.emit('mfe.error', { mfeId, instanceId: run()?.id, fatal: !!info?.fatal, code: err.code, message: err.message })
      if (info?.fatal) run()?.unmount()
    }
  }

  // ---- apps ----

  function createOverlayRoot(scope: string, instanceId: string): HTMLElement {
    const root = doc.createElement('div')
    root.className = 'mfe-overlay-root'
    markScope(root, scope, instanceId);(overlays ?? doc.body).appendChild(root)
    return root
  }

  function startApp(manifest: AppManifest, url: URL): AppRecord {
    const instanceId = uniqueId('app')
    const scope = scopeToken(manifest.id, manifest.version)
    const element = doc.createElement('div')
    element.className = 'mfe-app'
    markScope(element, scope, instanceId);(content ?? doc.body).appendChild(element)
    const overlayRoot = createOverlayRoot(scope, instanceId)
    const page = createObserverStore<PageMeta>({ title: manifest.title })
    const bridgeListeners = new Set<AppRecord['bridgeListeners'] extends Set<infer L> ? L: never>()
    let record!: AppRecord

    const run = runInstance<AppDefinition, AppInstance>({
      id: instanceId,
      mfeId: manifest.id,
      kind: 'app',
      timeouts,
      telemetry,
      resolve: async () => checkCompatible(manifest),
      load: signal => loadDefinition(manifest, signal) as Promise<AppDefinition>,
      mount: async (definition, signal) => {
        const bridge: RouterBridge = {
          current: () => current.get(),
          onNavigate(listener) {
            bridgeListeners.add(listener)
            return () => bridgeListeners.delete(listener)
          },
          navigate: (u, o) => navigateUrl(u, { replace: o?.replace, state: o?.state, source: 'router' }),
          registerBlocker(blocker) {
            const handle = registerBlocker(blocker, instanceId, true, signal)
            return () => handle.release()
          },
          restoreScroll: () => (options.history.state() as { __platform?: PlatformState } | null)?.__platform?.scroll,
          go: delta => options.history.go(delta),
        }
        const ctx: AppMountContext = {
          kind: 'app',
          element,
          signal,
          platform: platformFor(instanceId, manifest.id, signal, [manifest.id]),
          instance: { id: instanceId, mfeId: manifest.id, version: manifest.version, scope },
          overlayRoot,
          reportError: reportErrorFor(() => record.run, manifest.id),
          locale,
          theme,
          basePath: manifest.basePath,
          initialUrl: url,
          router: bridge,
          page: {
            set: meta => {
              page.set(Object.freeze({...page.get(),...meta }))
              pageMetaListeners.forEach(l => l(page.get()))
            },
            get: () => page.get(),
          },
          actions: actions.registryFor(instanceId, manifest.id, signal),
        }
        return definition.mount(ctx)
      },
      cleanup: () => {
        element.remove()
        overlayRoot.remove()
        bridgeListeners.clear()
        page.dispose()
        instances.delete(instanceId)
        instancesChanged.set(instancesChanged.get() + 1)
        for (const [id, b] of blockers) if (b.instanceId === instanceId) blockers.delete(id)
      },
    })
    record = { run, manifest, element, overlayRoot, bridgeListeners, page }
    trackInstance(run)
    run.status.subscribe(s => {
      if (s === 'unmounted' && currentApp === record) currentApp = undefined
    })
    return record
  }

  function publishView(record: AppRecord) {
    const update = () => {
      if (currentApp !== record) return
      view.set({ kind: 'app', mfeId: record.manifest.id, instanceId: record.run.id, status: record.run.status.get(), error: record.run.error })
    }
    update()
    record.run.status.subscribe(update)
  }

  // ---- navigation ----

  function registerBlocker(blocker: NavigationBlocker, instanceId: string, fromRouter: boolean, signal: AbortSignal): BlockerHandle {
    const id = uniqueId('blocker')
    const status = createObserverStore<'idle' | 'blocked'>('idle')
    const rec: BlockerRecord = { blocker, instanceId, fromRouter, status }
    blockers.set(id, rec)
    const release = () => {
      blockers.delete(id)
      rec.resolveBlocked?.('proceed')
      status.dispose()
    }
    if (signal.aborted) release()
    else signal.addEventListener('abort', release, { once: true })
    return {
      status,
      proceed: () => rec.resolveBlocked?.('proceed'),
      reset: () => rec.resolveBlocked?.('stay'),
      release,
    }
  }

  async function askBlockers(tx: BlockedTransaction, skipRouterBlockers: boolean): Promise<'proceed' | 'stay'> {
    for (const rec of [...blockers.values()]) {
      if (skipRouterBlockers && rec.fromRouter) continue
      let blocked: boolean
      try {
        blocked = await rec.blocker.shouldBlock(tx)
      } catch (error) {
        telemetry.emit('blocker.error', { instanceId: rec.instanceId, error: error instanceof Error ? error.message: String(error) })
        blocked = false
      }
      if (!blocked) continue
      rec.status.set('blocked')
      const decision = await new Promise<'proceed' | 'stay'>(resolve => {
        rec.resolveBlocked = resolve
        const prompt = rec.blocker.prompt ?? options.promptLeave ?? (async () => 'proceed' as const)
        prompt(tx).then(resolve, () => resolve('stay'))
      })
      rec.resolveBlocked = undefined
      if (!rec.status.disposed) rec.status.set('idle')
      if (decision === 'stay') return 'stay'
    }
    return 'proceed'
  }

  function navigate(o: NavigateOptions): Promise<NavigationOutcome> {
    const url = new URL(buildPath(o), current.get())
    return navigateUrl(url, { replace: o.replace, state: o.state, source: 'navigate' })
  }

  interface GoOptions {
    replace?: boolean
    state?: unknown
    source: 'navigate' | 'router' | 'pop' | 'initial' | 'reenter'
    popDelta?: number
  }

  async function navigateUrl(url: URL, o: GoOptions): Promise<NavigationOutcome> {
    if (url.origin !== pageOrigin) {
      doc.defaultView?.location.assign(url.toString())
      return 'committed'
    }
    const seq = ++navSeq
    const from = current.get()
    const owner = findOwningApp(release.mfes, url.pathname)
    const live = currentApp && (currentApp.run.status.get() === 'loading' || currentApp.run.status.get() === 'ready')
    const withinApp = !!live && !!owner && owner.id === currentApp!.manifest.id

    if (o.source !== 'initial' && o.source !== 'reenter' && !(withinApp && o.source === 'router')) {
      const kind: BlockedTransaction['kind'] = withinApp ? 'within-app': 'cross-app'
      const decision = await askBlockers({ current: from, next: url, kind }, false)
      if (seq !== navSeq) return 'cancelled'
      if (decision === 'stay') {
        if (o.source === 'pop' && o.popDelta) options.history.go(-o.popDelta)
        return 'cancelled'
      }
    }

    const txId = uniqueId('tx')
    if (withinApp) {
      const appId = currentApp!.manifest.id
      const state = { __platform: { txId, appId } satisfies PlatformState, [appId]: o.state }
      if (o.source !== 'pop') {
        if (o.replace) options.history.replace(url, state)
        else options.history.push(url, state)
      }
      current.set(url)
      currentApp!.bridgeListeners.forEach(l => l(url, { replace: !!o.replace, state: o.source === 'pop' ? (o.state as Record<string, unknown> | null)?.[appId]: o.state }))
      telemetry.emit('navigation', { kind: 'within-app', from: from.href, to: url.href, source: o.source })
      return 'committed'
    }

    // Cross-app: leave, commit, enter.
    const leaving = currentApp
    if (leaving) {
      const win = doc.defaultView
      const scroll = win ? { x: win.scrollX, y: win.scrollY }: undefined
      const prev = (options.history.state() as { __platform?: PlatformState } | null) ?? {}
      if (o.source !== 'pop') options.history.replace(from, {...prev, __platform: {...(prev.__platform ?? { txId: '' }), scroll } })
      currentApp = undefined
      void leaving.run.unmount()
    }
    if (o.source !== 'pop' && o.source !== 'initial') {
      const state = { __platform: { txId, appId: owner?.id } satisfies PlatformState }
      if (o.replace) options.history.replace(url, state)
      else options.history.push(url, state)
    } else if (o.source === 'initial') {
      options.history.replace(url, { __platform: { txId, appId: owner?.id } satisfies PlatformState })
    }
    current.set(url)
    telemetry.emit('navigation', { kind: 'cross-app', from: from.href, to: url.href, source: o.source })
    enter(url, owner)
    return 'committed'
  }

  function enter(url: URL, owner: AppManifest | undefined) {
    if (identityState.identity.get() === null) {
      view.set({ kind: 'signed-out', intended: url })
      return
    }
    if (!owner) {
      view.set({ kind: 'not-found', url })
      return
    }
    if (!requirementSatisfied(owner.permissions, identityState.groups.get())) {
      view.set({ kind: 'forbidden', mfeId: owner.id })
      return
    }
    const record = startApp(owner, url)
    currentApp = record
    publishView(record)
  }

  function signOut() {
    if (view.get().kind === 'signed-out') return
    const intended = current.get()
    for (const run of [...instances.values()]) void run.unmount()
    currentApp = undefined
    view.set({ kind: 'signed-out', intended })
  }

  // Re-enter when the session changes: fresh instances, even for the same user.
  identityState.identity.subscribe(snapshot => {
    if (snapshot === null) signOut()
    else if (view.get().kind === 'signed-out') void navigateUrl((view.get() as { intended: URL }).intended, { source: 'reenter' })
    else {
      // A user change: fresh instances for the new session.
      for (const run of [...instances.values()]) void run.unmount()
      currentApp = undefined
      void navigateUrl(current.get(), { source: 'reenter' })
    }
  }, { signal: hostSignal })

  // Group changes re-evaluate the current app's permissions.
  identityState.groups.subscribe(() => {
    const v = view.get()
    if (v.kind === 'forbidden' || v.kind === 'not-found') void navigateUrl(current.get(), { source: 'reenter' })
  }, { signal: hostSignal })

  const stopPop = options.history.onPop((url, state) => {
    const s = state as { __platform?: PlatformState } | null
    const prevHref = current.get().href
    // Approximate the delta as ±1; browsers do not tell us more.
    const delta = url.href === prevHref ? 0: 1
    void navigateUrl(url, { source: 'pop', state: s, popDelta: delta })
  })
  hostSignal.addEventListener('abort', stopPop, { once: true })

  // Raw links outside the current app's prefix are the platform's.
  const onClick = (event: Event) => {
    const e = event as MouseEvent
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
    const url = new URL(anchor.href, current.get())
    if (url.origin !== pageOrigin) return
    if (currentApp && findOwningApp(release.mfes, url.pathname)?.id === currentApp.manifest.id) return
    e.preventDefault()
    void navigateUrl(url, { source: 'navigate' })
  }
  doc.addEventListener('click', onClick)
  hostSignal.addEventListener('abort', () => doc.removeEventListener('click', onClick), { once: true })

  // ---- widgets ----

  async function mountWidget<Props>(
    o: WidgetMountOptions<Props>,
    consumer: { instanceId: string; mfeId: string; chain: string[]; signal: AbortSignal },
  ): Promise<WidgetHandle<Props>> {
    const manifest = release.mfes[o.id] as WidgetManifest | undefined
    const local = definitions.get(o.id) as WidgetDefinition<Props, Record<string, unknown>> | undefined
    if (!manifest && !local) throw new PlatformError('widgets/unavailable', `Widget "${o.id}" is not in the release`, { capability: 'widgets' })
    if (manifest && manifest.kind !== 'widget') throw new PlatformError('core/invalid-input', `"${o.id}" is not a widget`, { capability: 'widgets' })
    const declared = manifest?.contract.version ?? local?.contract.version
    if (declared !== o.contract) {
      throw new PlatformError('core/incompatible', `Widget "${o.id}" provides contract ${declared}; consumer asked for ${o.contract}`, { capability: 'widgets' })
    }
    if (consumer.chain.includes(o.id)) throw new PlatformError('widgets/cycle', `Widget "${o.id}" cannot be mounted inside itself`, { capability: 'widgets' })

    const instanceId = uniqueId('widget')
    const version = manifest?.version ?? '0.0.0'
    const scope = scopeToken(o.id, version)
    markScope(o.element, scope, instanceId)
    const overlayRoot = createOverlayRoot(scope, instanceId)
    const chain = [...consumer.chain, o.id]
    widgetChains.set(instanceId, chain)
    const outerSignal = anySignal([consumer.signal, o.signal])
    let props: Props = o.props
    let error: PlatformError | undefined
    let record!: InstanceRun<WidgetInstance<Props>>

    const run = runInstance<WidgetDefinition<Props, Record<string, unknown>>, WidgetInstance<Props>>({
      id: instanceId,
      mfeId: o.id,
      kind: 'widget',
      timeouts,
      telemetry,
      resolve: async () => {
        if (manifest) checkCompatible(manifest)
      },
      load: async signal => (local ?? ((await loadDefinition(manifest!, signal)) as WidgetDefinition<Props, Record<string, unknown>>)),
      mount: async (definition, signal) => {
        props = validate(definition.props, props, `widget ${o.id} props`)
        const ctx: WidgetMountContext<Props, Record<string, unknown>> = {
          kind: 'widget',
          element: o.element,
          signal,
          platform: platformFor(instanceId, o.id, signal, chain),
          instance: { id: instanceId, mfeId: o.id, version, scope },
          overlayRoot,
          reportError: reportErrorFor(() => record, o.id),
          locale,
          theme,
          props,
          emit: ({ event, payload }) => {
            if (record.status.get() === 'unmounted') return
            const schema = definition.events?.[event]
            try {
              const valid = schema ? validate(schema, payload, `widget ${o.id} event ${event}`): payload;(o.on?.[event] as ((p: unknown) => void) | undefined)?.(valid)
            } catch (e) {
              telemetry.emit('widget.event-dropped', { widgetId: o.id, event, error: String(e) })
            }
          },
          consumer: { mfeId: consumer.mfeId, instanceId: consumer.instanceId },
          contractVersion: o.contract,
          actions: actions.registryFor(instanceId, o.id, signal),
        }
        return definition.mount(ctx)
      },
      cleanup: () => {
        overlayRoot.remove()
        o.element.removeAttribute('data-mfe-scope')
        o.element.removeAttribute('data-mfe-instance')
        instances.delete(instanceId)
        instancesChanged.set(instancesChanged.get() + 1)
        widgetChains.delete(instanceId)
        for (const [id, b] of blockers) if (b.instanceId === instanceId) blockers.delete(id)
      },
      // Whatever the widget left behind goes once its own unmount settled (a React root removes its own nodes first).
      afterUnmount: () => o.element.replaceChildren(),
    })
    record = run
    trackInstance(run)
    outerSignal.addEventListener('abort', () => void run.unmount(), { once: true })
    run.settled.then(() => {
      if (run.status.get() === 'failed') {
        error = run.error
        if (typeof o.fallback === 'function' && error) o.fallback(error)
      }
    })

    return {
      instanceId,
      status: run.status,
      get error() {
        return error ?? run.error
      },
      update(next) {
        if (run.status.get() === 'unmounted' || run.status.get() === 'failed') return
        const inst = run.instance
        try {
          props = inst ? validate((definitions.get(o.id) as WidgetDefinition<Props> | undefined)?.props ?? { '~standard': { version: 1, vendor: 'platform', validate: (v: unknown) => ({ value: v as Props }) } }, next, `widget ${o.id} props`): next
          inst?.update?.(props)
        } catch (e) {
          error = toPlatformError(e)
          telemetry.emit('widget.update-failed', { widgetId: o.id, error: error.message })
          void run.unmount()
        }
      },
      unmount: () => void run.unmount(),
    }
  }

  // ---- public runtime ----

  return {
    release,
    telemetry,
    signal: hostSignal,
    identity: identityState.identity as Observer<IdentitySnapshot | null>,
    groups: identityState.groups,
    theme,
    locale,
    current,
    view,
    actions,
    /** Where apps and overlay roots render; call before `start()`. */
    attach(elements: { content: HTMLElement; overlays: HTMLElement }) {
      content = elements.content
      overlays = elements.overlays
    },
    start() {
      return navigateUrl(options.history.location(), { source: 'initial' })
    },
    navigate,
    navigateUrl: (url: URL, o?: { replace?: boolean }) => navigateUrl(url, { replace: o?.replace, source: 'navigate' }),
    back: () => options.history.go(-1),
    forward: () => options.history.go(1),
    login: () => options.identity.login(),
    logout: async () => {
      const decision = await askBlockers({ current: current.get(), next: current.get(), kind: 'unload' }, false)
      if (decision === 'stay') return 'cancelled' as const
      await options.identity.logout()
      return 'committed' as const
    },
    page: {
      get: (): PageMeta => currentApp?.page.get() ?? { title: options.product ?? '' },
      onChange(listener: (meta: PageMeta) => void) {
        pageMetaListeners.add(listener)
        return () => pageMetaListeners.delete(listener)
      },
    },
    currentApp: () => currentApp,
    instances: () => [...instances.values()],
    instancesChanged: instancesChanged as Observer<number>,
    blockersActive: () => [...blockers.values()].some(b => b.status.get() === 'blocked'),
    mountWidget,
    /** Mounts an app definition directly into `element`; the test host and dev playground use it. */
    async dispose() {
      hostController.abort()
      await Promise.all([...instances.values()].map(r => r.unmount()))
      identityState.dispose()
      view.dispose()
      current.dispose()
    },
  }
}

export type HostRuntime = ReturnType<typeof createHostRuntime>
