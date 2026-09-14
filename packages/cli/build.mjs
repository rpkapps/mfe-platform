// Bundles the CLI to plain JavaScript so `mfe` runs on any Node without a TypeScript loader.
// Runs on `pnpm install` (prepare) and from scripts/up.mjs.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [path.join(dir, 'src/main.ts')],
  outfile: path.join(dir, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // Workspace TypeScript (@platform/sdk) is bundled in; real packages stay external.
  external: ['vite', '@tailwindcss/vite', '@tanstack/router-plugin', 'tailwindcss', 'postcss', 'zod', 'lightningcss', 'esbuild', 'rollup'],
  logLevel: 'warning',
})
