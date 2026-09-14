import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Manifest, Release } from '@platform/sdk'
import { CAPABILITY_VERSIONS, PROTOCOL_VERSION } from '@platform/sdk'
import type { Certification, Store } from './store'
import { ValidationError, validateManifest, validatePromotion } from './validate'

export interface RegistryOptions {
  store: Store
  /** Bearer token required for writes; absent = open (development). */
  token?: string
  /** Origin the registry is reachable at; artifact URLs in the release are absolute (PLATFORM_CDN_URL points here in dev). */
  publicUrl?: string
  shellVersion?: string
}

const CONTENT_TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml' }

export function createRegistryApp(options: RegistryOptions) {
  const { store } = options
  const app = new Hono()
  app.use('*', cors({ origin: origin => origin ?? '*', allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'], allowHeaders: ['Authorization', 'Content-Type'] }))

  const authorize = (header: string | undefined) => {
    if (!options.token) return true
    return header === `Bearer ${options.token}`
  }
  app.use('*', async (c, next) => {
    if ((c.req.method === 'POST' || c.req.method === 'PUT') && !authorize(c.req.header('Authorization'))) return c.json({ error: 'unauthorized' }, 401)
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: 'validation', problems: err.problems }, err.status as 409)
    console.error(err)
    return c.json({ error: err.message }, 500)
  })

  const summary = (id: string) => {
    const m = store.read().mfes[id]
    if (!m) return undefined
    return { id: m.id, owner: m.owner, claimedAt: m.claimedAt, live: m.live, liveChangedAt: m.liveChangedAt, versions: Object.keys(m.versions).sort(semverCompare) }
  }

  // Claim an id once, before first publish.
  app.post('/mfes', async c => {
    const body = (await c.req.json()) as { id?: string; owner?: { team?: string; repo?: string } }
    if (!body.id || !body.owner?.team) throw new ValidationError(['body: { id, owner: { team, repo } }'], 400)
    const id = body.id
    store.write(data => {
      const existing = data.mfes[id]
      if (existing && existing.owner.team !== body.owner!.team) throw new ValidationError([`"${id}" is owned by team ${existing.owner.team}`], 403)
      data.mfes[id] ??= { id, owner: { team: body.owner!.team!, repo: body.owner!.repo ?? '' }, claimedAt: new Date().toISOString(), live: null, versions: {} }
    })
    return c.json(summary(id), 201)
  })

  app.get('/mfes', c => c.json(Object.keys(store.read().mfes).sort().map(id => summary(id))))
  app.get('/mfes/:id', c => {
    const s = summary(c.req.param('id'))
    return s ? c.json(s): c.json({ error: 'not found' }, 404)
  })

  // `mfe publish` from CI: manifest + certification; artifacts were uploaded first.
  app.post('/mfes/:id/versions', async c => {
    const id = c.req.param('id')
    const body = (await c.req.json()) as { manifest?: Manifest; certification?: Certification; replace?: boolean }
    if (!body.manifest || !body.certification) throw new ValidationError(['body: { manifest, certification }'], 400)
    // Versions are immutable; a development registry (no token) lets a rebuild replace one while iterating.
    const replace = body.replace === true && !options.token
    const problems = validateManifest(id, body.manifest)
    if (problems.length) throw new ValidationError(problems, 400)
    const manifest = body.manifest
    store.write(data => {
      const mfe = data.mfes[id]
      if (!mfe) throw new ValidationError([`"${id}" is not claimed; run mfe init first`], 403)
      if (mfe.versions[manifest.version] && !replace) throw new ValidationError([`${id}@${manifest.version} is already published; versions are immutable`], 409)
      mfe.versions[manifest.version] = { manifest, certification: body.certification!, publishedAt: new Date().toISOString() }
    })
    return c.json({ id, version: manifest.version }, 201)
  })

  app.get('/mfes/:id/versions/:version', c => {
    const v = store.read().mfes[c.req.param('id')]?.versions[c.req.param('version')]
    return v ? c.json(v): c.json({ error: 'not found' }, 404)
  })

  // The only deployment lever.
  app.put('/mfes/:id/live', async c => {
    const id = c.req.param('id')
    const body = (await c.req.json()) as { version?: string | null }
    if (body.version === undefined) throw new ValidationError(['body: { version: string | null }'], 400)
    store.write(data => {
      const mfe = data.mfes[id]
      if (!mfe) throw new ValidationError([`"${id}" is not claimed`], 404)
      const problems = validatePromotion(data, mfe, body.version!)
      if (problems.length) throw new ValidationError(problems)
      mfe.live = body.version!
      mfe.liveChangedAt = new Date().toISOString()
    })
    return c.json(summary(id))
  })

  app.get('/release', c => c.json(computeRelease(store, options)))

  // Development artifact store; production uses a CDN.
  app.put('/artifacts/:id/:version/:name', async c => {
    const { id, version, name } = c.req.param()
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    store.putArtifact(id, version, name, bytes)
    return c.json({ url: `/artifacts/${id}/${version}/${name}`, bytes: bytes.byteLength }, 201)
  })
  app.get('/artifacts/:id/:version/:name', c => {
    const { id, version, name } = c.req.param()
    const bytes = store.getArtifact(id, version, name)
    if (!bytes) return c.json({ error: 'not found' }, 404)
    const ext = name.slice(name.lastIndexOf('.'))
    return c.body(bytes as unknown as ArrayBuffer, 200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' })
  })

  app.get('/healthz', c => c.json({ ok: true }))
  return app
}

/** The full live manifest of every MFE, one request. */
export function computeRelease(store: Store, options: Pick<RegistryOptions, 'publicUrl' | 'shellVersion'>): Release {
  const data = store.read()
  const mfes: Record<string, Manifest> = {}
  const base = options.publicUrl?.replace(/\/+$/, '') ?? ''
  for (const id of Object.keys(data.mfes).sort()) {
    const mfe = data.mfes[id]!
    if (!mfe.live) continue
    const stored = mfe.versions[mfe.live]
    if (!stored) continue
    const manifest = structuredClone(stored.manifest)
    const absolute = (url: string) => (/^https?:\/\//.test(url) ? url: base ? new URL(url, `${base}/`).toString(): url)
    manifest.entries.main.url = absolute(manifest.entries.main.url)
    for (const s of manifest.entries.styles) s.url = absolute(s.url)
    mfes[id] = manifest
  }
  const id = createHash('sha256').update(JSON.stringify(mfes)).digest('hex').slice(0, 16)
  return {
    id,
    createdAt: new Date().toISOString(),
    shell: options.shellVersion ?? '0.1.0',
    protocol: PROTOCOL_VERSION,
    capabilities: {...CAPABILITY_VERSIONS },
    mfes,
    // Shared libraries are shell-hosted in this phase; the shell fills these from its own build.
    shared: {},
    importMaps: [],
  }
}

function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return a.localeCompare(b)
}
