import { describe, expect, it } from 'vitest'
import type { Release } from '../src'
import { applyDevOverrides, readDevOverrides, writeDevOverrides } from '../src/host'

const release = { id: 'r', mfes: { orders: { manifest: 1, id: 'orders', version: '1.0.0', entries: { main: { url: 'http://cdn/orders.entry.js', integrity: 'sha384-x' }, styles: [] } } } } as unknown as Release

describe('dev overrides', () => {
  it('replaces the release entry with the manifest at the URL, resolved and without integrity', async () => {
    const fetchImpl = (async (url: string) =>
      new Response(JSON.stringify({ manifest: 1, id: 'orders', version: '1.1.0', entries: { main: { url: './orders.entry.js', integrity: 'sha384-y' }, styles: [{ url: './orders.css', integrity: 'sha384-z', scope: 'orders@1' }] } }), {
        headers: { 'Content-Type': 'application/json' },
        status: url.endsWith('manifest.json') ? 200 : 404,
      })) as unknown as typeof fetch
    const result = await applyDevOverrides(release, { orders: { manifestUrl: 'http://localhost:4200/manifest.json' } }, fetchImpl)
    expect(result.release.mfes.orders?.version).toBe('1.1.0')
    expect(result.release.mfes.orders?.entries.main).toEqual({ url: 'http://localhost:4200/orders.entry.js', integrity: '' })
    expect(result.release.mfes.orders?.entries.styles[0]?.url).toBe('http://localhost:4200/orders.css')
    expect(Object.keys(result.applied)).toEqual(['orders'])
    expect(release.mfes.orders?.version).toBe('1.0.0')
  })

  it('keeps the release entry and reports the error when the manifest cannot be used', async () => {
    const wrongId = async () => new Response(JSON.stringify({ manifest: 1, id: 'customers', entries: { main: { url: 'x' } } }), { status: 200 })
    const result = await applyDevOverrides(release, { orders: { manifestUrl: 'http://localhost:4200/manifest.json' }, missing: { manifestUrl: 'http://nowhere/manifest.json' } }, async (url: RequestInfo | URL) => (String(url).includes('nowhere') ? new Response('', { status: 404 }) : wrongId()))
    expect(result.release.mfes.orders?.version).toBe('1.0.0')
    expect(result.errors.orders).toMatch(/customers/)
    expect(result.errors.missing).toMatch(/404/)
  })

  it('round-trips through storage and ignores junk', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    writeDevOverrides({ orders: { manifestUrl: ' http://localhost:4200/manifest.json ' }, bad: { manifestUrl: '' } as never }, storage)
    expect(readDevOverrides(storage)).toEqual({ orders: { manifestUrl: 'http://localhost:4200/manifest.json' } })
    store.set('platform.devtools.overrides', '{not json')
    expect(readDevOverrides(storage)).toEqual({})
    writeDevOverrides({}, storage)
    expect(store.has('platform.devtools.overrides')).toBe(false)
  })
})
