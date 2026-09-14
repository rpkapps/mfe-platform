import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp, createWidget, createAction, HttpError, type AppMountContext } from '../src'
import { createTestHost, type TestHost } from '../src/testing'

let host: TestHost
afterEach(async () => host && (await host.dispose()))

function plainApp(id: string, basePath: string, extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    id,
    title: id,
    basePath,
    mount(ctx) {
      ctx.element.textContent = `${id} at ${ctx.initialUrl.pathname}`
      return { unmount: () => {} }
    },...extra,
  })
}

describe('lifecycle', () => {
  it('mounts an app, reports ready, and cleans up without leaks', async () => {
    host = createTestHost()
    const instance = await host.mount(plainApp('orders', '/orders'))
    expect(host.state(instance)).toBe('ready')
    expect(host.elements.content.textContent).toBe('orders at /orders')
    expect(host.elements.content.querySelector('[data-mfe-scope="orders@0"]')).not.toBeNull()
    expect(host.elements.overlays.querySelector('[data-mfe-scope="orders@0"]')).not.toBeNull()
    await instance.unmount()
    expect(host.state(instance)).toBe('unmounted')
    expect(host.leaks()).toEqual([])
    expect(host.elements.content.children.length).toBe(0)
  })

  it('a rejected mount fails the instance and aborts its signal', async () => {
    host = createTestHost()
    const app = createApp({
      id: 'broken',
      title: 'Broken',
      basePath: '/broken',
      mount: () => Promise.reject(new Error('nope')),
    })
    const instance = await host.mount(app)
    expect(host.state(instance)).toBe('failed')
    expect(instance.run.error?.message).toBe('nope')
    expect(host.navigation.view()).toMatchObject({ kind: 'app', status: 'failed' })
  })

  it('a slow ready times out', async () => {
    host = createTestHost({ timeouts: { ready: 20 } })
    const app = createApp({ id: 'slow', title: 'Slow', basePath: '/slow', mount: () => ({ ready: new Promise<void>(() => {}), unmount: () => {} }) })
    const instance = await host.mount(app)
    expect(host.state(instance)).toBe('failed')
    expect(instance.run.error?.code).toBe('core/timeout')
  })

  it('unmount does not wait for cleanup but the test host can', async () => {
    host = createTestHost()
    let resolveCleanup!: () => void
    const app = createApp({ id: 'a', title: 'A', basePath: '/a', mount: () => ({ unmount: () => new Promise<void>(r => (resolveCleanup = r)) }) })
    const instance = await host.mount(app)
    const done = instance.unmount()
    expect(host.state(instance)).toBe('unmounted')
    resolveCleanup()
    await done
  })
})

describe('navigation', () => {
  it('hands off between apps by prefix and keeps the URL on the shell side', async () => {
    host = createTestHost({ definitions: { customers: plainApp('customers', '/customers') } })
    const orders = await host.mount(plainApp('orders', '/orders'))
    const outcome = await host.navigation.navigate({ to: '/customers/$customerId', params: { customerId: '42' }, search: { tab: 'orders' } })
    expect(outcome).toBe('committed')
    expect(host.navigation.current().pathname).toBe('/customers/42')
    expect(host.navigation.current().search).toBe('?tab=orders')
    expect(host.state(orders)).toBe('unmounted')
    await host.settle()
    expect(host.elements.content.textContent).toBe('customers at /customers/42')
    host.navigation.back()
    await host.settle()
    expect(host.elements.content.textContent).toBe('orders at /orders')
  })

  it('an unowned URL shows not-found, a forbidden app shows 403, and group changes re-evaluate', async () => {
    host = createTestHost({ permissions: ['x'], definitions: { secret: plainApp('secret', '/secret', { permissions: ['secret-users'] }) } })
    await host.navigation.navigate({ to: '/nowhere' })
    expect(host.navigation.view()).toMatchObject({ kind: 'not-found' })
    await host.navigation.navigate({ to: '/secret' })
    expect(host.navigation.view()).toMatchObject({ kind: 'forbidden', mfeId: 'secret' })
    host.permissions.set(['secret-users'])
    await host.settle()
    expect(host.navigation.view()).toMatchObject({ kind: 'app', mfeId: 'secret' })
  })

  it('a blocker keeps the user on the page and the bridge sees within-app changes', async () => {
    host = createTestHost({ definitions: { customers: plainApp('customers', '/customers') } })
    const seen: string[] = []
    let stay = true
    const app = createApp({
      id: 'orders',
      title: 'Orders',
      basePath: '/orders',
      mount(ctx: AppMountContext) {
        ctx.router.onNavigate(url => seen.push(url.pathname))
        ctx.platform.navigation.block({ shouldBlock: tx => tx.kind === 'cross-app', prompt: async () => (stay ? 'stay': 'proceed') })
        return { unmount: () => {} }
      },
    })
    const orders = await host.mount(app)
    expect(await host.navigation.navigate({ to: '/orders/123' })).toBe('committed')
    expect(seen).toEqual(['/orders/123'])
    expect(await host.navigation.navigate({ to: '/customers' })).toBe('cancelled')
    expect(host.state(orders)).toBe('ready')
    stay = false
    expect(await host.navigation.navigate({ to: '/customers' })).toBe('committed')
    expect(host.state(orders)).toBe('unmounted')
  })

  it('session expiry shows sign-in and a new session re-enters with a fresh instance', async () => {
    host = createTestHost()
    const first = await host.mount(plainApp('orders', '/orders'))
    host.identity.set(null)
    expect(host.state(first)).toBe('unmounted')
    expect(host.navigation.view()).toMatchObject({ kind: 'signed-out' })
    host.identity.set({ user: { id: 'u2', displayName: 'Two', email: 'two@example.com' }, groups: [] })
    await host.settle()
    const view = host.navigation.view()
    expect(view).toMatchObject({ kind: 'app', mfeId: 'orders', status: 'ready' })
    expect((view as { instanceId: string }).instanceId).not.toBe(first.id)
  })
})

