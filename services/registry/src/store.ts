import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Manifest } from '@platform/sdk'

export interface Certification {
  suite: string
  sdk: string
  passed: boolean
  report: unknown
}

export interface StoredVersion {
  manifest: Manifest
  certification: Certification
  publishedAt: string
}

export interface StoredMfe {
  id: string
  owner: { team: string; repo: string }
  claimedAt: string
  live: string | null
  liveChangedAt?: string
  versions: Record<string, StoredVersion>
}

export interface RegistryData {
  mfes: Record<string, StoredMfe>
}

export interface Store {
  read(): RegistryData
  write(mutate: (data: RegistryData) => void): RegistryData
  artifactPath(id: string, version: string, name: string): string
  putArtifact(id: string, version: string, name: string, bytes: Uint8Array): void
  getArtifact(id: string, version: string, name: string): Uint8Array | undefined
}

/** One JSON document plus an artifact directory; enough for one environment's registry. */
export function createFileStore(dir: string): Store {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'registry.json')
  const artifacts = path.join(dir, 'artifacts')
  let cache: RegistryData | undefined
  const load = (): RegistryData => {
    if (cache) return cache
    cache = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RegistryData) : { mfes: {} }
    return cache
  }
  const safeName = (s: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(s) || s.includes('..')) throw new Error(`Invalid path segment "${s}"`)
    return s
  }
  return {
    read: load,
    write(mutate) {
      const data = load()
      mutate(data)
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, file)
      return data
    },
    artifactPath: (id, version, name) => path.join(artifacts, safeName(id), safeName(version), safeName(name)),
    putArtifact(id, version, name, bytes) {
      const p = path.join(artifacts, safeName(id), safeName(version), safeName(name))
      mkdirSync(path.dirname(p), { recursive: true })
      writeFileSync(p, bytes)
    },
    getArtifact(id, version, name) {
      const p = path.join(artifacts, safeName(id), safeName(version), safeName(name))
      return existsSync(p) ? readFileSync(p) : undefined
    },
  }
}

export function createMemoryStore(): Store {
  const data: RegistryData = { mfes: {} }
  const blobs = new Map<string, Uint8Array>()
  return {
    read: () => data,
    write(mutate) {
      mutate(data)
      return data
    },
    artifactPath: (id, version, name) => `${id}/${version}/${name}`,
    putArtifact: (id, version, name, bytes) => void blobs.set(`${id}/${version}/${name}`, bytes),
    getArtifact: (id, version, name) => blobs.get(`${id}/${version}/${name}`),
  }
}
