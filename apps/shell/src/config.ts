/** Build-time options: constants of the shell repository, changed by a shell release. */
export const shellConfig = {
  product: 'Platform',
  version: '0.1.0',
  help: [
    { title: 'Product documentation', href: 'https://example.com/docs' },
    { title: 'Support', href: 'https://example.com/support' },
  ],
  releasePollInterval: 60_000,
  theme: { default: 'light' as 'light' | 'dark' },
  /** Dev identity provider profiles (used when PLATFORM_IDENTITY_URL is `dev`). */
  devProfiles: [
    { id: 'orders-manager', user: { id: 'u-100', displayName: 'Morgan Lee', email: 'morgan@example.com' }, groups: ['orders-users', 'orders-approvers'] },
    { id: 'orders-viewer', user: { id: 'u-101', displayName: 'Sam Park', email: 'sam@example.com' }, groups: ['orders-users'] },
    { id: 'guest', user: { id: 'u-102', displayName: 'Guest', email: 'guest@example.com' }, groups: [] },
  ],
}
