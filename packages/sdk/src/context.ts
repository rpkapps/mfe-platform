import type { Observer } from './observer'
import type { PlatformError } from './errors'
import type { LiveAction, ConfirmationContent } from './definitions'
import type { HttpClient } from './http'
import type { Register } from './register'

// ---- snapshots (§32, §41) ----

export interface UserSnapshot {
  id: string
  displayName: string
  email: string
}
export interface IdentitySnapshot {
  user: UserSnapshot
  expiresAt?: string
}
export interface ThemeSnapshot {
  scheme: 'light' | 'dark'
}
export interface LocaleSnapshot {
  locale: string
  direction: 'ltr' | 'rtl'
}

// ---- navigation (§23–§26) ----

export type NavigationOutcome = 'committed' | 'cancelled'

export interface NavigateOptions {
  to: string
  params?: Record<string, string | number>
  search?: Record<string, unknown>
  replace?: boolean
  state?: unknown
}

export interface BlockedTransaction {
  current: URL
  next: URL
  kind: 'within-app' | 'cross-app' | 'unload'
}

export interface NavigationBlocker {
  shouldBlock(tx: BlockedTransaction): boolean | Promise<boolean>
  prompt?(tx: BlockedTransaction): Promise<'proceed' | 'stay'>
}

export interface BlockerHandle {
  status: Observer<'idle' | 'blocked'>
  proceed(): void
  reset(): void
  release(): void
}

export interface NavigationClient {
  navigate(options: NavigateOptions): Promise<NavigationOutcome>
  href(options: Pick<NavigateOptions, 'to' | 'params' | 'search'>): string
  block(options: NavigationBlocker & { signal?: AbortSignal }): BlockerHandle
  current: Observer<URL>
}

/** §24: what a router adapter talks to. App code normally does not touch it. */
export interface RouterBridge {
  current(): URL
  onNavigate(listener: (url: URL, info: { replace: boolean; state: unknown }) => void): () => void
  navigate(url: URL, options?: { replace?: boolean; state?: unknown }): Promise<NavigationOutcome>
  registerBlocker(blocker: NavigationBlocker): () => void
  restoreScroll(): { x: number; y: number } | undefined
  /** History traversal; the platform handles the resulting popstate (§23.3). */
  go(delta: number): void
}

// ---- page (§27.2) ----

export interface PageMeta {
  title: string
  focusTarget?: string
}
export interface PageController {
  set(meta: Partial<PageMeta>): void
  get(): PageMeta
}

// ---- identity / permissions ----

export interface IdentityClient extends Observer<IdentitySnapshot | null> {
  login(): Promise<void>
  logout(): Promise<void>
}

export interface PermissionsClient {
  can(id: string): boolean
  observe(id: string): Observer<boolean>
  subscribe(listener: (groups: readonly string[]) => void, options?: { signal?: AbortSignal }): () => void
}

// ---- widgets (§29) ----

export type InstanceStatus = 'loading' | 'ready' | 'failed' | 'unmounted'

export interface WidgetMountOptions<Props = unknown> {
  id: string
  contract: number
  element: HTMLElement
  props: Props
  on?: Record<string, (payload: never) => void>
  signal?: AbortSignal
  fallback?: 'skeleton' | 'hidden' | ((error: PlatformError) => void)
}

export interface WidgetHandle<Props = unknown> {
  /** The widget instance id, as shown in DevTools and telemetry. */
  readonly instanceId: string
  status: Observer<InstanceStatus>
  readonly error: PlatformError | undefined
  update(props: Props): void
  unmount(): void
}

export interface WidgetsClient {
  mount<Props = unknown>(options: WidgetMountOptions<Props>): Promise<WidgetHandle<Props>>
}

// ---- actions (§44) ----

export type ActionState = 'enabled' | 'pending' | { status: 'disabled'; reason?: string } | 'absent' | 'target-required'

export type ActionRunResult =
  | { status: 'completed' }
  | { status: 'cancelled' | 'disabled' | 'pending' | 'unavailable' | 'target-required' }
  | { status: 'failed'; error: PlatformError }

export type ActionInitiator = 'user' | 'shortcut' | 'system'

export interface ActionRunContext {
  initiator: ActionInitiator
  confirmationId?: string
  signal: AbortSignal
  progress(fraction: number): void
}

export interface ActionRegistrationOptions {
  action: LiveAction
  target?: { key: string; label: string }
  confirmation?: ConfirmationContent
  enabled?: boolean
  disabledReason?: string
  run(ctx: ActionRunContext): unknown | Promise<unknown>
  onError?(error: PlatformError): void
  signal?: AbortSignal
}

export interface ActionRegistrationStatus {
  enabled: boolean
  pending: boolean
  error: PlatformError | undefined
}

export interface ActionRegistrationHandle {
  readonly registrationId: string
  status: Observer<ActionRegistrationStatus>
  run(): Promise<ActionRunResult>
  update(options: Partial<Omit<ActionRegistrationOptions, 'action' | 'signal' | 'target'>>): void
  release(): void
}

export interface ActionRegistry {
  register(options: ActionRegistrationOptions): ActionRegistrationHandle
}

export interface ActionsClient {
  run(options: { id: string; registrationId?: string }): Promise<ActionRunResult>
}

// ---- the platform client (§11, one property per capability) ----

export interface PlatformClient {
  identity: IdentityClient
  permissions: PermissionsClient
  navigation: NavigationClient
  http: HttpClient
  widgets: WidgetsClient
  actions: ActionsClient
}

// ---- mount contexts (§11) ----

export interface InstanceInfo {
  id: string
  mfeId: string
  version: string
  scope: string
}

export interface MountContextBase {
  element: HTMLElement
  signal: AbortSignal
  platform: PlatformClient
  instance: InstanceInfo
  overlayRoot: HTMLElement
  reportError(error: unknown, info?: { fatal?: boolean }): void
  locale: Observer<LocaleSnapshot>
  theme: Observer<ThemeSnapshot>
}

export interface AppMountContext extends MountContextBase {
  kind: 'app'
  basePath: string
  initialUrl: URL
  router: RouterBridge
  page: PageController
  actions: ActionRegistry
}

export interface WidgetMountContext<Props = unknown, Events extends Record<string, unknown> = Record<string, never>> extends MountContextBase {
  kind: 'widget'
  props: Props
  emit<K extends keyof Events & string>(options: { event: K; payload: Events[K] }): void
  consumer: { mfeId: string; instanceId: string }
  contractVersion: number
  actions: ActionRegistry
}

export type MountContext = AppMountContext | WidgetMountContext

// ---- instances (§12) ----

export interface AppInstance {
  ready?: Promise<void>
  unmount(): void | Promise<void>
}

export interface WidgetInstance<Props = unknown> {
  ready?: Promise<void>
  update?(props: Props): void
  unmount(): void | Promise<void>
}

// Keeps the Register import referenced so augmentation-only modules type-check under isolatedModules.
export type RegisteredPaths = Register extends { paths: infer P } ? P : Record<string, { params?: Record<string, string>; search?: Record<string, unknown> }>
