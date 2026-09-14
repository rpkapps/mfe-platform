/** Manifest shortcut syntax (`Mod+Enter`, `Mod+Shift+F`) → Tecton's registry syntax (`mod+enter`, `mod+shift+f`). */
export function toRegistryKeys(shortcut: string): string {
  return shortcut
    .split(/\s+/)
    .map(chord => chord.split('+').map(k => k.trim().toLowerCase()).join('+'))
    .join(' ')
}

const TONES = ['blue', 'azure', 'green', 'lime', 'saffron', 'red', 'pink', 'orchid', 'mauve', 'violet', 'lilac'] as const
export type Tone = (typeof TONES)[number]

/** A stable tile colour per app id. */
export function toneOf(id: string): Tone {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[hash % TONES.length]!
}

/** A two-letter code for the app tile: `orders` → `OR`, `customer-card` → `CC`. */
export function codeOf(id: string): string {
  const parts = id.split(/[-.]/).filter(Boolean)
  return (parts.length > 1 ? parts.map(p => p[0]).join('') : id.slice(0, 2)).toUpperCase().slice(0, 2)
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(p => p[0]!)
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
