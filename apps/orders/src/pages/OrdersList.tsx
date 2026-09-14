import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { usePlatform, usePage } from '@platform/sdk/react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import { Badge } from '@tecton/react/components/badge'
import { LinkButton } from '@tecton/react/components/button'
import { Skeleton } from '@tecton/react/components/skeleton'
import { ordersApi } from '../api'

export function OrdersList() {
  usePage({ title: 'Orders' })
  const platform = usePlatform()
  const api = ordersApi(platform)
  const orders = useQuery({ queryKey: ['orders'], queryFn: ({ signal }) => api.list(signal) })

  return (
    <section className="flex flex-col gap-4" data-testid="orders.list">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-muted-foreground text-sm">Pending orders wait for an approver.</p>
        </div>
        <LinkButton href="/orders/new">New order</LinkButton>
      </header>
      {orders.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : orders.isError ? (
        <p role="alert" className="text-destructive">
          Could not load orders: {orders.error.message}
        </p>
      ) : (
        <Table aria-label="Orders">
          <TableHeader>
            <TableHead isRowHeader>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableHeader>
          <TableBody>
            {orders.data.map(order => (
              <TableRow key={order.id} id={order.id}>
                <TableCell>
                  <Link to="/$orderId" params={{ orderId: order.id }} className="font-medium underline-offset-4 hover:underline">
                    {order.id}
                  </Link>
                </TableCell>
                <TableCell>{order.customer}</TableCell>
                <TableCell>
                  <Badge variant={order.status === 'approved' ? 'success' : order.status === 'rejected' ? 'destructive' : 'secondary'}>{order.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(order.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)
}
