import type { PlatformClient } from '@platform/sdk'

export interface Customer {
  id: string
  name: string
  segment: 'enterprise' | 'mid-market' | 'smb'
  country: string
  openOrders: number
}

export function customersApi(platform: PlatformClient) {
  return {
    list: (signal?: AbortSignal) => platform.http.get<Customer[]>('/api/customers', { signal }).then(c => c ?? []),
    get: (id: string, signal?: AbortSignal) => platform.http.get<Customer>(`/api/customers/${encodeURIComponent(id)}`, { signal }),
  }
}