describe('widgets', () => {
  const card = createWidget({
    id: 'customer-card',
    title: 'Customer card',
    contract: { version: 2 },
    props: z.object({ customerId: z.string(), compact: z.boolean().optional() }),
    events: { selected: z.object({ customerId: z.string() }) },
    mount(ctx) {
      let current = ctx.props
      const render = (p: { customerId: string }) => {
        current = p
        ctx.element.textContent = `card ${p.customerId}`
      }
      render(ctx.props)
      ctx.element.addEventListener('click', () => ctx.emit({ event: 'selected', payload: { customerId: current.customerId } }))
      return { update: render, unmount: () => {} }
    },
  })

  it('mounts with validated props, updates, emits validated events, and rejects a contract mismatch', async () => {
    host = createTestHost({ definitions: { 'customer-card': card } })
    const selected = vi.fn()
    let handle!: Awaited<ReturnType<AppMountContext['platform']['widgets']['mount']>>
    let mismatch: unknown
    const app = createApp({
      id: 'orders',
      title: 'Orders',
      basePath: '/orders',
      async mount(ctx) {
        const el = document.createElement('div')
        ctx.element.appendChild(el)
        handle = await ctx.platform.widgets.mount({ id: 'customer-card', contract: 2, element: el, props: { customerId: '1' }, on: { selected } })
        await ctx.platform.widgets.mount({ id: 'customer-card', contract: 1, element: document.createElement('div'), props: {} }).catch(e => (mismatch = e))
        return { unmount: () => {} }
      },
    })
    await host.mount(app)
    await host.settle()
    expect(handle.status.get()).toBe('ready')
    expect(host.elements.content.textContent).toContain('card 1')
    handle.update({ customerId: '2' })
    expect(host.elements.content.textContent).toContain('card 2');(host.elements.content.querySelector('[data-mfe-widget], [data-mfe-scope="customer-card@0"]') as HTMLElement).click()
    expect(selected).toHaveBeenCalledWith({ customerId: '2' })
    expect(mismatch).toMatchObject({ code: 'core/incompatible' })
    await host.mount(card, { props: { customerId: 3 } }).then(i => expect(host.state(i)).toBe('failed'))
  })
})

