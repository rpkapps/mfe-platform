import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppManifest, ManifestAction, PlatformError, Release } from '@platform/sdk'
import { requirementSatisfied } from '@platform/sdk'
import { useObserver } from '@platform/sdk/react'
import type { ConfirmationRequest, RegistrationRecord } from '@platform/sdk/host'
import { toast } from 'sonner'
import { Toaster } from '@tecton/react/components/sonner'
import { Button } from '@tecton/react/components/button'
import { AppShell, AppShellBrand, AppShellHeader, AppShellHeaderActions, AppShellNav } from '@tecton/react/tecton/app-shell'
import { AppFinder, AppFinderGroup, AppFinderInput, AppFinderItem, AppFinderList, AppFinderMenu, AppFinderTrigger } from '@tecton/react/tecton/app-finder'
import { ShellAction, ShellActions, ShellCommandTrigger, ShellDivider, ShellUserMenu } from '@tecton/react/tecton/shell-actions'
import { ShortcutsProvider } from '@tecton/react/tecton/shortcuts'
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@tecton/react/components/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@tecton/react/components/alert-dialog'
import { CircleHelp, Moon, Sun } from 'lucide-react'
import type { ShellBoot } from '../main'
import { shellConfig } from '../config'
import { Icon } from './icon'
import { FailedPage, ForbiddenPage, NotFoundPage, SignInPage } from './pages'
import { Palette } from './Palette'
import { ShellShortcuts } from './Shortcuts'
import { codeOf, initialsOf, toneOf } from './shortcuts'

// A separate chunk, fetched only when the panel is enabled for this browser.
const PlatformDevtools = lazy(() => import('@platform/devtools').then(m => ({ default: m.PlatformDevtools })))

