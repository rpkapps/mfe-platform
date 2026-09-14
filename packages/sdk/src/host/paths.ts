import type { AppManifest, Manifest } from '../manifest'

/** Prefix ownership: exact basePath or a descendant at a segment boundary; longest prefix wins. */
export function findOwningApp(mfes: Record<string, Manifest>, pathname: string): AppManifest | undefined {
  let best: AppManifest | undefined
  for (const manifest of Object.values(mfes)) {
    if (manifest.kind !== 'app') continue
    if (!ownsPath(manifest.basePath, pathname)) continue
    if (!best || manifest.basePath.length > best.basePath.length) best = manifest
  }
  return best
}

export function ownsPath(basePath: string, pathname: string): boolean {
  const base = basePath.replace(/\/+$/, '') || '/'
  if (base === '/') return true
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** `/customers/$customerId` + `{ customerId: '123' }` → `/customers/123`; search values are strings, or JSON for non-strings. */
export function buildPath(options: { to: string; params?: Record<string, string | number>; search?: Record<string, unknown> }): string {
  const { to, params = {}, search } = options
  const path = to.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing param "${name}" for path "${to}"`)
    return encodeURIComponent(String(value))
  })
  if (!search) return path
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue
    qs.set(key, typeof value === 'string' ? value: JSON.stringify(value))
  }
  const q = qs.toString()
  return q ? `${path}?${q}`: path
}

export function joinPath(basePath: string, relative: string): string {
  const base = basePath.replace(/\/+$/, '')
  if (relative === '/' || relative === '') return base || '/'
  return `${base}/${relative.replace(/^\/+/, '')}`
}
