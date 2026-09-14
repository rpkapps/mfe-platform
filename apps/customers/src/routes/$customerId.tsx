import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MfeWidget, useAction, usePage, usePlatform } from '@platform/sdk/react'
import { Button } from '@tecton/react/components/button'
import { favorite as favoriteAction } from '../contributions'
import { customersApi } from '../api'

function CustomerDetails() {
  const { customerId } = Route.useParams()
  usePage({ title: `Customer ${customerId}` })
  const platform = usePlatform()
  const api = customersApi(platform)
  const customer = useQuery({ queryKey: ['customers', customerId], queryFn: ({ signal }) => api.get(customerId, signal) })
  const [favorite, setFavorite] = useState(false)
  const [selected, setSelected] = useState<string | undefined>()
  const [compact, setCompact] = useState(false)
  const star = useAction(favoriteAction, {
    target: { key: customerId, label: customer.data?.name ?? customerId },
    enabled: !!customer.data && !favorite,
    disabledReason: favorite ? 'Already a favorite' : 'Loading',
    run: async () => setFavorite(true),
  })
  return (
    <article className="flex flex-col gap-6" data-testid="customers.details">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link to="/">Customers</Link> / {customerId}
          </p>
          <h1 className="text-2xl font-semibold">
            {customer.data?.name ?? customerId} {favorite ? '★' : ''}
          </h1>
        </div>
        <Button onPress={() => void star.run()} isDisabled={!star.enabled} isPending={star.pending} data-testid="customers.favorite">
          {favorite ? 'Favorite' : 'Mark as favorite'}
        </Button>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">The customer-card widget (React 19) inside this React 18 app</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} data-testid="customers.compact" /> compact
        </label>
        <div className="max-w-md">
          <MfeWidget id="customer-card" contract={2} props={{ customerId, compact }} on={{ selected: e => setSelected(e.customerId) }} fallback="skeleton" />
        </div>
        <p className="text-muted-foreground text-sm" data-testid="customers.selected">
          {selected ? `Widget selected ${selected}` : 'Nothing selected yet'}
        </p>
      </section>
    </article>
  )
}

export const Route = createFileRoute('/$customerId')({ component: CustomerDetails })
