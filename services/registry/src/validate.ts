import type { Manifest } from '@platform/sdk'
import { CAPABILITY_VERSIONS, PROTOCOL_VERSION, isOwnedBy, isValidId } from '@platform/sdk'
import { ownsPath } from '@platform/sdk/host'
import type { RegistryData, StoredMfe } from './store'

export class ValidationError extends Error {
  constructor(
    readonly problems: string[],
    readonly status = 409,
  ) {
    super(problems.join('; '))
  }
}

/** Checks a published manifest before it is stored (§8, §18). */
export function validateManifest(id: string, manifest: Manifest): string[] {
  const problems: string[] = []
  if (manifest.manifest !== 1) problems.push(`unsupported manifest schema ${String(manifest.manifest)}`)
  if (manifest.id !== id) problems.push(`manifest id "${manifest.id}" does not match "${id}"`)
  if (!isValidId(manifest.id) || manifest.id.includes('.')) problems.push(`invalid MFE id "${manifest.id}"`)
  if (!/^\d+\.\d+\.\d+/.test(manifest.version)) problems.push(`version "${manifest.version}" is not semver`)
  for (const a of manifest.contributions.actions) if (!isOwnedBy(id, a.id) || !isValidId(a.id)) problems.push(`action "${a.id}" is outside the "${id}." prefix`)
  for (const n of manifest.contributions.releaseNotes) if (!isOwnedBy(id, n.id) || !isValidId(n.id)) problems.push(`release note "${n.id}" is outside the "${id}." prefix`)
  if (manifest.kind === 'app') {
    if (!manifest.basePath.startsWith('/')) problems.push(`basePath "${manifest.basePath}" must start with /`)
    for (const p of Object.keys(manifest.paths)) if (!ownsPath(manifest.basePath, p)) problems.push(`path "${p}" is outside basePath "${manifest.basePath}"`)
  } else if (!Number.isInteger(manifest.contract?.version)) problems.push('widget contract.version must be an integer')
  if (!manifest.entries?.main?.url) problems.push('entries.main.url is required')
  if ('zone.js' in (manifest.runtime?.shared ?? {})) problems.push('zone.js may not be shared (§21)')
  return problems
}

/** §19.2: the checks that decide whether a version may go live. */
export function validatePromotion(data: RegistryData, mfe: StoredMfe, version: string | null): string[] {
  const problems: string[] = []
  const live = Object.values(data.mfes).filter(m => m.live && m.id !== mfe.id).map(m => m.versions[m.live!]!.manifest)

  if (version === null) {
    const current = mfe.live ? mfe.versions[mfe.live]?.manifest : undefined
    if (current?.kind === 'widget') {
      const consumers = live.filter(m => m.dependencies.widgets.some(w => w.id === mfe.id)).map(m => m.id)
      if (consumers.length) problems.push(`widget "${mfe.id}" has live consumers: ${consumers.join(', ')}`)
    }
    return problems
  }

  const stored = mfe.versions[version]
  if (!stored) return [`version ${version} of "${mfe.id}" is not published`]
  const { manifest, certification } = stored
  if (!certification?.passed) problems.push(`version ${version} is not certified (§46)`)
  if (manifest.protocol !== PROTOCOL_VERSION) problems.push(`protocol ${manifest.protocol} is not provided by this shell (${PROTOCOL_VERSION})`)
  for (const [cap, major] of Object.entries(manifest.capabilities)) {
    if (CAPABILITY_VERSIONS[cap] !== major) problems.push(`capability ${cap}@${major} is not provided by this shell`)
  }
  if (manifest.kind === 'app') {
    for (const other of live) {
      if (other.kind !== 'app') continue
      if (ownsPath(other.basePath, manifest.basePath) || ownsPath(manifest.basePath, other.basePath)) {
        problems.push(`basePath "${manifest.basePath}" overlaps "${other.basePath}" owned by "${other.id}"`)
      }
    }
  } else {
    const current = mfe.live ? mfe.versions[mfe.live]?.manifest : undefined
    if (current?.kind === 'widget' && current.contract.version !== manifest.contract.version) {
      problems.push(`widget "${mfe.id}" changes its contract from ${current.contract.version} to ${manifest.contract.version}; breaking redesigns use a new id (§29.2)`)
    }
    for (const consumer of live) {
      const dep = consumer.dependencies.widgets.find(w => w.id === mfe.id)
      if (dep && dep.contract !== manifest.contract.version) problems.push(`live consumer "${consumer.id}" needs contract ${dep.contract}; this version provides ${manifest.contract.version}`)
    }
  }
  for (const dep of manifest.dependencies.widgets) {
    const widget = data.mfes[dep.id]
    const liveWidget = widget?.live ? widget.versions[widget.live]?.manifest : undefined
    if (liveWidget && liveWidget.kind === 'widget' && liveWidget.contract.version !== dep.contract) {
      problems.push(`depends on widget "${dep.id}" contract ${dep.contract}; the live version provides ${liveWidget.contract.version}`)
    }
  }
  if (manifest.kind === 'widget' && manifest.dependencies.widgets.some(w => w.id === manifest.id)) problems.push('a widget cannot depend on itself (§29.4)')
  return problems
}