describe('actions', () => {
  const approve = createAction({ id: 'orders.approve', title: 'Approve', permissions: ['approvers'] })
  const remove = createAction({ id: 'orders.delete', title: 'Delete', effect: 'destructive' })

  it('registers, resolves the sole registration, respects enabled/pending, and confirms destructive actions', async () => {
    host = createTestHost({ permissions: ['approvers'] })
    const run = vi.fn(async () => {})
    let release!: () => void
    const app = createApp({
      id: 'orders',
      title: 'Orders',
      basePath: '/orders',
      mount(ctx) {
        const h = ctx.actions.register({ action: approve, target: { key: '1', label: 'Order 1' }, enabled: false, disabledReason: 'not pending', run })
        ctx.actions.register({ action: remove, run: async () => {} })
        release = () => h.release()
        setTimeout(() => h.update({ enabled: true }), 0)
        return { unmount: () => {} }
      },
    })
    const instance = await host.mount(app)
    expect(host.actions.state({ id: 'orders.approve' })).toEqual({ status: 'disabled', reason: 'not pending' })
    expect(await host.actions.run({ id: 'orders.approve' })).toEqual({ status: 'disabled' })
    await host.settle()
    expect(host.actions.state({ id: 'orders.approve' })).toBe('enabled')
    expect(await host.actions.run({ id: 'orders.approve' })).toEqual({ status: 'completed' })
    expect(run).toHaveBeenCalledOnce()
    expect(await host.actions.run({ id: 'orders.delete', confirm: false })).toEqual({ status: 'cancelled' })
    expect(host.actions.confirmations().at(-1)).toMatchObject({ actionId: 'orders.delete', outcome: 'cancelled' })
    expect(await host.actions.run({ id: 'orders.delete' })).toEqual({ status: 'completed' })
    expect(host.actions.state({ id: 'orders.missing' })).toBe('absent')
    release()
    expect(await host.actions.run({ id: 'orders.approve' })).toEqual({ status: 'unavailable' })
    await instance.unmount()
    expect(host.actions.registered()).toEqual([])
  })

  it('re-supplying equal confirmation text while confirming does not cancel the run', async () => {
    host = createTestHost({ autoConfirm: true })
    const run = vi.fn(async () => {})
    await host.mount(
      createApp({
        id: 'orders',
        title: 'Orders',
        basePath: '/orders',
        mount(ctx) {
          const h = ctx.actions.register({ action: approve, confirmation: { message: 'Approve?' }, run })
          h.status.subscribe(() => h.update({ confirmation: { message: 'Approve?' } }))
          return { unmount: () => {} }
        },
      }),
    )
    host.permissions.set(['approvers'])
    expect(await host.actions.run({ id: 'orders.approve' })).toEqual({ status: 'completed' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('permission failures are disabled, static navigation actions navigate, registering a navigation action throws', async () => {
    host = createTestHost({ permissions: [], definitions: { customers: plainApp('customers', '/customers') } })
    host.release.mfes.customers!.contributions.actions.push({ id: 'customers.new', title: 'New', to: '/customers/new' })
    const nav = createAction({ id: 'orders.new', title: 'New', to: '/orders/new' })
    let thrown: unknown
    await host.mount(
      createApp({
        id: 'orders',
        title: 'Orders',
        basePath: '/orders',
        mount(ctx) {
          ctx.actions.register({ action: approve, run: async () => {} })
          try {
            ctx.actions.register({ action: nav as never, run: async () => {} })
          } catch (e) {
            thrown = e
          }
          return { unmount: () => {} }
        },
      }),
    )
    expect(thrown).toMatchObject({ code: 'actions/static' })
    expect(await host.actions.run({ id: 'orders.approve' })).toEqual({ status: 'disabled' })
    expect(await host.actions.run({ id: 'customers.new' })).toEqual({ status: 'completed' })
    expect(host.navigation.current().pathname).toBe('/customers/new')
  })
})

describe('http', () => {
  it('convenience methods parse JSON, reject non-2xx with HttpError, and fetch returns raw responses', async () => {
    host = createTestHost()
    host.http.mock('/api/orders/1', { id: '1' })
    host.http.mock('/api/orders/2', new Response(null, { status: 404 }))
    host.http.mock('/api/orders/3', new Response(null, { status: 204 }))
    let results: unknown[] = []
    await host.mount(
      createApp({
        id: 'orders',
        title: 'Orders',
        basePath: '/orders',
        async mount(ctx) {
          const { http } = ctx.platform
          results = [
            await http.get('/api/orders/1'),
            await http.get('/api/orders/2').catch(e => e),
            await http.get('/api/orders/3'),
            (await http.fetch('/api/orders/2')).status,
            await http.post('/api/orders/1', { json: { a: 1 } }),
            await http.post('/api/orders/1', { json: {}, body: 'x' } as never).catch(e => e.code),
          ]
          return { unmount: () => {} }
        },
      }),
    )
    expect(results[0]).toEqual({ id: '1' })
    expect(results[1]).toBeInstanceOf(HttpError)
    expect((results[1] as HttpError).status).toBe(404)
    expect(results[2]).toBeNull()
    expect(results[3]).toBe(404)
    expect(results[4]).toEqual({ id: '1' })
    expect(results[5]).toBe('core/invalid-input')
    const post = host.http.calls().find(c => c.method === 'POST')!
    expect(post.headers['content-type']).toBe('application/json')
    expect(post.body).toBe('{"a":1}')
  })

  it('a 401 from an approved destination sends the shell to sign-in and requests die with the instance', async () => {
    host = createTestHost()
    host.http.mock('/api/me', new Response(null, { status: 401 }))
    host.http.mock('/api/slow', () => new Promise<Response>(() => {}))
    let late: Promise<unknown> | undefined
    const instance = await host.mount(
      createApp({
        id: 'orders',
        title: 'Orders',
        basePath: '/orders',
        mount(ctx) {
          late = ctx.platform.http.get('/api/slow').catch(e => e)
          return { unmount: () => {} }
        },
      }),
    )
    await instance.unmount()
    expect(await late).toMatchObject({ name: 'AbortError' })
    let platform!: AppMountContext['platform']
    const again = await host.mount(
      createApp({
        id: 'orders',
        title: 'Orders',
        basePath: '/orders',
        mount(ctx) {
          platform = ctx.platform
          return { unmount: () => {} }
        },
      }),
    )
    expect((await platform.http.fetch('/api/me')).status).toBe(401)
    await host.settle()
    expect(host.navigation.view()).toMatchObject({ kind: 'signed-out' })
    expect(host.state(again)).toBe('unmounted')
  })
})
