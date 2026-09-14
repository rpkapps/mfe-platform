import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { version } from 'react'
import { usePage, usePlatform } from '@platform/sdk/react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import { Skeleton } from '@tecton/react/components/skeleton'
import { customersApi } from '../api'

function CustomersList() {
  usePage({ title: 'Customers' })
  const platform = usePlatform()
  const api = customersApi(platform)
  const customers = useQuery({ queryKey: ['customers'], queryFn: ({ signal }) => api.list(signal) })
  return (
    <section className="flex flex-col gap-4" data-testid="customers.list">
      <header>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-muted-foreground text-sm">
          This app runs on React {version} while the shell and Orders run on React 19. <span className="mfe-badge bg-brand" data-testid="customers.badge">customers</span>
        </p>
      </header>
      {customers.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : customers.isError ? (
        <p role="alert" className="text-destructive">
          Could not load customers: {customers.error.message}
        </p>
      ) : (
        <Table aria-label="Customers">
          <TableHeader>
            <TableHead isRowHeader>Customer</TableHead>
            <TableHead>Segment</TableHead>
            <TableHead>Country</TableHead>
            <TableHead className="text-right">Open orders</TableHead>
          </TableHeader>
          <TableBody>
            {customers.data.map(c => (
              <TableRow key={c.id} id={c.id}>
                <TableCell>
                  <Link to="/$customerId" params={{ customerId: c.id }} className="font-medium underline-offset-4 hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>{c.segment}</TableCell>
                <TableCell>{c.country}</TableCell>
                <TableCell className="text-right tabular-nums">{c.openOrders}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

export const Route = createFileRoute('/')({ component: CustomersList })
