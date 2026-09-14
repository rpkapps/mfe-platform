import { useEffect, useMemo, useState } from 'react'
import type { Manifest } from '@platform/sdk'
import { useObserver } from '@platform/sdk/react'
import { readDevOverrides, writeDevOverrides, type DevOverrides } from '@platform/sdk/host'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Input } from '@tecton/react/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import { X } from 'lucide-react'
import { DRAFT_KEY, readLocal, writeLocal, type DevtoolsProps } from '../state'
import { Mono, StatusBadge, EmptyNote } from '../ui'

/** MFEs in the release and their per-browser remaps: a manifest URL replaces an entry after a reload. */
export function MfesTab({ runtime, overrides }: DevtoolsProps) {
  useObserver(runtime.instancesChanged)
  const [stored] = useState<DevOverrides>(() => readDevOverrides())
  const [draft, setDraft] = useState<DevOverrides>(() => readDraft() ?? stored)
  useEffect(() => writeLocal(DRAFT_KEY, JSON.stringify(draft) === JSON.stringify(stored) ? null : JSON.stringify(draft)), [draft, stored])
  const [newId, setNewId] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const rows = useMemo(() => {
    const ids = new Set([...Object.keys(runtime.release.mfes), ...Object.keys(draft), ...Object.keys(stored)])
    return [...ids].sort().map(id => ({ id, manifest: runtime.release.mfes[id] as Manifest | undefined }))
  }, [runtime.release.mfes, draft, stored])

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const stateOf = (id: string) => {
    const runs = runtime.instances().filter(r => r.mfeId === id)
    const live = runs.find(r => r.status.get() !== 'unmounted') ?? runs.at(-1)
    return live ? { status: live.status.get(), state: live.state.get() } : undefined
  }
  const setUrl = (id: string, url: string) =>
    setDraft(d => {
      const next = { ...d }
      if (url.trim()) next[id] = { manifestUrl: url.trim() }
      else delete next[id]
      return next
    })
  const apply = () => {
    writeDevOverrides(draft)
    writeLocal(DRAFT_KEY, null)
    location.reload()
  }
  const remove = (id: string) =>
    setDraft(d => {
      const next = { ...d }
      delete next[id]
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onPress={apply} isDisabled={!dirty} data-testid="devtools.overrides.apply">
          Apply and reload
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setDraft(stored)} isDisabled={!dirty}>
          Discard changes
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setDraft({})} isDisabled={Object.keys(draft).length === 0}>
          Clear all overrides
        </Button>
        {dirty ? <Badge variant="warning">unapplied changes</Badge> : null}
        <span className="text-muted-foreground text-xs">An override points an MFE at a manifest.json, typically from `mfe dev`. The page pins one release, so changes apply on reload.</span>
      </div>
      {rows.length === 0 ? <EmptyNote>The release has no MFEs.</EmptyNote> : null}
      <Table aria-label="MFEs">
        <TableHeader>
          <TableHead isRowHeader>MFE</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Entry</TableHead>
          <TableHead>Override (manifest URL)</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(({ id, manifest }) => {
            const s = stateOf(id)
            const applied = overrides?.applied[id]
            const error = overrides?.errors[id]
            return (
              <TableRow key={id} id={id} data-testid={`devtools.mfe.${id}`}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <Mono>{id}</Mono>
                      {manifest ? (
                        <Badge variant="secondary" appearance="outline">
                          {manifest.kind}
                        </Badge>
                      ) : (
                        <Badge variant="warning" appearance="outline">
                          not in release
                        </Badge>
                      )}
                      {applied ? <Badge variant="info">override</Badge> : null}
                    </span>
                    {manifest ? <span className="text-muted-foreground text-xs">{manifest.title}</span> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Mono>{manifest?.version ?? '—'}</Mono>
                </TableCell>
                <TableCell>{s ? <span className="flex items-center gap-1"><StatusBadge status={s.status} /><span className="text-muted-foreground text-xs">{s.state}</span></span> : <span className="text-muted-foreground text-xs">not mounted</span>}</TableCell>
                <TableCell>
                  <Mono title={manifest?.entries.main.url}>{manifest ? shorten(manifest.entries.main.url) : '—'}</Mono>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1">
                      <Input
                        aria-label={`Override for ${id}`}
                        placeholder="http://localhost:4200/manifest.json"
                        value={draft[id]?.manifestUrl ?? ''}
                        onChange={e => setUrl(id, e.target.value)}
                        className="h-7 w-96 font-mono text-xs"
                        data-testid={`devtools.override.${id}`}
                      />
                      {draft[id] || stored[id] ? (
                        <Button size="icon-xs" variant="ghost" aria-label={`Remove override for ${id}`} onPress={() => remove(id)} data-testid={`devtools.override.remove.${id}`}>
                          <X />
                        </Button>
                      ) : null}
                    </span>
                    {error ? <span className="text-destructive text-xs">override failed: {error}; the release entry is used</span> : null}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={e => {
          e.preventDefault()
          if (!newId.trim() || !newUrl.trim()) return
          setUrl(newId.trim(), newUrl)
          setNewId('')
          setNewUrl('')
        }}
      >
        <span className="text-muted-foreground text-xs">Add an MFE that is not in the release:</span>
        <Input aria-label="MFE id" placeholder="mfe id" value={newId} onChange={e => setNewId(e.target.value)} className="h-7 w-40 font-mono text-xs" />
        <Input aria-label="Manifest URL" placeholder="http://localhost:4200/manifest.json" value={newUrl} onChange={e => setNewUrl(e.target.value)} className="h-7 w-96 font-mono text-xs" />
        <Button size="sm" variant="outline" type="submit">
          Add
        </Button>
      </form>
    </div>
  )
}

function readDraft(): DevOverrides | undefined {
  try {
    const raw = readLocal(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as DevOverrides) : undefined
  } catch {
    return undefined
  }
}

function shorten(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname.length > 40 ? `…${u.pathname.slice(-38)}` : u.pathname}`
  } catch {
    return url
  }
}
