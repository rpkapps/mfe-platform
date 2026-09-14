import { useObserver } from '@platform/sdk/react'
import { Badge } from '@tecton/react/components/badge'
import type { DevtoolsProps } from '../state'
import { relativeTime } from '../state'
import { KeyValue, Mono, Section } from '../ui'

/** The pinned release and the environment the shell booted with. */
export function ReleaseTab({ runtime, env }: DevtoolsProps) {
  const identity = useObserver(runtime.identity)
  const groups = useObserver(runtime.groups)
  const { release } = runtime
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section title="Release">
        <KeyValue
          rows={[
            ['id', <Mono key="id">{release.id}</Mono>],
            ['created', `${relativeTime(release.createdAt)} (${release.createdAt})`],
            ['shell', <Mono key="shell">{release.shell}</Mono>],
            ['protocol', <Mono key="protocol">{String(release.protocol)}</Mono>],
            ['capabilities', <span key="caps" className="flex flex-wrap gap-1">{Object.entries(release.capabilities).map(([k, v]) => <Badge key={k} variant="secondary" appearance="outline">{k}@{v}</Badge>)}</span>],
            ['MFEs', `${Object.keys(release.mfes).length}`],
          ]}
        />
      </Section>
      <Section title="Environment">
        <KeyValue rows={Object.entries(env ?? {}).map(([k, v]) => [k.replace('PLATFORM_', ''), <Mono key={k}>{v || '—'}</Mono>])} />
      </Section>
      <Section title="Session">
        <KeyValue
          rows={[
            ['user', identity ? `${identity.user.displayName} <${identity.user.email}>` : 'signed out'],
            ['groups', groups.length ? <span className="flex flex-wrap gap-1">{groups.map(g => <Badge key={g} variant="secondary" appearance="outline">{g}</Badge>)}</span> : '—'],
            ['expires', identity?.expiresAt ?? '—'],
          ]}
        />
      </Section>
    </div>
  )
}
