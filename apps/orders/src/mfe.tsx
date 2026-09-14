import { createApp } from '@platform/sdk/react/tanstack'
import { Package } from 'lucide-static'
import { z } from 'zod'
import { routeTree } from './routeTree.gen'
import './styles.css'

export default createApp({
  title: 'Orders',
  description: 'Review, approve, and create customer orders.',
  icon: Package,
  basePath: '/orders',
  paths: {
    '/': {},
    '/new': {},
    '/$orderId': { params: z.object({ orderId: z.string() }), search: z.object({ tab: z.enum(['summary', 'invoices']).optional() }) },
  },
  redirects: { '/legacy/$id': '/$id' },
  dependencies: { widgets: [{ id: 'customer-card', contract: 2 }] },
  routeTree,
})
