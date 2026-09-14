import { createContext, useContext } from 'react'
import type { AppMountContext, MountContext, PlatformClient, WidgetMountContext } from '../context'

export const MountContextContext = createContext<MountContext | null>(null)

export function useMountContext(): MountContext {
  const ctx = useContext(MountContextContext)
  if (!ctx) throw new Error('useMountContext: no platform mount context; render inside an app or widget mounted by the platform')
  return ctx
}

export function usePlatform(): PlatformClient {
  return useMountContext().platform
}

export function useAppContext(): AppMountContext {
  const ctx = useMountContext()
  if (ctx.kind !== 'app') throw new Error('This hook is only available inside an app')
  return ctx
}

export function useWidgetContext<Props = unknown, Events extends Record<string, unknown> = Record<string, unknown>>(): WidgetMountContext<Props, Events> {
  const ctx = useMountContext()
  if (ctx.kind !== 'widget') throw new Error('useWidget is only available inside a widget')
  return ctx as unknown as WidgetMountContext<Props, Events>
}
