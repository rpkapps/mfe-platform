import { createHash } from 'node:crypto'
import type { ActionDefinition, AppDefinition, AppManifest, JsonSchema, Manifest, ReleaseNoteDefinition, Schema, WidgetDefinition, WidgetManifest } from '@platform/sdk'
import { CAPABILITY_VERSIONS, PROTOCOL_VERSION, isValidId, qualifyId } from '@platform/sdk'
import { joinPath } from '@platform/sdk/host'

export interface BuildInfo {
  id: string
  version: string
  sdk: string
  commit?: string
  frameworkVersion?: string
  shared: Record<string, string>
  entry: { url: string; bytes: Uint8Array }
  styles?: { url: string; bytes: Uint8Array; scope: string }
  owner?: { team: string; repo: string }
  tailwind?: string
}

export function integrity(bytes: Uint8Array): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`
}

type AnyDefinition = AppDefinition | WidgetDefinition<unknown, Record<string, unknown>>

/** Everything the shell needs up front, derived from the definition and contributions. */
export function createManifest(definition: AnyDefinition, contributions: Record<string, unknown>, info: BuildInfo): Manifest {
  const id = definition.id ?? info.id
  if (!isValidId(id) || id.includes('.')) throw new Error(`Invalid MFE id "${id}"`)
  const actions: AppManifest['contributions']['actions'] = []
  const releaseNotes: AppManifest['contributions']['releaseNotes'] = []
  for (const [name, value] of Object.entries(contributions)) {
    if (!value || typeof value !== 'object') continue
    if ('kind' in value && ((value as ActionDefinition).kind === 'live' || (value as ActionDefinition).kind === 'navigation')) {
      const a = value as ActionDefinition
      if (!a.id) throw new Error(`Action exported as "${name}" has no id`)
      actions.push({
        id: qualifyId(id, a.id),
        title: a.title,...(a.description ? { description: a.description }: {}),...(a.icon ? { icon: a.icon }: {}),...(a.permissions ? { permissions: a.permissions }: {}),...(a.effect ? { effect: a.effect }: {}),...(a.shortcut ? { shortcut: a.shortcut }: {}),...(a.placement ? { placement: a.placement }: {}),...(a.kind === 'navigation' ? { to: a.to,...(a.confirmation ? { confirmation: a.confirmation }: {}) }: {}),
      })
    } else if ('version' in value && 'date' in value && 'title' in value) {
      const n = value as ReleaseNoteDefinition
      if (!n.id) throw new Error(`Release note exported as "${name}" has no id`)
      releaseNotes.push({ id: qualifyId(id, n.id), version: n.version, date: n.date, title: n.title,...(n.body ? { body: n.body }: {}),...(n.to ? { to: n.to }: {}),...(n.audience ? { audience: n.audience }: {}) })
    }
  }
  const deps = definition.dependencies ?? {}
  const capabilities: Record<string, number> = {}
  // The SDK is a singleton; every capability client it ships is available at its current major.
  for (const [cap, major] of Object.entries(CAPABILITY_VERSIONS)) if (!deps.capabilities || deps.capabilities.includes(cap)) capabilities[cap] = major

  const base = {
    manifest: 1 as const,
    id,
    version: info.version,
    protocol: PROTOCOL_VERSION,
    title: definition.title,...(definition.description ? { description: definition.description }: {}),...(info.owner ? { owner: info.owner }: {}),
    capabilities,
    runtime: { framework: 'react' as const,...(info.frameworkVersion ? { frameworkVersion: info.frameworkVersion }: {}), shared: info.shared },
    entries: {
      main: { url: info.entry.url, integrity: integrity(info.entry.bytes) },
      styles: info.styles ? [{ url: info.styles.url, integrity: integrity(info.styles.bytes), scope: info.styles.scope }]: [],
    },
    contributions: { releaseNotes, actions },
    definitions: { pageEvents: [], storage: [] },
    dependencies: {
      widgets: dedupeWidgets(deps.widgets ?? []),
      links: [...new Set(deps.links ?? [])],
      permissions: [...new Set([...(deps.permissions ?? []),...requirementIds('permissions' in definition ? definition: {}),...actions.flatMap(a => requirementIds(a))])],
      serverEvents: [...new Set(deps.serverEvents ?? [])],
    },
    build: { sdk: info.sdk,...(info.tailwind ? { tailwind: info.tailwind }: {}),...(info.commit ? { commit: info.commit }: {}), builtAt: new Date().toISOString() },
  }

  if ('basePath' in definition) {
    const paths: AppManifest['paths'] = {}
    for (const [rel, decl] of Object.entries(definition.paths ?? {})) {
      paths[joinPath(definition.basePath, rel)] = {...(decl.params ? { params: toJsonSchema(decl.params, `path ${rel} params`) }: {}),...(decl.search ? { search: toJsonSchema(decl.search, `path ${rel} search`) }: {}),
      }
    }
    if (!paths[definition.basePath]) paths[definition.basePath] = {}
    const m: AppManifest = {...base,
      kind: 'app',...(definition.icon ? { icon: definition.icon }: {}),...(definition.permissions ? { permissions: definition.permissions }: {}),
      basePath: definition.basePath,
      paths,
      redirects: definition.redirects ?? {},
    }
    return m
  }
  const m: WidgetManifest = {...base,
    kind: 'widget',
    contract: { version: definition.contract.version },
    props: toJsonSchema(definition.props, 'props'),
    events: Object.fromEntries(Object.entries(definition.events ?? {}).map(([k, s]) => [k, toJsonSchema(s as Schema, `event ${k}`)])),
  }
  return m
}

function requirementIds(x: { permissions?: string[] | { any: string[] } }): string[] {
  if (!x.permissions) return []
  return Array.isArray(x.permissions) ? x.permissions: x.permissions.any
}

function dedupeWidgets(list: Array<{ id: string; contract: number }>) {
  const byId = new Map<string, number>()
  for (const w of list) {
    const existing = byId.get(w.id)
    if (existing !== undefined && existing !== w.contract) throw new Error(`Widget "${w.id}" is declared with contracts ${existing} and ${w.contract}; a release provides one contract per id`)
    byId.set(w.id, w.contract)
  }
  return [...byId].map(([id, contract]) => ({ id, contract }))
}

/** Zod ≥ 4 is converted by the build; anything else must expose `jsonSchema`. */
export function toJsonSchema(schema: Schema, where: string): JsonSchema {
  const s = schema as Schema & { jsonSchema?: JsonSchema; _zod?: unknown }
  if (s.jsonSchema && typeof s.jsonSchema === 'object') return s.jsonSchema
  const vendor = schema['~standard'].vendor
  if (vendor === 'zod' && s._zod) {
    const zod = getZod()
    if (!zod) throw new Error(`${where}: Zod schemas need zod ≥ 4 resolvable from the project`)
    return zod.toJSONSchema(schema as never, { unrepresentable: 'any', io: 'input' }) as JsonSchema
  }
  throw new Error(`${where}: schemas from "${vendor}" must expose a \`jsonSchema\` property`)
}

let zodModule: { toJSONSchema: (schema: unknown, options?: Record<string, unknown>) => unknown } | null | undefined
export function setZod(mod: typeof zodModule) {
  zodModule = mod
}
function getZod() {
  return zodModule ?? null
}
