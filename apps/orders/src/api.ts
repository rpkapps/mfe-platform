import type { PlatformClient } from '@platform/sdk'

export interface Order {
  id: string
  customer: string
  total: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export function ordersApi(platform: PlatformClient) {
  const { http } = platform
  return {
    list: (signal?: AbortSignal) => http.get<Order[]>('/api/orders', { signal }).then(o => o ?? []),
    get: (id: string, signal?: AbortSignal) => http.get<Order>(`/api/orders/${encodeURIComponent(id)}`, { signal }),
    approve: (id: string, signal?: AbortSignal) => http.post<Order>(`/api/orders/${encodeURIComponent(id)}/approve`, { signal }),
    reject: (id: string, reason: string, signal?: AbortSignal) => http.post<Order>(`/api/orders/${encodeURIComponent(id)}/reject`, { json: { reason }, signal }),
    remove: (id: string, signal?: AbortSignal) => http.delete(`/api/orders/${encodeURIComponent(id)}`, { signal }),
    create: (input: { customer: string; total: number }, signal?: AbortSignal) => http.post<Order>('/api/orders', { json: input, signal }),
  }
}
