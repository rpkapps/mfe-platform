import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { z } from 'zod'
import { createRootRoute, createRoute, Link, Outlet, useParams } from '@tanstack/react-router'
import { createAction } from '../src'
import { createApp, createWidget, useAction, useWidget, usePage, MfeWidget, PlatformLink, usePlatform, useIdentity } from '../src/react'
import { createTestHost, type TestHost } from '../src/testing'

let host: TestHost
afterEach(async () => host && (await host.dispose()))

const approve = createAction({ id: 'orders.approve', title: 'Approve' })

function Card({ customerId, compact }: { customerId: string; compact?: boolean }) {
  const { emit } = useWidget<{ selected: { customerId: string } }>()
  return (
    <button data-testid="card" onClick={() => emit({ event: 'selected', payload: { customerId } })}>
      {compact ? 'c:' : ''}
      {customerId}
    </button>
  )
}

const card = createWidget({
  id: 'customer-card',
  title: 'Customer card',
  contract: { version: 2 },
  props: z.object({ customerId: z.string(), compact: z.boolean().optional() }),
  events: { selected: z.object({ customerId: z.string() }) },
  component: Card,
})

describe('React adapter', () => {
  it('createWidget renders the component, applies updates, and emits typed events', async () => {
    host = createTestHost()
    const instance = await host.mount(card, { props: { customerId: '7' } })
    expect(host.state(instance)).toBe('ready')
    const button = document.querySelector('[data-testid="card"]') as HTMLButtonElement
    expect(button.textContent).toBe('7')
    const run = instance.run.instance as unknown as { update(p: unknown): void }
    await act(async () => run.update({ customerId: '8', compact: true }))
    expect(button.textContent).toBe('c:8')
    await instance.unmount()
    expect(host.leaks()).toEqual([])
    expect(document.querySelector('[data-testid="card"]')).toBeNull()
  })

  it('createApp with a TanStack route tree routes inside the prefix and hands off outside it', async () => {
    host = createTestHost({ definitions: { 'customer-card': card, customers: createApp({ id: 'customers', title: 'Customers', basePath: '/customers', component: () => <p>customers app</p> }) } })
    const selected = vi.fn()
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => {
        usePage({ title: 'Orders list' })
        return (
          <>
            <Link to="/$orderId" params={{ orderId: '1' }} data-testid="to-order">
              order 1
            </Link>
            <PlatformLink to="/customers/$customerId" params={{ customerId: '9' }} data-testid="to-customer">
              customer
            </PlatformLink>
          </>
        )
      },
    })
    const orderRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/$orderId',
      component: function Order() {
        const { orderId } = useParams({ strict: false }) as { orderId: string }
        const identity = useIdentity()
        const a = useAction(approve, { target: { key: orderId, label: `Order ${orderId}` }, enabled: true, run: async () => {} })
        return (
          <>
            <h1 data-testid="heading">
              order {orderId} for {identity?.user.displayName}
            </h1>
            <button data-testid="approve" onClick={() => a.run()} disabled={!a.enabled || a.pending}>
              approve
            </button>
            <MfeWidget id="customer-card" contract={2} props={{ customerId: 'c-' + orderId }} on={{ selected }} />
          </>
        )
      },
    })
    const routeTree = rootRoute.addChildren([listRoute, orderRoute])
    const app = createApp({ id: 'orders', title: 'Orders', basePath: '/orders', routeTree, redirects: { '/legacy/$id': '/$id' } })

    const instance = await host.mount(app)
    await host.settle()
    expect(host.state(instance)).toBe('ready')
    expect(host.page.get().title).toBe('Orders list')

    await act(async () => (document.querySelector('[data-testid="to-order"]') as HTMLAnchorElement).click())
    await host.settle()
    expect(host.navigation.current().pathname).toBe('/orders/1')
    expect(document.querySelector('[data-testid="heading"]')?.textContent).toBe('order 1 for Test User')
    expect(host.actions.state({ id: 'orders.approve' })).toBe('enabled')
    expect(host.actions.registered()[0]?.target).toEqual({ key: '1', label: 'Order 1' })
    await host.settle()
    const cardButton = document.querySelector('[data-testid="card"]') as HTMLButtonElement
    expect(cardButton.textContent).toBe('c-1')
    cardButton.click()
    expect(selected).toHaveBeenCalledWith({ customerId: 'c-1' })

    // Back is within-app; the router follows the platform.
    host.navigation.back()
    await host.settle()
    expect(document.querySelector('[data-testid="to-order"]')).not.toBeNull()

    // A declared redirect is applied through the bridge.
    await host.navigation.navigate({ to: '/orders/legacy/5' })
    await host.settle()
    expect(host.navigation.current().pathname).toBe('/orders/5')
    expect(document.querySelector('[data-testid="heading"]')?.textContent).toContain('order 5')

    host.navigation.back()
    await host.settle()
    await host.settle()
    await act(async () => (document.querySelector('[data-testid="to-customer"]') as HTMLAnchorElement).click())
    await host.settle()
    expect(host.navigation.current().pathname).toBe('/customers/9')
    expect(host.state(instance)).toBe('unmounted')
    expect(document.body.textContent).toContain('customers app')
    expect(host.leaks()).toEqual([])
  })

  it('usePlatform is available in the component escape hatch', async () => {
    host = createTestHost({ permissions: ['g'] })
    const app = createApp({
      id: 'plain',
      title: 'Plain',
      basePath: '/plain',
      component: ({ basePath }) => {
        const platform = usePlatform()
        return (
          <span data-testid="out">
            {basePath}:{String(platform.permissions.can('g'))}
          </span>
        )
      },
    })
    await host.mount(app)
    await host.settle()
    expect(document.querySelector('[data-testid="out"]')?.textContent).toBe('/plain:true')
  })
})
