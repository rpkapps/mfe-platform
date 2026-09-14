import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { SHARED_ENTRIES } from '@platform/sdk'
import { integrity, reexportModuleSource, type SharedManifest } from './plugins/platform'

/**
 * The shared libraries, one exact version per major, as ES modules the import map points at.
 * One rollup build for all entries so `react` is a single chunk that `react-dom`, RAC and the SDK all import.
 */
const require = createRequire(import.meta.url)
const versionOf = (specifier: string) => {
  const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/'): specifier.split('/')[0]!
  try {
    return (require(`${pkg}/package.json`) as { version: string }).version
  } catch {
    return undefined
  }
}

const entries = Object.fromEntries(SHARED_ENTRIES.map(specifier => [specifier.replace(/[@/]/g, '_').replace(/^_/, ''), specifier]))

// Vite resolves lib entries as files, so each entry is a generated re-export module (gitignored).
const entryDir = path.resolve(import.meta.dirname, '.shared')
mkdirSync(entryDir, { recursive: true })
const entryFiles = Object.fromEntries(
  Object.entries(entries).map(([name, specifier]) => {
    const file = path.join(entryDir, `${name}.ts`)
    writeFileSync(file, reexportModuleSource(specifier, require))
    return [name, file]
  }),
)

function sharedManifest(): Plugin {
  return {
    name: 'platform:shared-manifest',
    writeBundle(options, bundle) {
      const manifest: SharedManifest = { imports: {} }
      for (const [name, specifier] of Object.entries(entries)) {
        const chunk = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry && c.name === name)
        if (!chunk || chunk.type !== 'chunk') throw new Error(`No output chunk for shared entry ${specifier}`)
        const file = path.join(options.dir!, chunk.fileName)
        manifest.imports[specifier] = { url: `/shared/${chunk.fileName}`, integrity: integrity(readFileSync(file)), version: versionOf(specifier) }
      }
      mkdirSync(options.dir!, { recursive: true })
      writeFileSync(path.join(options.dir!, 'shared.json'), JSON.stringify(manifest, null, 2))
    },
  }
}

export default defineConfig({
  plugins: [sharedManifest()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/shared',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: true,
    lib: { entry: entryFiles, formats: ['es'] },
    rollupOptions: {
      output: {
        entryFileNames: chunk => `${chunk.name}@${versionOf(entries[chunk.name] ?? '') ?? '0'}-[hash].js`,
        chunkFileNames: 'chunk-[hash].js',
      },
      // Every entry keeps its exact export shape so the import map can stand in for the package.
      preserveEntrySignatures: 'strict',
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || warning.code === 'SOURCEMAP_ERROR') return
        warn(warning)
      },
    },
  },
})