export function Shell({ boot }: { boot: ShellBoot }) {
  const { runtime, release, identity, theme } = boot
  const content = useRef<HTMLDivElement>(null)
  const overlays = useRef<HTMLDivElement>(null)
  const view = useObserver(runtime.view)
  const current = useObserver(runtime.current)
  const user = useObserver(runtime.identity)
  const groups = useObserver(runtime.groups)
  const scheme = useObserver(theme, t => t.scheme)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [palette, setPalette] = useState<{ open: boolean; query?: string }>({ open: false })
  const [title, setTitle] = useState(runtime.page.get().title)

  // Attach the content area and overlay layer, then start at the current URL.
  useEffect(() => {
    runtime.attach({ content: content.current!, overlays: overlays.current! })
    void runtime.start()
  }, [runtime])

  useEffect(() => {
    const stop = runtime.page.onChange(meta => setTitle(meta.title))
    return () => void stop()
  }, [runtime])
  useEffect(() => {
    if (view.kind === 'app' && view.status === 'ready') setTitle(runtime.page.get().title)
    else if (view.kind !== 'app') setTitle('')
  }, [view, runtime])
  useEffect(() => {
    document.title = title ? `${title} · ${shellConfig.product}` : shellConfig.product
  }, [title])

  // Focus the page heading after a cross-app navigation.
  useEffect(() => {
    if (view.kind !== 'app' || view.status !== 'ready') return
    const target = runtime.page.get().focusTarget
    const el = (target ? content.current?.querySelector<HTMLElement>(`[data-testid="${CSS.escape(target)}"]`) : null) ?? content.current?.querySelector<HTMLElement>('h1')
    if (el) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: false })
    }
  }, [view, runtime])

  // Callback failures without an app handler reach the shell's toast region.
  useEffect(() => {
    const handler = (e: Event) => {
      const { error, info } = (e as CustomEvent<{ error: PlatformError; info: { actionId: string } }>).detail
      toast.error(error.message, { description: info.actionId })
    }
    window.addEventListener('platform:action-error', handler)
    return () => window.removeEventListener('platform:action-error', handler)
  }, [])

  const apps = useMemo(() => visibleApps(release, groups), [release, groups])
  const currentApp = view.kind === 'app' ? (release.mfes[view.mfeId] as AppManifest | undefined) : undefined
  const forbiddenApp = view.kind === 'forbidden' ? (release.mfes[view.mfeId] as AppManifest | undefined) : undefined
  const loading = view.kind === 'app' && view.status === 'loading'
  const openSwitcher = useCallback(() => setSwitcherOpen(true), [])
  const openPalette = useCallback((query?: string) => setPalette({ open: true, query }), [])

  return (
    <ShortcutsProvider>
      <AppShell className="flex h-full flex-col">
        {loading ? <div className="mfe-progress" role="progressbar" aria-label="Loading" /> : null}
        <AppShellHeader>
          <AppShellBrand>
            <span className="text-sm font-semibold" data-testid="shell.product">
              {shellConfig.product}
            </span>
            <AppFinder isOpen={switcherOpen} onOpenChange={setSwitcherOpen}>
              <AppFinderTrigger tone={currentApp ? toneOf(currentApp.id) : 'neutral'} name={currentApp?.title ?? 'Apps'} data-testid="shell.switcher">
                {currentApp ? codeOf(currentApp.id) : '…'}
              </AppFinderTrigger>
              <AppFinderMenu>
                <AppFinderInput placeholder="Find an app…" />
                <AppFinderList onAction={key => void runtime.navigate({ to: (release.mfes[String(key)] as AppManifest).basePath })} emptyHint="No app matches">
                  <AppFinderGroup heading="Apps">
                    {apps.map(app => (
                      <AppFinderItem key={app.id} id={app.id} icon={codeOf(app.id)} tone={toneOf(app.id)} name={app.title} description={app.description} keywords={[app.id, app.basePath]} isCurrent={app.id === currentApp?.id} data-testid={`shell.switcher.${app.id}`} />
                    ))}
                  </AppFinderGroup>
                </AppFinderList>
              </AppFinderMenu>
            </AppFinder>
          </AppShellBrand>
          <AppShellNav>
            <h2 className="truncate text-sm font-medium" data-testid="shell.page-title">
              {title}
            </h2>
            <PageActions runtime={runtime} currentApp={currentApp} groups={groups} />
          </AppShellNav>
          <AppShellHeaderActions>
            <ShellActions>
              <ShellCommandTrigger onPress={() => openPalette()} data-testid="shell.palette.trigger">
                Search
              </ShellCommandTrigger>
              <HelpMenu runtime={runtime} currentApp={currentApp} />
              <ShellAction label={scheme === 'dark' ? 'Light theme' : 'Dark theme'} onPress={() => setTheme(theme, scheme === 'dark' ? 'light' : 'dark')} data-testid="shell.theme">
                {scheme === 'dark' ? <Sun /> : <Moon />}
              </ShellAction>
              <ShellDivider />
              <ShellUserMenu user={{ name: user?.user.displayName ?? 'Signed out', initials: user ? initialsOf(user.user.displayName) : '?' }} data-testid="shell.user">
                {user ? <DropdownMenuLabel>{user.user.email}</DropdownMenuLabel> : null}
                {user ? <DropdownMenuItem onAction={() => void runtime.logout()}>Sign out</DropdownMenuItem> : <DropdownMenuItem onAction={() => void runtime.login()}>Sign in</DropdownMenuItem>}
              </ShellUserMenu>
            </ShellActions>
          </AppShellHeaderActions>
        </AppShellHeader>

        <UpdateBanner registryUrl={boot.env.PLATFORM_REGISTRY_URL} releaseId={release.id} runtime={runtime} />

        <div id="shell-content" className="relative" data-testid="shell.content">
          {view.kind === 'not-found' ? <NotFoundPage url={view.url} onSwitcher={openSwitcher} /> : null}
          {view.kind === 'forbidden' ? <ForbiddenPage appTitle={forbiddenApp?.title ?? view.mfeId} onSwitcher={openSwitcher} /> : null}
          {view.kind === 'signed-out' ? <SignInPage identity={identity} intended={view.intended} /> : null}
          {view.kind === 'app' && view.status === 'failed' ? <FailedPage appTitle={currentApp?.title ?? view.mfeId} error={view.error} onRetry={() => void runtime.navigateUrl(current, { replace: true })} /> : null}
          <div ref={content} className="contents" />
        </div>
        <div ref={overlays} className="mfe-overlay-layer" />
        <Confirmation bridge={boot.confirmations} />
        <Palette boot={boot} open={palette.open} query={palette.query} onOpenChange={open => setPalette(p => ({ ...p, open }))} apps={apps} currentApp={currentApp} />
        <ShellShortcuts boot={boot} openPalette={openPalette} />
        <Toaster position="bottom-right" />
        {boot.devtools ? (
          <Suspense fallback={null}>
            <PlatformDevtools runtime={runtime} env={boot.env} overrides={boot.devtools.overrides} sharedSets={boot.sharedSets} />
          </Suspense>
        ) : null}
      </AppShell>
    </ShortcutsProvider>
  )
}

