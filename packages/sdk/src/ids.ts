/** §8: the MFE id starts with a letter; later segments (release notes like `orders.18-4`) may start with a digit. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/
export const ID_MAX_LENGTH = 128

export function isValidId(id: string): boolean {
  return id.length <= ID_MAX_LENGTH && ID_PATTERN.test(id)
}

/** A local definition id (no dot) qualified with its owning MFE id: `approve` in `orders` → `orders.approve`. */
export function qualifyId(mfeId: string, localId: string): string {
  if (localId.includes('.')) throw new Error(`Definition id "${localId}" must not contain a dot; it is prefixed with the MFE id`)
  const id = `${mfeId}.${localId}`
  if (!isValidId(id)) throw new Error(`Invalid identifier "${id}"`)
  return id
}

export function isOwnedBy(mfeId: string, id: string): boolean {
  return id === mfeId || id.startsWith(`${mfeId}.`)
}
