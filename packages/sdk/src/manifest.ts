import type { Placement, ActionEffect, Requirement } from './definitions'

export type JsonSchema = Record<string, unknown>

export interface ManifestEntry {
  url: string
  integrity: string
}

export interface ManifestStyleEntry extends ManifestEntry {
  scope: string
}

export interface ManifestAction {
  id: string
  title: string
  description?: string
  icon?: string
  permissions?: Requirement
  effect?: ActionEffect
  shortcut?: string
  placement?: Placement[]
  to?: string
  confirmation?: { title?: string; message: string; confirmLabel?: string }
}

export interface ManifestReleaseNote {
  id: string
  version: string
  date: string
  title: string
  body?: string
  to?: string
  audience?: { permissions?: Requirement }
}

export interface ManifestBase {
  manifest: 1
  id: string
  version: string
  protocol: number
  title: string
  description?: string
  owner?: { team: string; repo: string }
  capabilities: Record<string, number>
  runtime: {
    framework: 'react' | 'angular' | 'none'
    frameworkVersion?: string
    zoneless?: boolean
    shared: Record<string, string>
  }
  entries: {
    main: ManifestEntry
    styles: ManifestStyleEntry[]
  }
  contributions: {
    releaseNotes: ManifestReleaseNote[]
    actions: ManifestAction[]
  }
  definitions: {
    pageEvents: string[]
    storage: Array<{ id: string; version: number }>
  }
  dependencies: {
    widgets: Array<{ id: string; contract: number }>
    links: string[]
    permissions: string[]
    serverEvents: string[]
  }
  build: { sdk: string; tailwind?: string; commit?: string; builtAt: string }
}

export interface AppManifest extends ManifestBase {
  kind: 'app'
  icon?: string
  permissions?: Requirement
  basePath: string
  /** Absolute (joined with basePath by the build, §25). */
  paths: Record<string, { params?: JsonSchema; search?: JsonSchema }>
  redirects: Record<string, string>
}

export interface WidgetManifest extends ManifestBase {
  kind: 'widget'
  contract: { version: number }
  props: JsonSchema
  events: Record<string, JsonSchema>
}

export type Manifest = AppManifest | WidgetManifest

export interface ImportMap {
  imports: Record<string, string>
  scopes?: Record<string, Record<string, string>>
  integrity?: Record<string, string>
}

/** §19.3. */
export interface Release {
  id: string
  createdAt: string
  shell: string
  protocol: number
  capabilities: Record<string, number>
  mfes: Record<string, Manifest>
  shared: Record<string, { version: string; url: string; integrity: string }>
  importMaps: ImportMap[]
}

export const PROTOCOL_VERSION = 1

/** The capability majors this SDK ships (§16). */
export const CAPABILITY_VERSIONS: Readonly<Record<string, number>> = Object.freeze({
  identity: 1,
  permissions: 1,
  navigation: 1,
  http: 1,
  widgets: 1,
  actions: 1,
})

/** CSS scope token for an MFE version: `orders@18` (§30.3). */
export function scopeToken(id: string, version: string): string {
  const major = version.split('.')[0] ?? '0'
  return `${id}@${major}`
}
