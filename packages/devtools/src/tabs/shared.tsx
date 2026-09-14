import { useMemo } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import { Badge } from '@tecton/react/components/badge'
import type { DevtoolsProps, ImportMapEntry } from '../state'
import { packageOf, readImportMap, shortHash } from '../state'
import { EmptyNote, Mono, Section } from '../ui'

/** The import map the page loaded with: the shell's React major globally, other majors scoped to each MFE's URL prefix. */
export function SharedTab({ runtime, sharedSets }: DevtoolsProps) {
  const map = useMemo(() => readImportMap(), [])
  const versions = useMemo(() => {
    const byUrl = new Map<string, { version?: string; integrity?: string }>()
    for (const set of sharedSets ?? []) for (const e of Object.values(set.imports)) byUrl.set(e.url, { version: e.version, integrity: e.integrity })
    return byUrl
  }, [sharedSets])
  const declaredBy = useMemo(() => {
    const out = new Map<string, Array<{ id: string; range: string }>>()
    for (const m of Object.values(runtime.release.mfes)) {
      for (const [pkg, range] of Object.entries(m.runtime.shared)) {
        const list = out.get(pkg) ?? []
        list.push({ id: m.id, range })
        out.set(pkg, list)
      }
    }
    return out
  }, [runtime.release.mfes])
  const mfeByPrefix = (prefix: string) => Object.values(runtime.release.mfes).find(m => m.entries.main.url.startsWith(prefix))?.id
  const dev = map.imports.some(e => e.url.startsWith('/@id/'))

  const rows = (entries: ImportMapEntry[], keyPrefix: string) =>
    entries.map(e => {
      const meta = versions.get(e.url)
      const consumers = declaredBy.get(packageOf(e.specifier)) ?? []
      return (
        <TableRow key={`${keyPrefix}${e.specifier}`} id={`${keyPrefix}${e.specifier}`} data-testid={`devtools.shared.${keyPrefix}${e.specifier}`}>
          <TableCell>
            <Mono>{e.specifier}</Mono>
          </TableCell>
          <TableCell>
            <Mono>{meta?.version ?? e.version ?? '—'}</Mono>
          </TableCell>
          <TableCell>
            <Mono title={e.url}>{e.url}</Mono>
          </TableCell>
          <TableCell>
            <Mono title={meta?.integrity ?? e.integrity}>{shortHash(meta?.integrity ?? e.integrity)}</Mono>
          </TableCell>
          <TableCell>
            <span className="flex flex-wrap gap-1">
              {consumers.length === 0 ? <span className="text-muted-foreground text-xs">shell only</span> : null}
              {consumers.map(c => (
                <Badge key={c.id} variant="secondary" appearance="outline" title={`${c.id} declares ${c.range}`}>
                  {c.id} {c.range}
                </Badge>
              ))}
            </span>
          </TableCell>
        </TableRow>
      )
    })
  const table = (entries: ImportMapEntry[], keyPrefix: string, label: string) => (
    <Table aria-label={label}>
      <TableHeader>
        <TableHead isRowHeader>Specifier</TableHead>
        <TableHead>Version</TableHead>
        <TableHead>URL</TableHead>
        <TableHead>Integrity</TableHead>
        <TableHead>Declared by</TableHead>
      </TableHeader>
      <TableBody>{rows(entries, keyPrefix)}</TableBody>
    </Table>
  )

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-xs">
        {dev
          ? 'Vite dev server: shared libraries are virtual modules over the one optimized copy; MFEs on another React major need the built shell.'
          : 'One copy per specifier for the whole page; every MFE bundle leaves these imports to the map. Scopes give MFEs on another React major their own set.'}
      </p>
      <Section title="Global (the shell's React major)">{map.imports.length === 0 ? <EmptyNote>No import map in the document.</EmptyNote> : table(map.imports, '', 'Shared libraries')}</Section>
      {Object.entries(map.scopes).map(([prefix, entries]) => (
        <Section key={prefix} title={`Scope ${mfeByPrefix(prefix) ?? prefix}`}>
          <p className="text-muted-foreground text-xs">
            Modules under <Mono>{prefix}</Mono> resolve these specifiers to another React major.
          </p>
          {table(entries, `${mfeByPrefix(prefix) ?? prefix}:`, `Scoped shared libraries for ${prefix}`)}
        </Section>
      ))}
      {Object.keys(runtime.release.shared).length > 0 ? <p className="text-muted-foreground text-xs">Release-provided shared libraries: {Object.keys(runtime.release.shared).join(', ')}</p> : null}
    </div>
  )
}
