import { useState } from 'react'
import { useObserver } from '@platform/sdk/react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Input } from '@tecton/react/components/input'
import type { DevtoolsProps } from '../state'
import { EmptyNote, Mono } from '../ui'

/** The runtime's telemetry stream: lifecycle transitions, navigations, actions, errors. */
export function TelemetryTab({ runtime }: DevtoolsProps) {
  useObserver(runtime.telemetry.changes)
  const [filter, setFilter] = useState('')
  const [clearedAt, setClearedAt] = useState<string | undefined>()
  const records = runtime.telemetry
    .records()
    .filter(r => (clearedAt ? r.at > clearedAt : true))
    .filter(r => (filter ? JSON.stringify(r).toLowerCase().includes(filter.toLowerCase()) : true))
    .reverse()
    .slice(0, 300)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input aria-label="Filter" placeholder="filter (type, mfe id, text)" value={filter} onChange={e => setFilter(e.target.value)} className="h-7 w-72 text-xs" />
        <Button size="sm" variant="outline" onPress={() => setClearedAt(new Date().toISOString())}>
          Clear
        </Button>
        <span className="text-muted-foreground text-xs">{records.length} shown</span>
      </div>
      {records.length === 0 ? <EmptyNote>Nothing yet.</EmptyNote> : null}
      <ol className="divide-border flex flex-col divide-y text-xs">
        {records.map((r, i) => {
          const { type, at, ...rest } = r
          return (
            <li key={`${at}-${i}`} className="flex items-start gap-3 py-1">
              <Mono className="text-muted-foreground w-20 shrink-0">{at.slice(11, 23)}</Mono>
              <Badge variant={type.includes('error') || type.includes('failed') ? 'destructive' : 'secondary'} appearance="outline" className="shrink-0">
                {type}
              </Badge>
              <Mono className="text-muted-foreground">{JSON.stringify(rest)}</Mono>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
