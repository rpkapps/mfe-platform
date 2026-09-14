import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createAction, createApp, createReleaseNote, createWidget } from '@platform/sdk'
import { createManifest, setZod } from '../src/manifest'
import { schemaToType } from '../src/types'

setZod(await import('zod'))

const info = { id: 'orders', version: '18.4.2', sdk: '0.1.0', shared: { react: '^19' }, entry: { url: './orders.entry.js', bytes: new Uint8Array([1, 2, 3]) } }

describe('createManifest (§18.1)', () => {
  it('derives an app manifest with prefixed ids, absolute paths, and JSON Schema', () => {
    const app = createApp({
      title: 'Orders',
      basePath: '/orders',
      permissions: ['orders-users'],
      paths: { '/$orderId': { params: z.object({ orderId: z.string() }), search: z.object({ tab: z.enum(['summary', 'invoices']).optional() }) } },
      redirects: { '/legacy/$id': '/$id' },
      dependencies: { widgets: [{ id: 'customer-card', contract: 2 }], links: ['/customers/$customerId'] },
      mount: () => ({ unmount() {} }),
    })
    const contributions = {
      approve: createAction({ id: 'approve', title: 'Approve order', permissions: ['orders-approvers'], shortcut: 'Mod+Enter', placement: ['palette', 'page'] }),
      newOrder: createAction({ id: 'new', title: 'Create order', to: '/orders/new' }),
      note: createReleaseNote({ id: '18-4', version: '18.4', date: '2026-09-01', title: 'Bulk approval' }),
      notAContribution: 42,
    }
    const m = createManifest(app, contributions, info)
    expect(m.kind).toBe('app')
    expect(m.id).toBe('orders')
    expect(m.entries.main.integrity).toMatch(/^sha384-/)
    if (m.kind !== 'app') throw new Error()
    expect(Object.keys(m.paths)).toEqual(['/orders/$orderId', '/orders'])
    expect(m.paths['/orders/$orderId']?.params).toMatchObject({ type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] })
    expect(m.paths['/orders/$orderId']?.search).toMatchObject({ properties: { tab: { enum: ['summary', 'invoices'] } } })
    expect(m.contributions.actions.map(a => a.id)).toEqual(['orders.approve', 'orders.new'])
    expect(m.contributions.actions[1]).toMatchObject({ to: '/orders/new' })
    expect(m.contributions.releaseNotes[0]?.id).toBe('orders.18-4')
    expect(m.dependencies.permissions.sort()).toEqual(['orders-approvers', 'orders-users'])
    expect(m.dependencies.widgets).toEqual([{ id: 'customer-card', contract: 2 }])
    expect(m.capabilities).toMatchObject({ navigation: 1, http: 1 })
    expect(m.redirects).toEqual({ '/legacy/$id': '/$id' })
  })

  it('derives a widget manifest and rejects a dotted definition id', () => {
    const w = createWidget({ title: 'Card', contract: { version: 2 }, props: z.object({ customerId: z.string() }), events: { selected: z.object({ customerId: z.string() }) }, mount: () => ({ unmount() {} }) })
    const m = createManifest(w, {}, { ...info, id: 'customer-card' })
    if (m.kind !== 'widget') throw new Error()
    expect(m.contract).toEqual({ version: 2 })
    expect(m.props).toMatchObject({ type: 'object', required: ['customerId'] })
    expect(m.events.selected).toMatchObject({ type: 'object' })
    expect(() => createManifest(w, { bad: createAction({ id: 'a.b', title: 'x' }) }, { ...info, id: 'customer-card' })).toThrow(/dot/)
  })

  it('schemaToType renders params and props', () => {
    expect(schemaToType({ type: 'object', properties: { id: { type: 'string' }, tab: { enum: ['a', 'b'] } }, required: ['id'] })).toBe('{ "id": string; "tab"?: "a" | "b" }')
  })
})
