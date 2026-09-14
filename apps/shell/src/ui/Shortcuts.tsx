import { useEffect } from 'react'
import { requirementSatisfied } from '@platform/sdk'
import { useObserver } from '@platform/sdk/react'
import { useShortcutRegistry, type Shortcut } from '@tecton/react/tecton/shortcuts'
import type { ShellBoot } from '../main'
import { toRegistryKeys } from './shortcuts'

/**
 * Manifest shortcuts, bound through Tecton's registry so the typing rules hold: navigation actions always,
 * live actions while a registration exists. Mod+K opens the palette.
 */
export function ShellShortcuts({ boot, openPalette }: { boot: ShellBoot; openPalette(query?: string): void }) {
  const registry = useShortcutRegistry()
  const { runtime } = boot
  useObserver(runtime.actions.changes)
  const groups = useObserver(runtime.groups)
  const registered = runtime.actions.registered()
  const liveIds = [...new Set(registered.map(r => r.actionId))].sort().join(',')

  useEffect(() => {
    const shortcuts: Shortcut[] = [
      { id: 'shell.palette', keys: 'mod+k', label: 'Command palette', group: 'Shell', allowInInput: true, onAction: e => (e.preventDefault(), openPalette()) },
    ]
    for (const m of Object.values(runtime.release.mfes)) {
      for (const a of m.contributions.actions) {
        if (!a.shortcut || !requirementSatisfied(a.permissions, groups)) continue
        if (!a.to && !liveIds.split(',').includes(a.id)) continue
        shortcuts.push({
          id: `action:${a.id}`,
          keys: toRegistryKeys(a.shortcut),
          label: a.title,
          group: m.title,
          allowInInput: true,
          onAction: e => {
            e.preventDefault()
            void runtime.actions.run({ id: a.id, initiator: 'shortcut' }).then(result => {
              if (result.status === 'target-required') openPalette(a.title)
            })
          },
        })
      }
    }
    return registry.register(shortcuts)
  }, [registry, runtime, groups, liveIds, openPalette])
  return null
}
