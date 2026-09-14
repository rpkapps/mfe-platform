import { useMemo } from 'react'

const ICON_LIMIT = 4096

/** Manifest icons are SVG strings the shell sanitises, forces to currentColor and 1em, and inlines. */
export function sanitizeIcon(svg: string | undefined): string | undefined {
  if (!svg || svg.length > ICON_LIMIT) return undefined
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  if (el.nodeName !== 'svg' || doc.querySelector('parsererror')) return undefined
  for (const node of [...el.querySelectorAll('*'), el]) {
    if (['script', 'foreignObject', 'use', 'image', 'a'].includes(node.nodeName)) {
      node.remove()
      continue
    }
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'href' || attr.name === 'xlink:href' || attr.name === 'style') node.removeAttribute(attr.name)
    }
  }
  el.setAttribute('width', '1em')
  el.setAttribute('height', '1em')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('focusable', 'false')
  if (el.getAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', 'currentColor')
  if (el.getAttribute('stroke')) el.setAttribute('stroke', 'currentColor')
  return new XMLSerializer().serializeToString(el)
}

export function Icon({ svg, className }: { svg: string | undefined; className?: string }) {
  const html = useMemo(() => sanitizeIcon(svg), [svg])
  if (!html) return <span className={className} aria-hidden="true" />
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
