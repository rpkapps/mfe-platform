import type { ReactNode } from 'react'
import { Badge } from '@tecton/react/components/badge'
import type { InstanceStatus } from '@platform/sdk'

export function Mono({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <code className={`font-mono text-xs break-all ${className}`} title={title}>
      {children}
    </code>
  )
}

export function StatusBadge({ status }: { status: InstanceStatus | string }) {
  const variant = status === 'ready' ? 'success' : status === 'failed' ? 'destructive' : status === 'unmounted' ? 'secondary' : 'info'
  return (
    <Badge variant={variant} appearance="outline">
      {status}
    </Badge>
  )
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground p-4 text-xs">{children}</p>
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  )
}
