import { useCallback, useEffect, useRef, useState } from 'react'
import { useObserver } from '@platform/sdk/react'
import { Bug, X } from 'lucide-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { HEIGHT_KEY, OPEN_KEY, TAB_KEY, readLocal, writeLocal, type DevtoolsProps } from './state'
import { MfesTab } from './tabs/mfes'
import { SharedTab } from './tabs/shared'
import { InstancesTab } from './tabs/instances'
import { ReleaseTab } from './tabs/release'
import { NavigationTab } from './tabs/navigation'
import { ActionsTab } from './tabs/actions'
import { TelemetryTab } from './tabs/telemetry'
import { Mono } from './ui'

export type { DevtoolsProps } from './state'
export { readImportMap, versionFromUrl } from './state'

const TABS = [
  { id: 'mfes', label: 'MFEs', Component: MfesTab },
  { id: 'shared', label: 'Shared', Component: SharedTab },
  { id: 'instances', label: 'Instances', Component: InstancesTab },
  { id: 'actions', label: 'Actions', Component: ActionsTab },
  { id: 'navigation', label: 'Navigation', Component: NavigationTab },
  { id: 'release', label: 'Release', Component: ReleaseTab },
  { id: 'telemetry', label: 'Telemetry', Component: TelemetryTab },
] as const

const MIN_HEIGHT = 160

/**
 * The DevTools panel: a toggle in the bottom-right corner and a docked, resizable panel.
 * Enabled per browser with localStorage `platform.devtools = "true"`; the shell loads this module only then.
 */
export function PlatformDevtools(props: DevtoolsProps) {
  const [open, setOpen] = useState(() => readLocal(OPEN_KEY) === 'true')
  const [height, setHeight] = useState(() => Number(readLocal(HEIGHT_KEY)) || 360)
  const [tab, setTab] = useState(() => readLocal(TAB_KEY) ?? 'mfes')
  const view = useObserver(props.runtime.view)
  const dragging = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => writeLocal(OPEN_KEY, String(open)), [open])
  useEffect(() => writeLocal(HEIGHT_KEY, String(height)), [height])
  useEffect(() => writeLocal(TAB_KEY, tab), [tab])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = { startY: e.clientY, startHeight: height }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height],
  )
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const next = dragging.current.startHeight + (dragging.current.startY - e.clientY)
    setHeight(Math.min(window.innerHeight - 80, Math.max(MIN_HEIGHT, next)))
  }, [])
  const onPointerUp = useCallback(() => (dragging.current = null), [])

  const overrideCount = Object.keys(props.overrides?.applied ?? {}).length
  const errorCount = Object.keys(props.overrides?.errors ?? {}).length

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label={open ? 'Close platform DevTools' : 'Open platform DevTools'}
        aria-expanded={open}
        onPress={() => setOpen(o => !o)}
        className="bg-background fixed right-4 z-[70] shadow-md transition-[bottom]"
        style={{ bottom: open ? height + 16 : 16 }}
        data-testid="devtools.toggle"
      >
        <Bug />
        {overrideCount + errorCount > 0 ? <span className={`absolute -top-1 -right-1 size-2.5 rounded-full ${errorCount ? 'bg-destructive' : 'bg-info'}`} aria-hidden="true" /> : null}
      </Button>
      {open ? (
        <aside
          className="bg-background text-foreground border-border fixed inset-x-0 bottom-0 z-[65] flex flex-col border-t shadow-2xl"
          style={{ height }}
          aria-label="Platform DevTools"
          data-testid="devtools.panel"
          data-not-typeset
        >
          <div className="hover:bg-primary/40 h-1.5 shrink-0 cursor-row-resize touch-none" role="separator" aria-orientation="horizontal" aria-label="Resize" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <Tabs selectedKey={tab} onSelectionChange={key => setTab(String(key))} className="flex min-h-0 flex-1 flex-col gap-0">
            <header className="border-border flex items-center gap-3 border-b px-3 py-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Bug className="size-4" /> Platform DevTools
              </span>
              <Mono className="text-muted-foreground">release {props.runtime.release.id}</Mono>
              <Badge variant={view.kind === 'app' ? (view.status === 'failed' ? 'destructive' : 'success') : 'warning'} appearance="outline">
                {view.kind === 'app' ? `${view.mfeId} · ${view.status}` : view.kind}
              </Badge>
              {overrideCount ? <Badge variant="info">{overrideCount} override{overrideCount === 1 ? '' : 's'}</Badge> : null}
              {errorCount ? <Badge variant="destructive">{errorCount} override error{errorCount === 1 ? '' : 's'}</Badge> : null}
              <TabsList variant="line" className="ml-auto" aria-label="DevTools sections">
                {TABS.map(t => (
                  <TabsTrigger key={t.id} id={t.id} data-testid={`devtools.tab.${t.id}`}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onPress={() => setOpen(false)}>
                <X />
              </Button>
            </header>
            {TABS.map(t => (
              <TabsContent key={t.id} id={t.id} className="min-h-0 flex-1 overflow-auto p-3">
                <t.Component {...props} />
              </TabsContent>
            ))}
          </Tabs>
        </aside>
      ) : null}
    </>
  )
}
