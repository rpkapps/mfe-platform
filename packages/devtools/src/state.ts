import type { HostRuntime, OverrideResult } from '@platform/sdk/host'

export interface DevtoolsProps {
  runtime: HostRuntime
  /** The environment document the shell booted with. */
  env?: Record<string, string>
  /** What the boot applied from stored overrides, so the panel can show which rows are remapped and why one failed. */
  overrides?: Pick<OverrideResult, 'applied' | 'errors'>
  /** Where the shell publishes its shared-library manifest; absent in Vite dev mode. */
  sharedManifestUrl?: string
  /** The shared-library sets the shell booted with, one per React major. */
  sharedSets?: SharedSet[]
}

export interface SharedSet {
  major: number
  imports: Record<string, { url: string; integrity?: string; version?: string }>
}

export const OPEN_KEY = 'platform.devtools.open'
export const HEIGHT_KEY = 'platform.devtools.height'
export const TAB_KEY = 'platform.devtools.tab'
/** Unapplied override edits survive tab switches and reloads until applied or discarded. */
export const DRAFT_KEY = 'platform.devtools.overrides.draft'

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

export interface ImportMapEntry {
  specifier: string
  url: string
  integrity?: string
  version?: string
}

export interface ImportMapView {
  imports: ImportMapEntry[]
  /** URL prefix → the entries scoped to it (MFEs on another React major). */
  scopes: Record<string, ImportMapEntry[]>
}

/** The import map the page loaded with, read back from the document. */
export function readImportMap(doc: Document = document): ImportMapView {
  const script = doc.querySelector('script[type="importmap"]')
  if (!script?.textContent) return { imports: [], scopes: {} }
  try {
    const map = JSON.parse(script.textContent) as { imports?: Record<string, string>; scopes?: Record<string, Record<string, string>>; integrity?: Record<string, string> }
    const entry = (specifier: string, url: string): ImportMapEntry => ({ specifier, url, integrity: map.integrity?.[url], version: versionFromUrl(url) })
    return {
      imports: Object.entries(map.imports ?? {}).map(([s, u]) => entry(s, u)),
      scopes: Object.fromEntries(Object.entries(map.scopes ?? {}).map(([prefix, imports]) => [prefix, Object.entries(imports).map(([s, u]) => entry(s, u))])),
    }
  } catch {
    return { imports: [], scopes: {} }
  }
}

/** `/shared/react@19.3.0-DR1cBsct.js` → `19.3.0`. */
export function versionFromUrl(url: string): string | undefined {
  const m = /@(\d+\.\d+\.\d+[^-/]*)-[A-Za-z0-9_-]+\.js$/.exec(url)
  return m?.[1]
}

/** The package name of a specifier: `react/jsx-runtime` → `react`, `@platform/sdk/react` → `@platform/sdk`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

export function shortHash(integrity: string | undefined): string {
  if (!integrity) return '—'
  const [algo, hash] = integrity.split('-')
  return `${algo}-${(hash ?? '').slice(0, 10)}…`
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  if (ms < 1000) return 'now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}
