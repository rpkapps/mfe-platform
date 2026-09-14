import { createAction, createReleaseNote } from '@platform/sdk'
import { Star, BookOpen } from 'lucide-static'

export const favorite = createAction({ id: 'favorite', title: 'Mark customer as favorite', icon: Star, shortcut: 'Mod+Shift+F', placement: ['palette', 'page'], description: 'Stars the customer on screen' })
export const guide = createAction({ id: 'guide', title: 'Customers user guide', icon: BookOpen, to: 'https://example.com/docs/customers', placement: ['help'] })
export const v100 = createReleaseNote({ id: '1-0', version: '1.0', date: '2026-09-14', title: 'Customers on React 18', body: 'The Customers app runs on the previous React major.' })
