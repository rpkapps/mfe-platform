import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAction, usePage, usePlatform, PlatformLink } from '@platform/sdk/react'
import { Button } from '@tecton/react/components/button'
import { Badge } from '@tecton/react/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tecton/react/components/card'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@tecton/react/components/dialog'
import { Textarea } from '@tecton/react/components/textarea'
import { Skeleton } from '@tecton/react/components/skeleton'
import { approve as approveAction, remove as removeAction } from '../contributions'
import { ordersApi } from '../api'
import { formatMoney } from './OrdersList'

export function OrderDetails({ orderId, tab }: { orderId: string; tab: 'summary' | 'invoices' }) {
  usePage({ title: `Order ${orderId}` })
  const platform = usePlatform()
  const api = ordersApi(platform)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const order = useQuery({ queryKey: ['orders', orderId], queryFn: ({ signal }) => api.get(orderId, signal) })
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['orders'] })
  const reject = useMutation({
    mutationFn: () => api.reject(orderId, reason),
    onSuccess: () => {
      setRejecting(false)
      toast.success(`Order ${orderId} rejected`)
      void invalidate()
    },
  })

  // The live half of the static actions: enabled/run come from the data on screen.
  const approve = useAction(approveAction, {
    target: { key: orderId, label: `Order ${orderId}` },
    enabled: order.data?.status === 'pending',
    disabledReason: 'Only pending orders can be approved',
    confirmation: { title: 'Approve order', message: `Approve order ${orderId} for ${order.data?.customer ?? 'this customer'}?`, confirmLabel: 'Approve' },
    run: async ({ signal }) => {
      await api.approve(orderId, signal)
      toast.success(`Order ${orderId} approved`)
      await invalidate()
    },
  })
  const remove = useAction(removeAction, {
    target: { key: orderId, label: `Order ${orderId}` },
    enabled: !!order.data,
    confirmation: { title: 'Delete order', message: `Delete order ${orderId}? This cannot be undone.`, confirmLabel: 'Delete order' },
    run: async ({ signal }) => {
      await api.remove(orderId, signal)
      toast.success(`Order ${orderId} deleted`)
      await invalidate()
      await navigate({ to: '/' })
    },
  })

  if (order.isPending) return <Skeleton className="h-64 w-full" />
  if (order.isError || !order.data)
    return (
      <p role="alert" className="text-destructive">
        Order {orderId} could not be loaded. <Link to="/">Back to orders</Link>
      </p>
    )
  const o = order.data

  return (
    <article className="flex flex-col gap-6" data-testid="orders.details">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link to="/">Orders</Link> / {o.id}
          </p>
          <h1 className="text-2xl font-semibold">Order {o.id}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onPress={() => setRejecting(true)} isDisabled={o.status !== 'pending'}>
            Reject
          </Button>
          <Button onPress={() => void approve.run()} isDisabled={!approve.enabled} isPending={approve.pending}>
            Approve
          </Button>
          <Button variant="destructive" onPress={() => void remove.run()} isDisabled={!remove.enabled} isPending={remove.pending}>
            Delete
          </Button>
        </div>
      </header>

      <nav className="flex gap-4 border-b text-sm">
        <Link to="/$orderId" params={{ orderId }} search={{ tab: 'summary' }} className="border-b-2 py-2 data-[status=active]:border-primary" data-status={tab === 'summary' ? 'active': undefined}>
          Summary
        </Link>
        <Link to="/$orderId" params={{ orderId }} search={{ tab: 'invoices' }} className="border-b-2 py-2 data-[status=active]:border-primary" data-status={tab === 'invoices' ? 'active': undefined}>
          Invoices
        </Link>
      </nav>

      {tab === 'summary' ? (
        <Card>
          <CardHeader>
            <CardTitle>{o.customer}</CardTitle>
            <CardDescription>
              Placed {new Date(o.createdAt).toLocaleDateString()} · <Badge variant={o.status === 'approved' ? 'success': o.status === 'rejected' ? 'destructive': 'secondary'}>{o.status}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-3xl font-semibold tabular-nums">{formatMoney(o.total)}</p>
            <p className="text-muted-foreground text-sm">
              Customer record: <PlatformLink to="/customers/$customerId" params={{ customerId: o.customer.toLowerCase().replace(/\s+/g, '-') }}>open in Customers</PlatformLink> (a cross-app link; the Customers app is not in this release, so the shell shows its 404 page)
            </p>
          </CardContent>
        </Card>
      ): (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>No invoices yet for this order.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Dialog isOpen={rejecting} onOpenChange={setRejecting}>
        <DialogHeader>
          <DialogTitle>Reject order {o.id}</DialogTitle>
        </DialogHeader>
        <Textarea aria-label="Reason" placeholder="Reason for rejection" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onPress={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button onPress={() => reject.mutate()} isPending={reject.isPending} isDisabled={reason.trim().length === 0}>
            Reject order
          </Button>
        </DialogFooter>
      </Dialog>
    </article>
  )
}