/** Every app whose requirement passes, alphabetical by title. */
function visibleApps(release: Release, groups: readonly string[]): AppManifest[] {
  return Object.values(release.mfes)
    .filter((m): m is AppManifest => m.kind === 'app')
    .filter(m => requirementSatisfied(m.permissions, groups))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Page-header actions: live registrations placed in 'page' plus the mounted app's static navigation actions. */
function PageActions({ runtime, currentApp, groups }: { runtime: ShellBoot['runtime']; currentApp: AppManifest | undefined; groups: readonly string[] }) {
  useObserver(runtime.actions.changes)
  const statics = new Map<string, ManifestAction>()
  for (const a of currentApp?.contributions.actions ?? []) statics.set(a.id, a)
  const live = runtime.actions.registered().filter(r => (statics.get(r.actionId)?.placement ?? ['palette']).includes('page'))
  const navigation = [...statics.values()].filter(a => a.to && (a.placement ?? []).includes('page') && requirementSatisfied(a.permissions, groups))
  const items: Array<{ key: string; label: string; icon?: string; run: () => void; disabled: boolean; pending: boolean }> = [
    ...live.map(r => registrationItem(r, statics.get(r.actionId), groups, runtime)),
    ...navigation.map(a => ({ key: a.id, label: a.title, icon: a.icon, run: () => void runtime.actions.run({ id: a.id, initiator: 'user' }), disabled: false, pending: false })),
  ]
  if (items.length === 0) return null
  return (
    <div className="ml-auto flex items-center gap-1" data-testid="shell.page-actions">
      {items.map(item => (
        <Button key={item.key} variant="outline" size="sm" onPress={item.run} isDisabled={item.disabled} isPending={item.pending} data-testid={`shell.action.${item.key}`}>
          <Icon svg={item.icon} className="[&_svg]:size-4" /> {item.label}
        </Button>
      ))}
    </div>
  )
}

function registrationItem(r: RegistrationRecord, action: ManifestAction | undefined, groups: readonly string[], runtime: ShellBoot['runtime']) {
  const status = r.status.get()
  const permitted = requirementSatisfied(action?.permissions, groups)
  return {
    key: r.registrationId,
    label: action?.title ?? r.action.title,
    icon: action?.icon,
    run: () => void runtime.actions.run({ id: r.actionId, registrationId: r.registrationId, initiator: 'user' }),
    disabled: !permitted || !status.enabled,
    pending: status.pending,
  }
}

/** The shell-owned entries, then every available help action. */
function HelpMenu({ runtime, currentApp }: { runtime: ShellBoot['runtime']; currentApp: AppManifest | undefined }) {
  useObserver(runtime.actions.changes)
  const statics = currentApp?.contributions.actions ?? []
  const staticHelp = statics.filter(a => a.to && (a.placement ?? []).includes('help'))
  const liveHelp = runtime.actions.registered().filter(r => (statics.find(a => a.id === r.actionId)?.placement ?? []).includes('help'))
  return (
    <DropdownMenuTrigger>
      <ShellAction label="Help" data-testid="shell.help">
        <CircleHelp />
      </ShellAction>
      <DropdownMenu placement="bottom end">
        {shellConfig.help.map(h => (
          <DropdownMenuItem key={h.href} onAction={() => window.open(h.href, '_blank', 'noopener')}>
            {h.title}
          </DropdownMenuItem>
        ))}
        {staticHelp.length + liveHelp.length > 0 ? <DropdownMenuSeparator /> : null}
        {staticHelp.map(a => (
          <DropdownMenuItem key={a.id} onAction={() => void runtime.actions.run({ id: a.id, initiator: 'user' })}>
            {a.title}
          </DropdownMenuItem>
        ))}
        {liveHelp.map(r => (
          <DropdownMenuItem key={r.registrationId} onAction={() => void runtime.actions.run({ id: r.actionId, registrationId: r.registrationId, initiator: 'user' })}>
            {statics.find(a => a.id === r.actionId)?.title ?? r.action.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </DropdownMenuTrigger>
  )
}

/** Text confirmations are the shell's dialog. */
function Confirmation({ bridge }: { bridge: ShellBoot['confirmations'] }) {
  const [pending, setPending] = useState<{ request: ConfirmationRequest; resolve: (ok: boolean) => void } | null>(null)
  // The action buttons also close the dialog through React Aria, and that close runs before our press handler,
  // so the decision is recorded first and read when the dialog reports it closed.
  const decision = useRef(false)
  useEffect(() => {
    bridge.set(
      request =>
        new Promise<boolean>(resolve => {
          decision.current = false
          setPending({ request, resolve })
          request.signal.addEventListener('abort', () => resolve(false), { once: true })
        }),
    )
  }, [bridge])
  const finish = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }
  const content = pending?.request.content
  return (
    <AlertDialog isOpen={pending !== null} onOpenChange={open => !open && finish(decision.current)} data-testid="shell.confirm">
      <AlertDialogHeader>
        <AlertDialogTitle>{content?.title ?? 'Are you sure?'}</AlertDialogTitle>
        <AlertDialogDescription>{content?.message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onPress={() => finish(false)} data-testid="shell.confirm.cancel">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction onPressStart={() => (decision.current = true)} onPress={() => finish(true)} data-testid="shell.confirm.ok">
          {content?.confirmLabel ?? 'Confirm'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialog>
  )
}

/** A newer release is a non-blocking prompt; reloading adopts it as a whole. */
function UpdateBanner({ registryUrl, releaseId, runtime }: { registryUrl: string; releaseId: string; runtime: ShellBoot['runtime'] }) {
  const [newer, setNewer] = useState(false)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${registryUrl.replace(/\/+$/, '')}/release`, { cache: 'no-store' })
        if (r.ok && ((await r.json()) as Release).id !== releaseId) setNewer(true)
      } catch {
        /* the current release stays usable */
      }
    }, shellConfig.releasePollInterval)
    return () => clearInterval(timer)
  }, [registryUrl, releaseId])
  if (!newer) return null
  return (
    <div className="bg-muted flex items-center justify-between gap-4 px-3 py-1 text-sm" role="status" data-testid="shell.update">
      <span>A new version of the platform is available.</span>
      <Button
        size="xs"
        onPress={() => {
          if (!runtime.blockersActive()) location.reload()
        }}
      >
        Reload
      </Button>
    </div>
  )
}

function setTheme(theme: ShellBoot['theme'], scheme: 'light' | 'dark') {
  theme.set({ scheme })
  try {
    localStorage.setItem('platform.theme', scheme)
  } catch {
    /* ignore */
  }
}
