import { StrictMode, useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider'
import type { AppMountContext, AppInstance, RouterBridge, WidgetInstance, WidgetMountContext } from '../context'
import type { AppDefinition, WidgetDefinition } from '../definitions'
import type { Schema, InferOutput } from '../schema'
import { createObserverStore } from '../observer'
import { MountContextContext } from './context'
import { ErrorBoundary } from './components'

export { usePlatform, useMountContext } from './context'
export { useObserver, useIdentity, usePermission, useTheme, useLocale, useNavigate, usePage, useWidget, useAction } from './hooks'
export type { UseActionOptions, UseActionResult } from './hooks'
export { MfeWidget, PlatformLink, ErrorBoundary } from './components'
export type { MfeWidgetProps, PlatformLinkProps } from './components'
export { createPlatformHistory } from './history'

interface RootOptions {
  ctx: AppMountContext | WidgetMountContext<unknown, Record<string, unknown>>
  children: ReactNode
  strict?: boolean
}

/** One React root per instance, portals to `ctx.overlayRoot`, errors to `ctx.reportError` (§28, §15). */
function mountRoot({ ctx, children, strict = false }: RootOptions): { ready: Promise<void>; unmount(): void } {
  const root = createRoot(ctx.element)
  let markReady!: () => void
  const ready = new Promise<void>(r => (markReady = r))
  const tree = (
    <MountContextContext.Provider value={ctx}>
      <UNSAFE_PortalProvider getContainer={() => ctx.overlayRoot}>
        <ErrorBoundary onError={ctx.reportError}>
          <Ready onReady={markReady}>{children}</Ready>
        </ErrorBoundary>
      </UNSAFE_PortalProvider>
    </MountContextContext.Provider>
  )
  root.render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return {
    ready,
    unmount: () => root.unmount(),
  }
}

function Ready({ onReady, children }: { onReady: () => void; children: ReactNode }) {
  useEffect(() => onReady(), [onReady])
  return children
}

// ---- apps (Appendix C.1) ----

type AppCommon = Omit<AppDefinition, 'mount'>

export interface TanStackAppOptions extends AppCommon {
  /** A TanStack Router route tree; the adapter builds the router with the platform history and base path. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeTree: any
  /** Extra router options (context, defaultPreload, …). `history` and `basepath` are the platform's. */
  routerOptions?: Record<string, unknown>
}

export interface ComponentAppOptions extends AppCommon {
  /** Escape hatch: you build the router; the component receives the bridge and base path. */
  component: ComponentType<{ bridge: RouterBridge; basePath: string }>
}

export function createApp(options: TanStackAppOptions | ComponentAppOptions): AppDefinition {
  const { ...definition } = options
  return {
    ...definition,
    async mount(ctx): Promise<AppInstance> {
      let children: ReactNode
      if ('routeTree' in options) {
        const { createRouter, RouterProvider } = await import('@tanstack/react-router')
        const { createPlatformHistory } = await import('./history')
        const history = createPlatformHistory(ctx.router, ctx.signal)
        const router = createRouter({
          ...(options.routerOptions ?? {}),
          routeTree: options.routeTree,
          history,
          basepath: ctx.basePath,
          scrollRestoration: false,
        })
        // Declared redirects apply within the prefix through the bridge (§25).
        applyRedirects(ctx, options.redirects)
        children = <RouterProvider router={router} />
      } else {
        const C = options.component
        children = <C bridge={ctx.router} basePath={ctx.basePath} />
      }
      const root = mountRoot({ ctx, children })
      return { ready: root.ready, unmount: root.unmount }
    },
  }
}

function applyRedirects(ctx: AppMountContext, redirects: Record<string, string> | undefined) {
  if (!redirects) return
  const rules = Object.entries(redirects).map(([from, to]) => ({
    pattern: new RegExp(`^${ctx.basePath.replace(/\/+$/, '')}${from.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '(?<$1>[^/]+)')}/?$`),
    to,
  }))
  const check = (url: URL) => {
    for (const rule of rules) {
      const m = rule.pattern.exec(url.pathname)
      if (!m) continue
      const target = rule.to.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_s, name: string) => m.groups?.[name] ?? '')
      const next = new URL(`${ctx.basePath.replace(/\/+$/, '')}${target}${url.search}${url.hash}`, url)
      void ctx.router.navigate(next, { replace: true })
      return
    }
  }
  check(ctx.initialUrl)
  const stop = ctx.router.onNavigate(url => check(url))
  ctx.signal.addEventListener('abort', stop, { once: true })
}

// ---- widgets (Appendix C.1) ----

export interface ReactWidgetOptions<S extends Schema, E extends Record<string, Schema>> extends Omit<WidgetDefinition, 'mount' | 'props' | 'events'> {
  props: S
  events?: E
  component: ComponentType<InferOutput<S>>
}

export function createWidget<S extends Schema, E extends Record<string, Schema> = Record<string, never>>(
  options: ReactWidgetOptions<S, E>,
): WidgetDefinition<InferOutput<S>, { [K in keyof E]: InferOutput<E[K]> }> {
  const { component: C, ...definition } = options
  type Props = InferOutput<S>
  return {
    ...definition,
    mount(ctx): WidgetInstance<Props> {
      const props = createObserverStore<Props>(ctx.props)
      const Widget = () => {
        const current = useSyncExternalStore(
          onChange => props.subscribe(onChange),
          () => props.get(),
          () => props.get(),
        )
        return <C {...(current as Props & object)} />
      }
      const root = mountRoot({ ctx: ctx as unknown as WidgetMountContext<unknown, Record<string, unknown>>, children: <Widget /> })
      return {
        ready: root.ready,
        update: next => props.set(next),
        unmount: () => {
          root.unmount()
          props.dispose()
        },
      }
    },
  } as WidgetDefinition<Props, { [K in keyof E]: InferOutput<E[K]> }>
}
