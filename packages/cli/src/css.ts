import postcss, { type AtRule, type ChildNode, type Root } from 'postcss'

/**
 * Turns an MFE's Tailwind output into scoped CSS.
 * - Everything is wrapped in `@scope ([data-mfe-scope="<scope>"]) to ([data-mfe-scope])`.
 * - Tailwind layers become `mfe.*`; `@layer base` (preflight, Tecton base rules) is dropped: the shell loads it once.
 * - Shell-owned `:root` / `.dark` theme variables and `@font-face` are dropped; Tailwind's own theme emission
 *   moves to `:scope` so the MFE is self-contained.
 * - `@keyframes` and `@property` are hoisted to the top level (they are not valid inside `@scope`).
 */
export function scopeCss(css: string, scope: string): string {
  const root = postcss.parse(css)
  const hoisted: ChildNode[] = []
  const layerNames: Record<string, string | null> = { properties: 'mfe.properties', theme: 'mfe.theme', base: null, components: 'mfe.components', utilities: 'mfe.utilities' }

  // Hoist global at-rules, drop fonts.
  root.walkAtRules(rule => {
    if (rule.name === 'font-face') rule.remove()
    else if (rule.name === 'keyframes' || rule.name === 'property') {
      hoisted.push(rule.clone())
      rule.remove()
    }
  })

  // Theme layer: Tailwind's `:root,:host` emission becomes the MFE's own scope root.
  root.walkAtRules('layer', layer => {
    if (layer.params.trim() === 'theme') {
      layer.walkRules(rule => {
        if (isRootSelector(rule.selector)) rule.selector = ':scope'
      })
    }
  })
  // Everything else on:root /.dark is the shell's (Tecton tokens and theme).
  root.walkRules(rule => {
    if (rule.parent && rule.parent.type === 'atrule' && (rule.parent as AtRule).name === 'layer' && (rule.parent as AtRule).params.trim() === 'theme') return
    if (isShellOwnedSelector(rule.selector)) rule.remove()
  })

  // Rename layers, drop base, and rewrite the order statement.
  root.walkAtRules('layer', layer => {
    const names = layer.params.split(',').map(s => s.trim()).filter(Boolean)
    if (layer.nodes === undefined) {
      const renamed = names.map(n => layerNames[n] === undefined ? n: layerNames[n]).filter((n): n is string => !!n)
      if (renamed.length === 0) layer.remove()
      else layer.params = renamed.join(', ')
      return
    }
    const name = names[0] ?? ''
    const target = layerNames[name]
    if (target === null) layer.remove()
    else if (target) layer.params = target
  })

  removeEmpty(root)

  const body = root.nodes.filter(n => !(n.type === 'atrule' && (n.name === 'charset' || n.name === 'import' || (n.name === 'layer' && n.nodes === undefined))))
  const imports = root.nodes.filter(n => n.type === 'atrule' && (n.name === 'charset' || n.name === 'import'))
  const scoped = postcss.atRule({ name: 'scope', params: `([data-mfe-scope="${scope}"]) to ([data-mfe-scope])` })
  for (const node of body) scoped.append(node.clone())
  const out = postcss.root()
  for (const n of imports) out.append(n.clone())
  // The full order, whatever Tailwind emitted (minified output drops parts of it); the shell declares the same order.
  out.append(postcss.atRule({ name: 'layer', params: 'mfe.properties, mfe.theme, mfe.base, mfe.components, mfe.utilities, mfe.overrides' }))
  if (scoped.nodes && scoped.nodes.length > 0) out.append(scoped)
  for (const n of hoisted) out.append(n)
  return out.toString()
}

function isRootSelector(selector: string): boolean {
  return /^(:root|:host)(\s*,\s*(:root|:host))*$/.test(selector.trim())
}

/** `:root`, `.dark`, `.light`, `[data-theme=…]` and lists of them: the shell's theme, loaded once. */
function isShellOwnedSelector(selector: string): boolean {
  const parts = selector.split(',').map(s => s.trim())
  return parts.length > 0 && parts.every(p => /^(:root|:host|\.dark|\.light|\[data-theme=[^\]]+\])$/.test(p))
}

function removeEmpty(root: Root) {
  let changed = true
  while (changed) {
    changed = false
    root.walk(node => {
      if ((node.type === 'rule' || node.type === 'atrule') && node.nodes !== undefined && node.nodes.length === 0) {
        node.remove()
        changed = true
      }
    })
  }
}
