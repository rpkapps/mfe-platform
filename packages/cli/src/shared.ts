/** §20 sharing policy: what an MFE bundle leaves to the import map. */
export const SHARED_PREFIXES = ['react', 'react-dom', 'react-aria-components', 'react-aria', '@platform/sdk'] as const

export function isShared(id: string): boolean {
  return SHARED_PREFIXES.some(p => id === p || id.startsWith(`${p}/`))
}

export const FORBIDDEN = ['zone.js', '@microsoft/signalr', '@module-federation/runtime', '@softarc/native-federation'] as const
