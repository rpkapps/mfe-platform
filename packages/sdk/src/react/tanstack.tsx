import { createRouter, RouterProvider } from '@tanstack/react-router'
import type { AppDefinition } from '../definitions'
// The package specifier, not a relative path: this module is bundled into the app, and the mount root and
// Context must be the shared copy the app's hooks use.
import { applyRedirects, mountAppRoot, type AppCommon } from '@platform/sdk/react'
import { createPlatformHistory } from './history'

export { createPlatformHistory } from './history'

export interface TanStackAppOptions extends AppCommon {
  /** Your TanStack Router route tree; the adapter builds the router with the platform history and base path. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeTree: any
  /** Extra router options (context, defaultPreload, …). `history` and `basepath` are the platform's. */
  routerOptions?: Record<string, unknown>
}

/**
 * `createApp({ basePath, routeTree })` for TanStack Router. This module is bundled into the app (not shared)
 * because the router it builds must be the app's own copy of `@tanstack/react-router`, the one its `Link`s use.
 */
export function createApp(options: TanStackAppOptions): AppDefinition {
  const { routeTree, routerOptions,...definition } = options
  return {...definition,
    mount(ctx) {
      const history = createPlatformHistory(ctx.router, ctx.signal)
      const router = createRouter({...(routerOptions ?? {}), routeTree, history, basepath: ctx.basePath, scrollRestoration: false })
      applyRedirects(ctx, definition.redirects)
      return mountAppRoot(ctx, <RouterProvider router={router} />)
    },
  }
}
