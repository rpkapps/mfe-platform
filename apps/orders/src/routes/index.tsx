import { createFileRoute } from '@tanstack/react-router'
import { OrdersList } from '../pages/OrdersList'

export const Route = createFileRoute('/')({ component: OrdersList })
