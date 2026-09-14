import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import { SHARED_ENTRIES } from '@platform/sdk'
import { integrity, reexportModuleSource, type SharedManifest } from './platform'

export interface SharedBuildOptions {
  /** The React major this set is built for. */
  major: number
  /** Where the bundles go, under dist/. */
  outDir: string
  /** Public URL prefix of `outDir`. */
  publicPath: string
  /** Package to require/bundle in place of a specifier (`react` → `react18`). */
  alias?: Record<string, string>
  /** Specifiers left to the global import map instead of being bundled (the singleton core). */
  external?: string[]
  entries?: readonly string[]
}

/**
 * One rollup build per React major: `react` is a single chunk that `react-dom`, React Aria and the SDK adapter
 * all import, so every MFE on that major shares one copy. Writes `shared.json` next to the bundles.
 */
export function sharedBuild(options: SharedBuildOptions): UserConfig {
  const require = createRequire(import.meta.url)
  const alias = options.alias ?? {}
  const aliased = (specifier: string) => {
    for (const [from, to] of Object.entries(alias)) {
      if (specifier === from) return to
      if (specifier.startsWith(`${from}/`)) return `${to}${specifier.slice(from.length)}`
    }
    return specifier
  }
  const versionOf = (specifier: string) => {
    const real = aliased(specifier)
    const pkg = real.startsWith('@') ? real.split('/').slice(0, 2).join('/') : real.split('/')[0]!
    try {
      return (require(`${pkg}/package.json`) as { version: string }).version
    } catch {
      return undefined
    }
  }
  const entries = (options.entries ?? SHARED_ENTRIES).filter(e => !(options.external ?? []).includes(e))
  const names = Object.fromEntries(entries.map(specifier => [specifier.replace(/[@/]/g, '_').replace(/^_/, ''), specifier]))

  // Vite resolves lib entries as files, so each entry is a generated re-export module (gitignored).
  const entryDir = path.resolve(import.meta.dirname, '..', `.shared${options.major}`)
  mkdirSync(entryDir, { recursive: true })
  const entryFiles = Object.fromEntries(
    Object.entries(names).map(([name, specifier]) => {
      const file = path.join(entryDir, `${name}.ts`)
      writeFileSync(file, reexportModuleSource(specifier, require, aliased(specifier)))
      return [name, file]
    }),
  )

  const manifestPlugin: Plugin = {
    name: `platform:shared-manifest-${options.major}`,
    writeBundle(output, bundle) {
      const manifest: SharedManifest = { major: options.major, imports: {} }
      for (const [name, specifier] of Object.entries(names)) {
        const chunk = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry && c.name === name)
        if (!chunk || chunk.type !== 'chunk') throw new Error(`No output chunk for shared entry ${specifier}`)
        manifest.imports[specifier] = { url: `${options.publicPath}/${chunk.fileName}`, integrity: integrity(readFileSync(path.join(output.dir!, chunk.fileName))), version: versionOf(specifier) }
      }
      writeFileSync(path.join(output.dir!, 'shared.json'), JSON.stringify(manifest, null, 2))
    },
  }

  return {
    plugins: [manifestPlugin],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      // Aliased packages resolve to their files through Node, so subpaths such as react/jsx-runtime follow the alias too.
      alias: Object.entries(alias).flatMap(([from, to]) => {
        const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
        const customResolver = (source: string) => require.resolve(source)
        return [
          { find: new RegExp(`^${escaped}$`), replacement: to, customResolver },
          { find: new RegExp(`^${escaped}/(.+)$`), replacement: `${to}/$1`, customResolver },
        ]
      }),
    },
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      target: 'es2022',
      minify: true,
      sourcemap: true,
      lib: { entry: entryFiles, formats: ['es'] },
      rollupOptions: {
        external: options.external ?? [],
        output: {
          entryFileNames: chunk => `${chunk.name}@${versionOf(names[chunk.name] ?? '') ?? '0'}-[hash].js`,
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
  }
}
