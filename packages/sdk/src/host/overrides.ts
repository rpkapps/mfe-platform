import type { Manifest, Release } from '../manifest'

/** A developer's per-browser remap: the MFE resolves to the manifest at this URL instead of the release's entry. */
export interface DevOverride {
  manifestUrl: string
}

export type DevOverrides = Record<string, DevOverride>

export interface OverrideResult {
  release: Release
  /** Ids that were replaced, with the manifest that now stands in. */
  applied: Record<string, Manifest>
  /** Ids whose manifest could not be fetched or was invalid; the release entry stays as it was. */
  errors: Record<string, string>
}

export const DEV_OVERRIDES_KEY = 'platform.devtools.overrides'
export const DEVTOOLS_FLAG_KEY = 'platform.devtools'

export function readDevOverrides(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): DevOverrides {
  try {
    const raw = storage?.getItem(DEV_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: DevOverrides = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const url = (value as { manifestUrl?: unknown } | null)?.manifestUrl
      if (typeof url === 'string' && url.trim()) out[id] = { manifestUrl: url.trim() }
    }
    return out
  } catch {
    return {}
  }
}

export function writeDevOverrides(overrides: DevOverrides, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  try {
    if (Object.keys(overrides).length === 0) storage?.removeItem(DEV_OVERRIDES_KEY)
    else storage?.setItem(DEV_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    /* storage unavailable */
  }
}

export function devtoolsEnabled(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(DEVTOOLS_FLAG_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Replaces release entries with the manifests the overrides point at. Entry and style URLs in a fetched manifest are
 * resolved against the manifest URL; their integrity is dropped because a dev server rebuilds on every change.
 * Runs before the runtime is created: a page pins one release, so applying an override means reloading.
 */
export async function applyDevOverrides(release: Release, overrides: DevOverrides, fetchImpl: typeof fetch = fetch): Promise<OverrideResult> {
  const applied: Record<string, Manifest> = {}
  const errors: Record<string, string> = {}
  const mfes = { ...release.mfes }
  await Promise.all(
    Object.entries(overrides).map(async ([id, override]) => {
      try {
        const response = await fetchImpl(override.manifestUrl, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const manifest = (await response.json()) as Manifest
        if (manifest?.manifest !== 1 || typeof manifest.id !== 'string' || !manifest.entries?.main?.url) throw new Error('not a manifest')
        if (manifest.id !== id) throw new Error(`manifest is for "${manifest.id}", not "${id}"`)
        const absolute = (url: string) => new URL(url, override.manifestUrl).toString()
        manifest.entries.main = { url: absolute(manifest.entries.main.url), integrity: '' }
        manifest.entries.styles = manifest.entries.styles.map(s => ({ ...s, url: absolute(s.url), integrity: '' }))
        mfes[id] = manifest
        applied[id] = manifest
      } catch (error) {
        errors[id] = error instanceof Error ? error.message : String(error)
      }
    }),
  )
  return { release: { ...release, mfes }, applied, errors }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
