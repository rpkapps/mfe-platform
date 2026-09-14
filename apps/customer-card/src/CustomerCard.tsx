import { useEffect, useState } from 'react'
import { PlatformLink, usePlatform, useWidget, useIdentity } from '@platform/sdk/react'
import { Button } from '@tecton/react/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tecton/react/components/card'
import { Skeleton } from '@tecton/react/components/skeleton'
import { Popover, PopoverTrigger } from '@tecton/react/components/popover'

export interface Customer {
  id: string
  name: string
  segment: 'enterprise' | 'mid-market' | 'smb'
  country: string
  openOrders: number
}

export function CustomerCard({ customerId, compact }: { customerId: string; compact?: boolean }) {
  const platform = usePlatform()
  const identity = useIdentity()
  const { emit, consumer } = useWidget<{ selected: { customerId: string } }>()
  const [customer, setCustomer] = useState<Customer | null | undefined>()

  useEffect(() => {
    const controller = new AbortController()
    setCustomer(undefined)
    platform.http
      .get<Customer>(`/api/customers/${encodeURIComponent(customerId)}`, { signal: controller.signal })
      .then(setCustomer, () => setCustomer(null))
    return () => controller.abort()
  }, [platform, customerId])

  if (customer === undefined) return <Skeleton className="h-24 w-full" data-testid="customer-card.loading" />
  if (customer === null) return <p className="text-destructive text-sm">Customer {customerId} was not found.</p>

  return (
    <Card data-testid="customer-card" data-compact={compact ? 'true' : undefined} className={compact ? 'py-3' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {customer.name}
          <span className="mfe-badge bg-brand" data-testid="customer-card.badge">
            {customer.segment}
          </span>
        </CardTitle>
        {!compact ? <CardDescription>{customer.country} · {customer.openOrders} open orders · shown to {identity?.user.displayName ?? 'nobody'} inside {consumer.mfeId}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onPress={() => emit({ event: 'selected', payload: { customerId } })} data-testid="customer-card.select">
          Select
        </Button>
        <PopoverTrigger>
          <Button size="sm" variant="ghost" data-testid="customer-card.more">
            More
          </Button>
          <Popover className="p-3 text-sm" data-testid="customer-card.popover">
            A popover from a widget: it lands in the widget's own overlay root, above the app that mounted it.
          </Popover>
        </PopoverTrigger>
        <PlatformLink to="/customers/$customerId" params={{ customerId }} className="text-sm underline underline-offset-4" data-testid="customer-card.open">
          Open in Customers
        </PlatformLink>
      </CardContent>
    </Card>
  )
}
