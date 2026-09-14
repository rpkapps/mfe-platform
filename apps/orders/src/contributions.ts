import { createAction, createReleaseNote } from '@platform/sdk'
import { Check, Plus, BookOpen, Trash2 } from 'lucide-static'

// Ids are local; `mfe build` prefixes them with the app id (approve → orders.approve).
export const approve = createAction({
  id: 'approve',
  title: 'Approve order',
  icon: Check,
  permissions: ['orders-approvers'],
  shortcut: 'Mod+Enter',
  placement: ['palette', 'page'],
  description: 'Approves the order currently on screen',
})

export const remove = createAction({
  id: 'delete',
  title: 'Delete order',
  icon: Trash2,
  permissions: ['orders-approvers'],
  effect: 'destructive',
  placement: ['palette', 'page'],
})

export const newOrder = createAction({ id: 'new', title: 'Create order', icon: Plus, to: '/orders/new', shortcut: 'Mod+N', placement: ['palette', 'page'] })

export const guide = createAction({ id: 'guide', title: 'Orders user guide', icon: BookOpen, to: 'https://example.com/docs/orders', placement: ['palette', 'help'] })

export const v100 = createReleaseNote({ id: '1-0', version: '1.0', date: '2026-09-14', title: 'Orders on the platform', body: 'The Orders app now runs in the shell.', to: '/orders' })
