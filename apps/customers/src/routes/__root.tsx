import { useEffect, useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { version } from 'react'

function Root() {
  const [client] = useState(() => new QueryClient())
  useEffect(() => () => client.clear(), [client])
  return (
    <QueryClientProvider client={client}>
      <div className="mx-auto max-w-5xl p-6" data-testid="customers.root" data-react-version={version}>
        <Outlet />
      </div>
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({ component: Root })
