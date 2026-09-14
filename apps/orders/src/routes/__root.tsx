import { useEffect, useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@tecton/react/components/sonner'

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

export const Route = createRootRoute({ component: Root })
