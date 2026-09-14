import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { serveDist } from '../src/dev'

describe('mfe dev server', () => {
  it('serves dist with CORS and no-cache headers, and refuses paths outside it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfe-dev-'))
    writeFileSync(path.join(dir, 'manifest.json'), '{"manifest":1}')
    writeFileSync(path.join(dir, 'orders.entry.js'), 'export default 1')
    const server = await serveDist(dir, 0)
    try {
      const manifest = await fetch(`${server.url}/manifest.json`)
      expect(manifest.headers.get('access-control-allow-origin')).toBe('*')
      expect(manifest.headers.get('cache-control')).toBe('no-store')
      expect(await manifest.json()).toEqual({ manifest: 1 })
      const entry = await fetch(`${server.url}/orders.entry.js`)
      expect(entry.headers.get('content-type')).toContain('text/javascript')
      expect((await fetch(`${server.url}/`)).status).toBe(200)
      expect((await fetch(`${server.url}/../etc/passwd`)).status).toBe(404)
      expect((await fetch(`${server.url}/missing.js`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
