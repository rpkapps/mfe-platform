import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Observer } from '../observer'
import type {
  ActionRegistrationHandle,
  ActionRunResult,
  ActionRunContext,
  IdentitySnapshot,
  LocaleSnapshot,
  NavigateOptions,
  NavigationOutcome,
  PageMeta,
  ThemeSnapshot,
} from '../context'
import type { LiveAction, ConfirmationContent } from '../definitions'
import type { PlatformError } from '../errors'
import { useAppContext, useMountContext, usePlatform, useWidgetContext } from './context'

/** §9.3 Framework adapters: read, subscribe, reconcile; selectors suppress unchanged values with `Object.is`. */
export function useObserver<T>(observer: Observer<T>): T
export function useObserver<T, U>(observer: Observer<T>, selector: (value: T) => U): U
export function useObserver<T, U>(observer: Observer<T>, selector?: (value: T) => U): T | U {
  const select = selector ?? ((v: T) => v as unknown as U)
  const selectRef = useRef(select)
  selectRef.current = select
  const subscribe = useCallback((onChange: () => void) => observer.subscribe(onChange), [observer])
  const get = useCallback(() => selectRef.current(observer.get()), [observer])
  // useSyncExternalStore compares snapshots with Object.is, so a selector returning the same value skips the render.
  return useSyncExternalStore(subscribe, get, get)
}

export function useIdentity(): IdentitySnapshot | null {
  return useObserver(usePlatform().identity)
}

export function usePermission(id: string): boolean {
  const platform = usePlatform()
  const observer = useMemo(() => platform.permissions.observe(id), [platform, id])
  return useObserver(observer)
}

export function useTheme(): ThemeSnapshot {
  return useObserver(useMountContext().theme)
}

export function useLocale(): LocaleSnapshot {
  return useObserver(useMountContext().locale)
}

export function useNavigate(): (options: NavigateOptions) => Promise<NavigationOutcome> {
  const platform = usePlatform()
  return useCallback((options: NavigateOptions) => platform.navigation.navigate(options), [platform])
}

/** Sets page metadata for the lifetime of the component (§27.2). */
export function usePage(meta: Partial<PageMeta>): void {
  const ctx = useAppContext()
  const title = meta.title
  const focusTarget = meta.focusTarget
  useEffect(() => {
    const previous = ctx.page.get()
    ctx.page.set({ ...(title !== undefined ? { title } : {}), ...(focusTarget !== undefined ? { focusTarget } : {}) })
    return () => ctx.page.set(previous)
  }, [ctx, title, focusTarget])
}

export function useWidget<Events extends Record<string, unknown> = Record<string, unknown>>() {
  const ctx = useWidgetContext<unknown, Events>()
  return useMemo(() => ({ emit: ctx.emit, contractVersion: ctx.contractVersion, consumer: ctx.consumer }), [ctx])
}

export interface UseActionOptions {
  target?: { key: string; label: string }
  confirmation?: ConfirmationContent
  enabled?: boolean
  disabledReason?: string
  run(ctx: ActionRunContext): unknown | Promise<unknown>
  onError?(error: PlatformError): void
}

export interface UseActionResult {
  registrationId: string | undefined
  enabled: boolean
  pending: boolean
  error: PlatformError | undefined
  run(): Promise<ActionRunResult>
}

/** §44.2: a registration per component; a target-key change is a new registration. */
export function useAction(action: LiveAction, options: UseActionOptions): UseActionResult {
  const ctx = useMountContext()
  const latest = useRef(options)
  latest.current = options
  const targetKey = options.target?.key
  const targetLabel = options.target?.label
  const [handle, setHandle] = useState<ActionRegistrationHandle | undefined>(undefined)

  useEffect(() => {
    const h = ctx.actions.register({
      action,
      target: targetKey !== undefined ? { key: targetKey, label: targetLabel ?? targetKey } : undefined,
      confirmation: latest.current.confirmation,
      enabled: latest.current.enabled,
      disabledReason: latest.current.disabledReason,
      run: c => latest.current.run(c),
      onError: latest.current.onError ? e => latest.current.onError?.(e) : undefined,
    })
    setHandle(h)
    return () => {
      h.release()
      setHandle(undefined)
    }
  }, [ctx, action, targetKey, targetLabel])

  // Live metadata updates preserve the registration (§44.2).
  useEffect(() => {
    handle?.update({ enabled: options.enabled, disabledReason: options.disabledReason, confirmation: options.confirmation })
  }, [handle, options.enabled, options.disabledReason, options.confirmation])

  const status = useSyncExternalStore(
    useCallback((onChange: () => void) => (handle ? handle.status.subscribe(onChange) : () => {}), [handle]),
    () => (handle ? handle.status.get() : IDLE),
    () => IDLE,
  )
  const run = useCallback(() => (handle ? handle.run() : Promise.resolve<ActionRunResult>({ status: 'unavailable' })), [handle])
  return { registrationId: handle?.registrationId, enabled: status.enabled, pending: status.pending, error: status.error, run }
}

const IDLE = Object.freeze({ enabled: false, pending: false, error: undefined })
