import { useEffect, useState } from 'react'
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@tecton/react/components/sonner'
import { OrdersList } from './pages/OrdersList'
import { OrderDetails } from './pages/OrderDetails'
import { NewOrder } from './pages/NewOrder'

function Root() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }))
  useEffect(() => () => client.clear(), [client])
  return (
    <QueryClientProvider client={client}>
      <div className="mx-auto max-w-5xl p-6">
        <Outlet />
      </div>
      <Toaster />
    </QueryClientProvider>
  )
}

const rootRoute = createRootRoute({ component: Root })
const listRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OrdersList })
const newRoute = createRoute({ getParentRoute: () => rootRoute, path: '/new', component: NewOrder })
const detailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$orderId',
  validateSearch: (search: Record<string, unknown>) => ({ tab: search.tab === 'invoices' ? ('invoices' as const) : ('summary' as const) }),
  component: function Details() {
    const { orderId } = detailsRoute.useParams()
    const { tab } = detailsRoute.useSearch()
    return <OrderDetails orderId={orderId} tab={tab} />
  },
})

export const routeTree = rootRoute.addChildren([listRoute, newRoute, detailsRoute])
