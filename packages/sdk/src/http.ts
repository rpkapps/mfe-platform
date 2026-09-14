/** */
export type HttpReadOptions = Omit<RequestInit, 'method' | 'body'>
export type HttpWriteOptions = Omit<RequestInit, 'method' | 'body'> & ({ json?: unknown; body?: never } | { body?: BodyInit | null; json?: never })

export interface HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  get<T = unknown>(url: string | URL, options?: HttpReadOptions): Promise<T | null>
  post<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  put<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  patch<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  delete<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
}
