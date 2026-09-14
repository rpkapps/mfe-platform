import { createApp } from '@platform/sdk/react/tanstack'
import { Users } from 'lucide-static'
import { z } from 'zod'
import { routeTree } from './routeTree.gen'
import './styles.css'

export default createApp({
  title: 'Customers',
  description: 'Customer directory, on React 18.',
  icon: Users,
  basePath: '/customers',
  paths: { '/': {}, '/$customerId': { params: z.object({ customerId: z.string() }) } },
  dependencies: { widgets: [{ id: 'customer-card', contract: 2 }] },
  routeTree,
})
