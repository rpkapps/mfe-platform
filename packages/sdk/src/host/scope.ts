import type { Manifest } from '../manifest'
import { PlatformError } from '../errors'
import { withTimeout } from './util'

/** Sequence: insert the scoped CSS link and wait for it (max 2 s), once per scope. */
export function createStyleLoader(doc: Document, resolveUrl: (url: string) => string) {
  const loaded = new Map<string, Promise<void>>()
  return {
    async ensure(manifest: Manifest, signal: AbortSignal): Promise<void> {
      for (const style of manifest.entries.styles) {
        const key = `${style.scope}:${style.url}`
        let p = loaded.get(key)
        if (!p) {
          p = new Promise<void>((resolve, reject) => {
            const link = doc.createElement('link')
            link.rel = 'stylesheet'
            link.href = resolveUrl(style.url)
            if (style.integrity) {
              link.integrity = style.integrity
              link.crossOrigin = 'anonymous'
            }
            link.dataset.mfeScope = style.scope
            link.onload = () => resolve()
            link.onerror = () => reject(new PlatformError('core/network', `Stylesheet failed to load: ${style.url}`))
            doc.head.appendChild(link)
          }).catch(e => {
            loaded.delete(key)
            throw e
          })
          loaded.set(key, p)
        }
        await withTimeout(p, { ms: 2_000, signal, what: `stylesheet ${style.url}` }).catch(e => {
          // A slow stylesheet does not block mounting beyond the cap; a failed one is reported and skipped.
          if (e instanceof PlatformError && e.code === 'core/timeout') return
          throw e
        })
      }
    },
  }
}

export function markScope(element: HTMLElement, scope: string, instanceId: string) {
  element.setAttribute('data-mfe-scope', scope)
  element.setAttribute('data-mfe-instance', instanceId)
}
