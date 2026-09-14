import { useState } from 'react'
import { useObserver } from '@platform/sdk/react'
import { findOwningApp } from '@platform/sdk/host'
import { Button } from '@tecton/react/components/button'
import { Input } from '@tecton/react/components/input'
import type { DevtoolsProps } from '../state'
import { KeyValue, Mono, Section } from '../ui'

/** Where the page is, who owns it, and what the shell is showing. */
export function NavigationTab({ runtime }: DevtoolsProps) {
  const current = useObserver(runtime.current)
  const view = useObserver(runtime.view)
  useObserver(runtime.instancesChanged)
  const owner = findOwningApp(runtime.release.mfes, current.pathname)
  const [target, setTarget] = useState('')
  const { kind, ...details } = view as Record<string, unknown> & { kind: string }
  return (
    <div className="flex flex-col gap-4">
      <Section title="Current">
        <KeyValue
          rows={[
            ['URL', <Mono key="url">{current.href}</Mono>],
            ['owning app', owner ? <Mono key="o">{owner.id} ({owner.basePath})</Mono> : 'none'],
            ['view', <Mono key="v">{kind}</Mono>],
            ['details', <Mono key="d">{JSON.stringify(details, (_k, v) => (v instanceof URL ? v.href : v instanceof Error ? v.message : v))}</Mono>],
            ['blocker active', runtime.blockersActive() ? 'yes' : 'no'],
          ]}
        />
      </Section>
      <Section title="Go">
        <form
          className="flex items-center gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (target.trim()) void runtime.navigateUrl(new URL(target.trim(), current))
          }}
        >
          <Input aria-label="Path" placeholder="/orders/1001" value={target} onChange={e => setTarget(e.target.value)} className="h-7 w-80 font-mono text-xs" />
          <Button size="sm" type="submit">
            Navigate
          </Button>
          <Button size="sm" variant="outline" onPress={() => runtime.back()}>
            Back
          </Button>
          <Button size="sm" variant="outline" onPress={() => runtime.forward()}>
            Forward
          </Button>
        </form>
      </Section>
    </div>
  )
}
