import { defineConfig } from 'vite'
import { sharedBuild } from './plugins/shared-build'

// The previous React major, for MFEs built against it: the import map scopes their URL prefix to these bundles.
// The core SDK stays the global singleton; only React, React Aria and the React adapter are per major.
export default defineConfig(
  sharedBuild({
    major: 18,
    outDir: 'dist/shared/react18',
    publicPath: '/shared/react18',
    alias: { react: 'react18', 'react-dom': 'react-dom18' },
    external: ['@platform/sdk', '@platform/sdk/host'],
  }),
)
