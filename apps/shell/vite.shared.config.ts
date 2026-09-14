import { defineConfig } from 'vite'
import { sharedBuild } from './plugins/shared-build'

// The shell's own React major: the global import map.
export default defineConfig(sharedBuild({ major: 19, outDir: 'dist/shared', publicPath: '/shared' }))
