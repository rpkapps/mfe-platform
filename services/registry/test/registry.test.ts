import { describe, expect, it } from 'vitest'
import type { AppManifest, WidgetManifest } from '@platform/sdk'
import { createRegistryApp } from '../src/app'
import { createMemoryStore } from '../src/store'

function manifest(id: string, version: string, extra: Partial<AppManifest> = {}): AppManifest {
  return {
    manifest: 1,
    id,
    kind: 'app',
    version,
    protocol: 1,
    title: id,
    basePath: `/${id}`,
    paths: { [`/${id}`]: {} },
    redirects: {},
    capabilities: { navigation: 1 },
    runtime: { framework: 'react', shared: {} },
    entries: { main: { url: `./${id}.entry.js`, integrity: 'sha384-x' }, styles: [] },
    contributions: { releaseNotes: [], actions: [{ id: `${id}.new`, title: 'New', to: `/${id}/new` }] },
    definitions: { pageEvents: [], storage: [] },
    dependencies: { widgets: [], links: [], permissions: [], serverEvents: [] },
    build: { sdk: '0.1.0', builtAt: 'now' },
    ...extra,
  }
}
function widget(id: string, version: string, contract: number): WidgetManifest {
  const { basePath: _b, paths: _p, redirects: _r, ...base } = manifest(id, version)
  return { ...base, kind: 'widget', contract: { version: contract }, props: {}, events: {}, contributions: { releaseNotes: [], actions: [] } }
}

const cert = { suite: 'conformance', sdk: '0.1.0', passed: true, report: {} }

function client(token?: string) {
  const app = createRegistryApp({ store: createMemoryStore(), token, publicUrl: 'http://cdn.test' })
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const call = async (method: string, route: string, body?: unknown, extraHeaders?: Record<string, string>) => {
    const res = await app.request(route, { method, headers: { ...headers, ...extraHeaders }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return { app, call }
}

describe('registry (§19)', () => {
  it('claims, publishes, promotes, and serves a release with absolute artifact URLs', async () => {
    const { call } = client()
    expect((await call('POST', '/mfes', { id: 'orders', owner: { team: 'commerce', repo: 'r' } })).status).toBe(201)
    expect((await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.0.0'), certification: cert })).status).toBe(201)
    expect((await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.0.0'), certification: cert })).status).toBe(409)
    let release = (await call('GET', '/release')).body
    expect(release.mfes).toEqual({})
    expect((await call('PUT', '/mfes/orders/live', { version: '1.0.0' })).body.live).toBe('1.0.0')
    release = (await call('GET', '/release')).body
    expect(release.mfes.orders.entries.main.url).toBe('http://cdn.test/orders.entry.js')
    expect(release.protocol).toBe(1)
    const first = release.id
    expect((await call('PUT', '/mfes/orders/live', { version: null })).body.live).toBeNull()
    expect((await call('GET', '/release')).body.id).not.toBe(first)
    expect((await call('GET', '/mfes/orders')).body.versions).toEqual(['1.0.0'])
  })

  it('rejects unclaimed publishes, foreign ids, uncertified and incompatible promotions', async () => {
    const { call } = client()
    expect((await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.0.0'), certification: cert })).status).toBe(403)
    await call('POST', '/mfes', { id: 'orders', owner: { team: 'commerce', repo: 'r' } })
    const foreign = manifest('orders', '1.0.0', { contributions: { releaseNotes: [], actions: [{ id: 'customers.new', title: 'x', to: '/x' }] } })
    expect((await call('POST', '/mfes/orders/versions', { manifest: foreign, certification: cert })).body.problems[0]).toMatch(/outside/)
    await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.0.0'), certification: { ...cert, passed: false } })
    expect((await call('PUT', '/mfes/orders/live', { version: '1.0.0' })).body.problems[0]).toMatch(/not certified/)
    await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '2.0.0', { capabilities: { storage: 9 } }), certification: cert })
    expect((await call('PUT', '/mfes/orders/live', { version: '2.0.0' })).body.problems[0]).toMatch(/storage@9/)
    expect((await call('PUT', '/mfes/orders/live', { version: '3.0.0' })).body.problems[0]).toMatch(/not published/)
  })

  it('rejects overlapping prefixes, widget contract changes, and withdrawing a widget with consumers', async () => {
    const { call } = client()
    for (const id of ['orders', 'orders-old', 'card']) await call('POST', '/mfes', { id, owner: { team: 't', repo: '' } })
    await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.0.0'), certification: cert })
    await call('PUT', '/mfes/orders/live', { version: '1.0.0' })
    await call('POST', '/mfes/orders-old/versions', { manifest: manifest('orders-old', '1.0.0', { basePath: '/orders/legacy', paths: { '/orders/legacy': {} } }), certification: cert })
    expect((await call('PUT', '/mfes/orders-old/live', { version: '1.0.0' })).body.problems[0]).toMatch(/overlaps/)
    await call('POST', '/mfes/orders-old/versions', { manifest: manifest('orders-old', '1.1.0'), certification: cert })
    expect((await call('PUT', '/mfes/orders-old/live', { version: '1.1.0' })).status).toBe(200)

    await call('POST', '/mfes/card/versions', { manifest: widget('card', '1.0.0', 2), certification: cert })
    await call('PUT', '/mfes/card/live', { version: '1.0.0' })
    await call('POST', '/mfes/card/versions', { manifest: widget('card', '2.0.0', 3), certification: cert })
    expect((await call('PUT', '/mfes/card/live', { version: '2.0.0' })).body.problems[0]).toMatch(/contract from 2 to 3/)
    await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.1.0', { dependencies: { widgets: [{ id: 'card', contract: 2 }], links: [], permissions: [], serverEvents: [] } }), certification: cert })
    await call('PUT', '/mfes/orders/live', { version: '1.1.0' })
    expect((await call('PUT', '/mfes/card/live', { version: null })).body.problems[0]).toMatch(/live consumers: orders/)
    await call('POST', '/mfes/orders/versions', { manifest: manifest('orders', '1.2.0', { dependencies: { widgets: [{ id: 'card', contract: 3 }], links: [], permissions: [], serverEvents: [] } }), certification: cert })
    expect((await call('PUT', '/mfes/orders/live', { version: '1.2.0' })).body.problems[0]).toMatch(/contract 3; the live version provides 2/)
  })

  it('requires the token for writes when configured and stores artifacts', async () => {
    const { call, app } = client('secret')
    const res = await app.request('/mfes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', owner: { team: 't' } }) })
    expect(res.status).toBe(401)
    expect((await call('POST', '/mfes', { id: 'x', owner: { team: 't' } })).status).toBe(201)
    const put = await app.request('/artifacts/x/1.0.0/x.entry.js', { method: 'PUT', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/octet-stream' }, body: 'export default 1' })
    expect(put.status).toBe(201)
    const get = await app.request('/artifacts/x/1.0.0/x.entry.js', { headers: { Origin: 'http://shell.test' } })
    expect(get.headers.get('content-type')).toContain('text/javascript')
    expect(await get.text()).toBe('export default 1')
    expect(get.headers.get('access-control-allow-origin')).toBeTruthy()
  })
})
