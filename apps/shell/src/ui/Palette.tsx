import { useMemo } from 'react'
import type { AppManifest, ManifestAction } from '@platform/sdk'
import { requirementSatisfied } from '@platform/sdk'
import { useObserver } from '@platform/sdk/react'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@tecton/react/components/command'
import { formatShortcut } from '@tecton/react/tecton/shortcuts'
import { ExternalLink } from 'lucide-react'
import type { ShellBoot } from '../main'
import { shellConfig } from '../config'
import { Icon } from './icon'
import { codeOf, toneOf, toRegistryKeys } from './shortcuts'
import { AppFinderIcon } from '@tecton/react/tecton/app-finder'

export interface PaletteProps {
  boot: ShellBoot
  open: boolean
  onOpenChange(open: boolean): void
  /** Pre-filled query, used when a shortcut needs the user to pick a target. */
  query?: string
  apps: AppManifest[]
  currentApp: AppManifest | undefined
}

interface Entry {
  key: string
  group: 'Apps' | 'Actions' | 'Help'
  title: string
  description?: string
  icon?: string
  code?: string
  shortcut?: string
  external?: boolean
  run(): void
}

/** The command palette: every app, every available action, and help, in one searchable list (Mod+K). */
export function Palette({ boot, open, onOpenChange, query, apps, currentApp }: PaletteProps) {
  const { runtime } = boot
  const registrations = useObserver(runtime.actions.changes)
  const groups = useObserver(runtime.groups)

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = []
    for (const app of apps) {
      list.push({ key: `app:${app.id}`, group: 'Apps', title: app.title, description: app.description, icon: app.icon, code: codeOf(app.id), run: () => void runtime.navigate({ to: app.basePath }) })
    }
    const statics = new Map<string, ManifestAction>()
    for (const m of Object.values(runtime.release.mfes)) for (const a of m.contributions.actions) statics.set(a.id, a)
    const placedIn = (a: ManifestAction | undefined, where: 'palette' | 'help') => (a?.placement ?? ['palette']).includes(where)
    // Static navigation actions work even when their app is not loaded.
    for (const a of statics.values()) {
      if (!a.to || !requirementSatisfied(a.permissions, groups)) continue
      const external = /^https?:\/\//.test(a.to)
      const entry: Entry = { key: `nav:${a.id}`, group: placedIn(a, 'palette') ? 'Actions' : 'Help', title: a.title, description: a.description ?? (external ? a.to : undefined), icon: a.icon, shortcut: a.shortcut, external, run: () => void runtime.actions.run({ id: a.id, initiator: 'user' }) }
      if (placedIn(a, 'palette') || placedIn(a, 'help')) list.push(entry)
    }
    // Live registrations: one entry per registration, so a target is never ambiguous.
    for (const r of runtime.actions.registered()) {
      const a = statics.get(r.actionId)
      if (!requirementSatisfied(a?.permissions ?? r.action.permissions, groups)) continue
      const group = placedIn(a, 'palette') ? 'Actions' : placedIn(a, 'help') ? 'Help' : undefined
      if (!group) continue
      list.push({
        key: `reg:${r.registrationId}`,
        group,
        title: r.target ? `${a?.title ?? r.action.title}: ${r.target.label}` : (a?.title ?? r.action.title),
        description: r.enabled ? a?.description : (r.disabledReason ?? 'Not available right now'),
        icon: a?.icon,
        shortcut: a?.shortcut,
        run: () => void runtime.actions.run({ id: r.actionId, registrationId: r.registrationId, initiator: 'user' }),
      })
    }
    for (const h of shellConfig.help) list.push({ key: `help:${h.href}`, group: 'Help', title: h.title, description: h.href, external: true, run: () => window.open(h.href, '_blank', 'noopener') })
    return list
  }, [apps, groups, runtime, currentApp, registrations])

  const byGroup = (group: Entry['group']) => entries.filter(e => e.group === group)
  const run = (key: string | number) => {
    const entry = entries.find(e => e.key === String(key))
    onOpenChange(false)
    entry?.run()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search apps and actions" className="max-w-xl" data-testid="shell.palette">
      <Command defaultInputValue={query}>
        <CommandInput placeholder="Search apps and actions…" autoFocus data-testid="shell.palette.input" />
        <CommandList onAction={run} aria-label="Commands" className="max-h-80" renderEmptyState={() => <CommandEmpty>Nothing matches.</CommandEmpty>} data-entry-count={entries.length}>
          {(['Apps', 'Actions', 'Help'] as const).map(group => {
            const items = byGroup(group)
            if (items.length === 0) return null
            return (
              <CommandGroup key={group} heading={group}>
                {items.map(e => (
                  <CommandItem key={e.key} id={e.key} textValue={`${e.title} ${e.description ?? ''}`} data-testid={`shell.palette.${e.key}`}>
                    {e.code ? (
                      <AppFinderIcon tone={toneOf(e.key.slice(4))} size="sm">
                        {e.code}
                      </AppFinderIcon>
                    ) : e.icon ? (
                      <Icon svg={e.icon} className="[&_svg]:size-4" />
                    ) : e.external ? (
                      <ExternalLink className="size-4" />
                    ) : null}
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate">{e.title}</span>
                      {e.description ? <span className="text-muted-foreground truncate text-xs">{e.description}</span> : null}
                    </span>
                    {e.shortcut ? (
                      <CommandShortcut>
                        {formatShortcut(toRegistryKeys(e.shortcut))
                          .map(chord => chord.join(''))
                          .join(' ')}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
