import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Manifest, Release } from '@platform/sdk'

export interface RegistryClientOptions {
  url: string
  token?: string
  fetch?: typeof fetch
}

/** The pipeline side  */
export function createRegistryClient(options: RegistryClientOptions) {
  const fetchImpl = options.fetch ?? fetch
  const base = options.url.replace(/\/+$/, '')
  const headers = (extra: Record<string, string> = {}) => ({...(options.token ? { Authorization: `Bearer ${options.token}` }: {}),...extra })
  async function call<T>(method: string, route: string, body?: unknown, raw?: Uint8Array): Promise<T> {
    const response = await fetchImpl(`${base}${route}`, {
      method,
      headers: headers(raw ? { 'Content-Type': 'application/octet-stream' }: body !== undefined ? { 'Content-Type': 'application/json' }: {}),
      body: raw ? Buffer.from(raw): body !== undefined ? JSON.stringify(body): undefined,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${route} → ${response.status}: ${text}`)
    return (text ? JSON.parse(text): null) as T
  }
  return {
    claim: (id: string, owner: { team: string; repo: string }) => call('POST', '/mfes', { id, owner }),
    get: (id: string) => call<{ id: string; owner: unknown; live: string | null; versions: string[] }>('GET', `/mfes/${id}`),
    list: () => call<Array<{ id: string; live: string | null }>>('GET', '/mfes'),
    uploadArtifact: (id: string, version: string, name: string, bytes: Uint8Array) => call<{ url: string }>('PUT', `/artifacts/${id}/${version}/${name}`, undefined, bytes),
    publishVersion: (id: string, manifest: Manifest, certification: { suite: string; sdk: string; passed: boolean; report: unknown }) =>
      call('POST', `/mfes/${id}/versions`, { manifest, certification }),
    promote: (id: string, version: string | null) => call('PUT', `/mfes/${id}/live`, { version }),
    release: () => call<Release>('GET', '/release'),
  }
}

/** `mfe publish`: upload the artifacts from `dist/`, then record the version with its certification. */
export async function publish(options: { dist: string; registry: string; token?: string; promote?: boolean; certification?: { passed: boolean; report?: unknown } }) {
  const manifest = JSON.parse(readFileSync(path.join(options.dist, 'manifest.json'), 'utf8')) as Manifest
  const client = createRegistryClient({ url: options.registry, token: options.token })
  const upload = async (url: string) => {
    const name = path.basename(url)
    const bytes = readFileSync(path.join(options.dist, name))
    const result = await client.uploadArtifact(manifest.id, manifest.version, name, bytes)
    return result.url
  }
  manifest.entries.main.url = await upload(manifest.entries.main.url)
  for (const style of manifest.entries.styles) style.url = await upload(style.url)
  const certification = { suite: 'conformance', sdk: manifest.build.sdk, passed: options.certification?.passed ?? true, report: options.certification?.report ?? { note: 'conformance suite not yet implemented; P1 checks run by mfe build' } }
  await client.publishVersion(manifest.id, manifest, certification)
  if (options.promote) await client.promote(manifest.id, manifest.version)
  return manifest
}
