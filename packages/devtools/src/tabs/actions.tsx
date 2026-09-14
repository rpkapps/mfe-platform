import { useObserver } from '@platform/sdk/react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import type { DevtoolsProps } from '../state'
import { EmptyNote, Mono, Section } from '../ui'

/** Live registrations and the static actions the manifests contribute. */
export function ActionsTab({ runtime }: DevtoolsProps) {
  useObserver(runtime.actions.changes)
  const registrations = runtime.actions.registered()
  const statics = Object.values(runtime.release.mfes).flatMap(m => m.contributions.actions)
  return (
    <div className="flex flex-col gap-6">
      <Section title="Live registrations">
        {registrations.length === 0 ? (
          <EmptyNote>No component has registered an action.</EmptyNote>
        ) : (
          <Table aria-label="Registrations">
            <TableHeader>
              <TableHead isRowHeader>Action</TableHead>
              <TableHead>Registration</TableHead>
              <TableHead>Instance</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Error</TableHead>
              <TableHead> </TableHead>
            </TableHeader>
            <TableBody>
              {registrations.map(r => {
                const status = r.status.get()
                return (
                  <TableRow key={r.registrationId} id={r.registrationId} data-testid={`devtools.action.${r.actionId}`}>
                    <TableCell>
                      <Mono>{r.actionId}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono>{r.registrationId}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono>{r.instanceId}</Mono>
                    </TableCell>
                    <TableCell>{r.target ? `${r.target.label} (${r.target.key})` : '—'}</TableCell>
                    <TableCell>{status.enabled ? 'yes' : <span title={r.disabledReason}>no{r.disabledReason ? ` · ${r.disabledReason}` : ''}</span>}</TableCell>
                    <TableCell>{status.pending ? 'yes' : 'no'}</TableCell>
                    <TableCell>{status.error ? <span className="text-destructive text-xs">{status.error.message}</span> : '—'}</TableCell>
                    <TableCell>
                      <Button size="xs" variant="outline" onPress={() => void runtime.actions.run({ id: r.actionId, registrationId: r.registrationId, initiator: 'user' })}>
                        Run
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Static actions (from manifests)">
        {statics.length === 0 ? (
          <EmptyNote>No contributions in the release.</EmptyNote>
        ) : (
          <Table aria-label="Static actions">
            <TableHeader>
              <TableHead isRowHeader>Id</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Placement</TableHead>
              <TableHead>Shortcut</TableHead>
              <TableHead>Navigates to</TableHead>
              <TableHead>Permissions</TableHead>
            </TableHeader>
            <TableBody>
              {statics.map(a => (
                <TableRow key={a.id} id={a.id}>
                  <TableCell>
                    <Mono>{a.id}</Mono>
                  </TableCell>
                  <TableCell>{a.title}</TableCell>
                  <TableCell>
                    <span className="flex gap-1">
                      {(a.placement ?? ['palette']).map(p => (
                        <Badge key={p} variant="secondary" appearance="outline">
                          {p}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>{a.shortcut ?? '—'}</TableCell>
                  <TableCell>{a.to ? <Mono>{a.to}</Mono> : <span className="text-muted-foreground text-xs">live</span>}</TableCell>
                  <TableCell>{a.permissions ? <Mono>{JSON.stringify(a.permissions)}</Mono> : 'everyone'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
