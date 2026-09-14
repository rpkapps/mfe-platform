/**
 * Runs before any module: fetches the environment document and the release, applies DevTools overrides,
 * builds the import map (the shell's React major globally, other majors scoped to each MFE's URL prefix),
 * inserts it, and only then loads the shell's module scripts. Bundled to a classic inline script by the Vite plugin.
 */
import type { Release } from '@platform/sdk'
import { applyDevOverrides, devtoolsEnabled, readDevOverrides, type OverrideResult } from '@platform/sdk/host'

declare const __BOOT_CONFIG__: BootConfig

export interface SharedSet {
  major: number
  imports: Record<string, { url: string; integrity?: string; version?: string }>
}

export interface BootConfig {
  /** Module scripts to load once the import map is in place. */
  modules: string[]
  /** Dev server: shared libraries as virtual modules (the shell's major only). */
  devShared?: SharedSet
  /** Build: where each major's shared.json is served. */
  sharedManifests?: string[]
  /** The shell's own React major. */
  major: number
}

export interface PlatformBoot {
  env: Record<string, string>
  release: Release
  overrides: Pick<OverrideResult, 'applied' | 'errors'> | undefined
  devtools: boolean
  importMap: { imports: Record<string, string>; scopes: Record<string, Record<string, string>>; integrity: Record<string, string> }
  sharedSets: SharedSet[]
  error?: string
}

const RELEASE_CACHE = 'platform.release'

async function boot(config: BootConfig): Promise<void> {
  const result: Partial<PlatformBoot> = { devtools: devtoolsEnabled() }
  try {
    const env = (await fetch('/platform-env.json', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`platform-env.json: HTTP ${r.status}`)
      return r.json()
    })) as Record<string, string>
    for (const key of ['PLATFORM_ENVIRONMENT', 'PLATFORM_REGISTRY_URL', 'PLATFORM_CDN_URL']) {
      if (!env[key]) throw new Error(`Shell configuration is missing ${key}`)
    }
    result.env = env

    let release = await loadRelease(env.PLATFORM_REGISTRY_URL!)
    const overrides = readDevOverrides()
    if (Object.keys(overrides).length > 0) {
      const applied = await applyDevOverrides(release, overrides)
      release = applied.release
      result.overrides = { applied: applied.applied, errors: applied.errors }
      for (const [id, error] of Object.entries(applied.errors)) console.warn(`DevTools override for "${id}" failed: ${error}`)
    } else if (result.devtools) result.overrides = { applied: {}, errors: {} }
    result.release = release

    const sets: SharedSet[] = config.devShared ? [config.devShared] : await Promise.all((config.sharedManifests ?? []).map(url => fetch(url, { cache: 'no-store' }).then(r => r.json() as Promise<SharedSet>)))
    result.sharedSets = sets
    result.importMap = buildImportMap(release, sets, config.major)
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.importMap = { imports: config.devShared ? Object.fromEntries(Object.entries(config.devShared.imports).map(([k, v]) => [k, v.url])) : {}, scopes: {}, integrity: {} }
    if (!config.devShared && config.sharedManifests?.length) {
      // The shell still needs its own libraries to render the maintenance page.
      try {
        const set = (await fetch(config.sharedManifests[0]!, { cache: 'no-store' }).then(r => r.json())) as SharedSet
        result.importMap = buildImportMap({ mfes: {} } as unknown as Release, [set], config.major)
      } catch {
        /* nothing more to do */
      }
    }
  }
  ;(window as unknown as { __platform: Partial<PlatformBoot> }).__platform = result
  const map = document.createElement('script')
  map.type = 'importmap'
  map.textContent = JSON.stringify(result.importMap)
  document.head.appendChild(map)
  for (const src of config.modules) {
    const script = document.createElement('script')
    script.type = 'module'
    script.crossOrigin = 'anonymous'
    script.src = src
    document.body.appendChild(script)
  }
}

/** The release's `shared` and `importMaps` are empty in this phase: shared libraries are shell-hosted. */
export function buildImportMap(release: Release, sets: SharedSet[], defaultMajor: number): PlatformBoot['importMap'] {
  const imports: Record<string, string> = {}
  const scopes: Record<string, Record<string, string>> = {}
  const integrity: Record<string, string> = {}
  const byMajor = new Map(sets.map(s => [s.major, s]))
  const base = byMajor.get(defaultMajor)
  if (base) {
    for (const [specifier, entry] of Object.entries(base.imports)) {
      imports[specifier] = entry.url
      if (entry.integrity) integrity[entry.url] = entry.integrity
    }
  }
  for (const manifest of Object.values(release.mfes)) {
    const major = Number((manifest.runtime.frameworkVersion ?? '').split('.')[0])
    if (!major || major === defaultMajor) continue
    const set = byMajor.get(major)
    if (!set) continue
    const prefix = new URL('.', new URL(manifest.entries.main.url, location.href)).href
    scopes[prefix] = {}
    for (const [specifier, entry] of Object.entries(set.imports)) {
      scopes[prefix]![specifier] = entry.url
      if (entry.integrity) integrity[entry.url] = entry.integrity
    }
  }
  return { imports, scopes, integrity }
}

/** One release per page; the last good one is kept for registry outages. */
async function loadRelease(registryUrl: string): Promise<Release> {
  try {
    const response = await fetch(`${registryUrl.replace(/\/+$/, '')}/release`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
    const release = (await response.json()) as Release
    try {
      localStorage.setItem(RELEASE_CACHE, JSON.stringify(release))
    } catch {
      /* ignore */
    }
    return release
  } catch (error) {
    let cached: string | null = null
    try {
      cached = localStorage.getItem(RELEASE_CACHE)
    } catch {
      cached = null
    }
    if (cached) {
      console.warn('registry unavailable; using the cached release', error)
      return JSON.parse(cached) as Release
    }
    throw new Error(`The registry at ${registryUrl} is unavailable and no release is cached (${error instanceof Error ? error.message : String(error)})`)
  }
}

void boot(__BOOT_CONFIG__)
