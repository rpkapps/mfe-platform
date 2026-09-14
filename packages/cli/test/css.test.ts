import { describe, expect, it } from 'vitest'
import { scopeCss } from '../src/css'

const input = `
@layer properties, theme, base, components, utilities;
@layer theme { :root, :host { --font-sans: Figtree; --animate-spin: spin 1s linear infinite; } }
@layer base { *, ::before { box-sizing: border-box } body { margin: 0 } }
@layer components {}
@layer utilities { .flex { display: flex } .dark .x { color: red } .animate-spin { animation: var(--animate-spin) } }
:root { --background: white; --tecton-color-bg: #fff }
:root, [data-theme=light], .light { --tecton-color-text: #111 }
.dark { --background: black }
@font-face { font-family: Figtree; src: url(x.woff2) }
@keyframes spin { to { transform: rotate(360deg) } }
@property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000 }
`

describe('scopeCss (§30)', () => {
  const out = scopeCss(input, 'orders@1')

  it('wraps everything in the MFE scope and stops at nested MFEs', () => {
    expect(out).toContain('@scope ([data-mfe-scope="orders@1"]) to ([data-mfe-scope])')
    expect(out).toMatch(/@scope[^{]*\{[\s\S]*\.flex \{[\s\S]*display: flex/)
  })

  it('maps Tailwind layers onto mfe.* and drops the base layer', () => {
    expect(out).toContain('@layer mfe.properties, mfe.theme, mfe.base, mfe.components, mfe.utilities, mfe.overrides;')
    expect(out).toContain('@layer mfe.utilities')
    expect(out).not.toContain('box-sizing')
    expect(out).not.toContain('margin: 0')
  })

  it('keeps Tailwind theme emission on the scope root and drops shell-owned tokens and fonts', () => {
    expect(out).toContain(':scope {')
    expect(out).toContain('--font-sans: Figtree')
    expect(out).not.toContain('--tecton-color-bg')
    expect(out).not.toContain('--tecton-color-text')
    expect(out).not.toContain('--background: black')
    expect(out).not.toContain('@font-face')
  })

  it('hoists keyframes and property registrations out of the scope block', () => {
    const scopeStart = out.indexOf('@scope')
    const scopeEnd = out.lastIndexOf('}')
    const keyframes = out.indexOf('@keyframes spin')
    const property = out.indexOf('@property --tw-shadow')
    expect(keyframes).toBeGreaterThan(scopeStart)
    expect(property).toBeGreaterThan(scopeStart)
    // Both sit after the closing of the @scope block, at the top level.
    const scopeBlockEnd = out.indexOf('\n}', scopeStart)
    expect(keyframes).toBeGreaterThan(scopeBlockEnd)
    expect(property).toBeGreaterThan(scopeBlockEnd)
    expect(scopeEnd).toBeGreaterThan(property)
  })
})
