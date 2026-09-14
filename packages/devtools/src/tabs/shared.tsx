import { useEffect, useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tecton/react/components/table'
import { Badge } from '@tecton/react/components/badge'
import type { DevtoolsProps } from '../state'
import { packageOf, readImportMap, shortHash, type ImportMapEntry } from '../state'
import { EmptyNote, Mono } from '../ui'

interface SharedManifest {
  imports: Record<string, { url: string; integrity: string; version?: string }>
}

/** The import map the page loaded with: what every MFE and the shell resolve shared libraries to. */
export function SharedTab({ runtime, sharedManifestUrl }: DevtoolsProps) {
  const [entries, setEntries] = useState<ImportMapEntry[]>(() => readImportMap())
  useEffect(() => {
    if (!sharedManifestUrl) return
    let cancelled = false
    fetch(sharedManifestUrl, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<SharedManifest>) : undefined))
      .then(manifest => {
        if (cancelled || !manifest) return
        setEntries(current => current.map(e => ({ ...e, version: manifest.imports[e.specifier]?.version ?? e.version, integrity: manifest.imports[e.specifier]?.integrity ?? e.integrity })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sharedManifestUrl])

  const declaredBy = useMemo(() => {
    const map = new Map<string, Array<{ id: string; range: string }>>()
    for (const m of Object.values(runtime.release.mfes)) {
      for (const [pkg, range] of Object.entries(m.runtime.shared)) {
        const list = map.get(pkg) ?? []
        list.push({ id: m.id, range })
        map.set(pkg, list)
      }
    }
    return map
  }, [runtime.release.mfes])

  const dev = entries.some(e => e.url.startsWith('/@id/'))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {dev
          ? 'Vite dev server: shared libraries are virtual modules over the one optimized copy; versions come from node_modules.'
          : 'One copy per specifier for the whole page; every MFE bundle leaves these imports to the map.'}
      </p>
      {entries.length === 0 ? <EmptyNote>No import map in the document.</EmptyNote> : null}
      <Table aria-label="Shared libraries">
        <TableHeader>
          <TableHead isRowHeader>Specifier</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Integrity</TableHead>
          <TableHead>Declared by</TableHead>
        </TableHeader>
        <TableBody>
          {entries.map(e => {
            const consumers = declaredBy.get(packageOf(e.specifier)) ?? []
            return (
              <TableRow key={e.specifier} id={e.specifier} data-testid={`devtools.shared.${e.specifier}`}>
                <TableCell>
                  <Mono>{e.specifier}</Mono>
                </TableCell>
                <TableCell>
                  <Mono>{e.version ?? '—'}</Mono>
                </TableCell>
                <TableCell>
                  <Mono title={e.url}>{e.url}</Mono>
                </TableCell>
                <TableCell>
                  <Mono title={e.integrity}>{shortHash(e.integrity)}</Mono>
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
          })}
        </TableBody>
      </Table>
      {Object.keys(runtime.release.shared).length > 0 ? (
        <p className="text-muted-foreground text-xs">Release-provided shared libraries: {Object.keys(runtime.release.shared).join(', ')}</p>
      ) : null}
    </div>
  )
}
