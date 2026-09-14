import { createFileRoute } from '@tanstack/react-router'
import { NewOrder } from '../pages/NewOrder'

export const Route = createFileRoute('/new')({ component: NewOrder })
