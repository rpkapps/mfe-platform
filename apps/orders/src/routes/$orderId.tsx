import { createFileRoute } from '@tanstack/react-router'
import { OrderDetails } from '../pages/OrderDetails'

export const Route = createFileRoute('/$orderId')({
  validateSearch: (search: Record<string, unknown>) => ({ tab: search.tab === 'invoices' ? ('invoices' as const) : ('summary' as const) }),
  component: function Details() {
    const { orderId } = Route.useParams()
    const { tab } = Route.useSearch()
    return <OrderDetails orderId={orderId} tab={tab} />
  },
})
