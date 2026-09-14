import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build as viteBuild, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import type { Manifest } from '@platform/sdk'
import { scopeToken } from '@platform/sdk'
import { scopeCss } from './css'
import { createManifest, setZod } from './manifest'
import { loadProject, type Project } from './project'
import { FORBIDDEN, isShared } from './shared'

export interface BuildResult {
  outDir: string
  manifest: Manifest
  files: string[]
}

/** `mfe build`: bundle with shared libraries external, scope the CSS, and write the manifest. */
export async function build(root = process.cwd(), options: { outDir?: string; quiet?: boolean } = {}): Promise<BuildResult> {
  const project = loadProject(root)
  const outDir = path.resolve(root, options.outDir ?? 'dist')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const log = options.quiet ? () => {}: (m: string) => console.log(m)

  log(`mfe build ${project.id}@${project.version}`)
  const forbidden: string[] = []
  await viteBuild({
    root,
    configFile: false,
    logLevel: options.quiet ? 'silent': 'warn',
    mode: 'production',
    plugins: [
      tailwindcss(),
      {
        name: 'mfe:policy',
        resolveId(id) {
          if (FORBIDDEN.some(f => id === f || id.startsWith(`${f}/`))) forbidden.push(id)
          return null
        },
      } satisfies Plugin,
    ],
    esbuild: { jsx: 'automatic' },
    // Library builds leave process.env.NODE_ENV to the consumer; an MFE has none, so it is fixed here.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      sourcemap: true,
      cssCodeSplit: false,
      lib: { entry: project.entry, formats: ['es'], fileName: () => `${project.id}.entry.js`, cssFileName: project.id },
      rollupOptions: { external: (id: string) => isShared(id) && !id.endsWith('.css'), output: { inlineDynamicImports: false, chunkFileNames: `${project.id}.[hash].js` }, onwarn: quietWarnings },
    },
  })
  if (forbidden.length) throw new Error(`Forbidden in an MFE bundle: ${[...new Set(forbidden)].join(', ')}`)

  const scope = scopeToken(project.id, project.version)
  const cssPath = path.join(outDir, `${project.id}.css`)
  let styles: { url: string; bytes: Uint8Array; scope: string } | undefined
  if (existsSync(cssPath)) {
    const raw = readFileSync(cssPath, 'utf8')
    if (process.env.MFE_KEEP_RAW_CSS) writeFileSync(path.join(outDir, `${project.id}.raw.css`), raw)
    const scoped = scopeCss(raw, scope)
    writeFileSync(cssPath, scoped)
    styles = { url: `./${project.id}.css`, bytes: Buffer.from(scoped), scope }
  }

  const { definition, contributions } = await evaluateDefinition(project, outDir, options.quiet)
  const entryBytes = readFileSync(path.join(outDir, `${project.id}.entry.js`))
  const manifest = createManifest(definition, contributions, {
    id: project.id,
    version: project.version,
    sdk: project.sdkVersion,
    commit: project.commit,
    frameworkVersion: project.frameworkVersion,
    shared: sharedRanges(project),
    entry: { url: `./${project.id}.entry.js`, bytes: entryBytes },
    styles,
    owner: project.owner,
    tailwind: project.tailwindVersion,
  })
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  rmSync(path.join(outDir, '.manifest'), { recursive: true, force: true })
  const files = [`${project.id}.entry.js`,...(styles ? [`${project.id}.css`]: []), 'manifest.json']
  log(`  ${files.join(', ')} → ${path.relative(root, outDir)}/`)
  return { outDir, manifest, files }
}

/** Contributions are evaluated at build time; nothing from them runs in the browser. */
async function evaluateDefinition(project: Project, outDir: string, quiet?: boolean) {
  const nodeDir = path.join(outDir, '.manifest')
  mkdirSync(nodeDir, { recursive: true })
  const entryFile = path.join(nodeDir, 'entry.ts')
  writeFileSync(
    entryFile,
    `import definition from ${JSON.stringify(project.entry)}\n` +
      (project.contributions ? `import * as contributions from ${JSON.stringify(project.contributions)}\n`: 'const contributions = {}\n') +
      `export { definition, contributions }\n`,
  )
  await viteBuild({
    root: project.root,
    configFile: false,
    logLevel: quiet ? 'silent': 'warn',
    mode: 'production',
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        // Styles are irrelevant to the manifest; keep Tailwind out of the Node build.
        name: 'mfe:css-stub',
        enforce: 'pre',
        resolveId: id => (id.endsWith('.css') ? `\0css-stub:${id}`: null),
        load: id => (id.startsWith('\0css-stub:') ? 'export {}': null),
      } satisfies Plugin,
    ],
    ssr: { noExternal: ['@platform/sdk', '@tecton/react'], target: 'node' },
    build: {
      outDir: nodeDir,
      emptyOutDir: false,
      ssr: entryFile,
      target: 'node22',
      minify: false,
      rollupOptions: { output: { entryFileNames: 'manifest-entry.mjs', format: 'es' }, onwarn: quietWarnings },
    },
  })
  try {
    const zod = await import(pathToFileURL(path.join(project.root, 'node_modules/zod/index.js')).href).catch(() => import('zod'))
    setZod(zod as never)
  } catch {
    setZod(null)
  }
  const mod = (await import(pathToFileURL(path.join(nodeDir, 'manifest-entry.mjs')).href)) as { definition: unknown; contributions: Record<string, unknown> }
  const definition = mod.definition as Parameters<typeof createManifest>[0]
  if (!definition || typeof definition !== 'object' || typeof (definition as { mount?: unknown }).mount !== 'function') {
    throw new Error(`${path.relative(project.root, project.entry)}: default export is not an app or widget definition`)
  }
  return { definition, contributions: mod.contributions ?? {} }
}

const quietWarnings: NonNullable<NonNullable<Parameters<typeof viteBuild>[0]>['build']>['rollupOptions'] extends infer R ? (R extends { onwarn?: infer F } ? NonNullable<F>: never): never = (warning, warn) => {
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || warning.code === 'SOURCEMAP_ERROR' || warning.code === 'INVALID_ANNOTATION') return
  warn(warning)
}

function sharedRanges(project: Project): Record<string, string> {
  const pkg = JSON.parse(readFileSync(path.join(project.root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
  const all = {...(pkg.peerDependencies ?? {}),...(pkg.dependencies ?? {}) }
  const shared: Record<string, string> = {}
  for (const [name, range] of Object.entries(all)) if (isShared(name) && !name.startsWith('@platform/') && !range.startsWith('workspace:')) shared[name] = range
  return shared
}
