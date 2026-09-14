import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { usePage, usePlatform } from '@platform/sdk/react'
import { Button } from '@tecton/react/components/button'
import { Input } from '@tecton/react/components/input'
import { Label } from '@tecton/react/components/label'
import { ordersApi } from '../api'

export function NewOrder() {
  usePage({ title: 'New order' })
  const platform = usePlatform()
  const api = ordersApi(platform)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [customer, setCustomer] = useState('')
  const [total, setTotal] = useState('')
  const dirty = customer.length > 0 || total.length > 0
  const create = useMutation({
    mutationFn: () => api.create({ customer, total: Number(total) }),
    onSuccess: async order => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success(`Order ${order?.id} created`)
      setCustomer('')
      setTotal('')
      await navigate({ to: '/$orderId', params: { orderId: order!.id }, search: { tab: 'summary' } })
    },
  })

  // The router's own blocker; the adapter bridges it so leaving the app asks too (§26).
  useBlocker({ shouldBlockFn: () => dirty && !create.isSuccess, enableBeforeUnload: dirty })

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      data-testid="orders.new"
      onSubmit={e => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <h1 className="text-2xl font-semibold">New order</h1>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customer">Customer</Label>
        <Input id="customer" value={customer} onChange={e => setCustomer(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="total">Total (USD)</Label>
        <Input id="total" type="number" min="0" step="0.01" value={total} onChange={e => setTotal(e.target.value)} required />
      </div>
      <div className="flex gap-2">
        <Button type="submit" isPending={create.isPending}>
          Create order
        </Button>
        <Button type="button" variant="ghost" onPress={() => void navigate({ to: '/' })}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
