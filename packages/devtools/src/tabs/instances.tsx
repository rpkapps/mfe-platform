import { useObserver } from '@platform/sdk/react'
import { Button } from '@tecton/react/components/button'
import { Badge } from '@tecton/react/components/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import type { DevtoolsProps } from '../state'
import { EmptyNote, Mono, StatusBadge } from '../ui'

/** Every app and widget instance the runtime tracks, with the fine-grained lifecycle state. */
export function InstancesTab({ runtime }: DevtoolsProps) {
  useObserver(runtime.instancesChanged)
  useObserver(runtime.actions.changes)
  const runs = runtime.instances()
  const registrations = runtime.actions.registered()
  if (runs.length === 0) return <EmptyNote>No instances.</EmptyNote>
  return (
    <Table aria-label="Instances">
      <TableHeader>
        <TableHead isRowHeader>Instance</TableHead>
        <TableHead>MFE</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>State</TableHead>
        <TableHead>Actions</TableHead>
        <TableHead>Error</TableHead>
        <TableHead> </TableHead>
      </TableHeader>
      <TableBody>
        {runs.map(run => (
          <TableRow key={run.id} id={run.id} data-testid={`devtools.instance.${run.id}`}>
            <TableCell>
              <Mono>{run.id}</Mono>
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-2">
                <Mono>{run.mfeId}</Mono>
                <Badge variant="secondary" appearance="outline">
                  {run.kind}
                </Badge>
              </span>
            </TableCell>
            <TableCell>
              <StatusBadge status={run.status.get()} />
            </TableCell>
            <TableCell>
              <Mono>{run.state.get()}</Mono>
            </TableCell>
            <TableCell>{registrations.filter(r => r.instanceId === run.id).length}</TableCell>
            <TableCell>{run.error ? <span className="text-destructive text-xs">{run.error.code}: {run.error.message}</span> : '—'}</TableCell>
            <TableCell>
              {run.status.get() !== 'unmounted' ? (
                <Button size="xs" variant="outline" onPress={() => void run.unmount()}>
                  Unmount
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
