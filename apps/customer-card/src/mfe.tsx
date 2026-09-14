import { createWidget } from '@platform/sdk/react'
import { z } from 'zod'
import { CustomerCard } from './CustomerCard'
import './styles.css'

export default createWidget({
  title: 'Customer card',
  description: 'A customer summary with a link to the Customers app.',
  contract: { version: 2 },
  props: z.object({ customerId: z.string(), compact: z.boolean().optional() }),
  events: { selected: z.object({ customerId: z.string() }) },
  component: CustomerCard,
})
