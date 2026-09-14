import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { build as esbuild } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin, ViteDevServer, PreviewServer } from 'vite'
import { SHARED_ENTRIES, isSharedLibrary } from '@platform/sdk'

export interface SharedManifest {
  /** The React major these bundles are built for. */
  major: number
  /** Specifier → { url, integrity } */
  imports: Record<string, { url: string; integrity: string; version?: string }>
}

const SHARED_DIR = 'shared'

/**
 * Source of a module that re-exports `specifier` with a stable export list. CommonJS packages (react, react-dom)
 * cannot be `export *`-ed reliably by the bundler, so their named exports are enumerated by requiring them in Node.
 */
export function reexportModuleSource(specifier: string, requireFn: NodeJS.Require, requireAs: string = specifier): string {
  let names: string[] | undefined
  try {
    const mod = requireFn(requireAs) as Record<string, unknown>
    if (mod && typeof mod === 'object' && !(mod as { __esModule?: boolean }).__esModule && !specifier.startsWith('@platform/')) {
      names = Object.keys(mod).filter(k => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default')
    }
  } catch {
    names = undefined
  }
  const lines = [`import * as m from ${JSON.stringify(specifier)}`]
  if (names && names.length > 0) {
    lines.push(`const ns = ((m as { default?: unknown }).default ?? m) as Record<string, unknown>`)
    for (const name of names) lines.push(`export const ${name} = ns[${JSON.stringify(name)}] as never`)
    lines.push('export default ns')
  } else {
    lines.push(`export * from ${JSON.stringify(specifier)}`)
    lines.push('export default (m as { default?: unknown }).default ?? m')
  }
  return `${lines.join('\n')}\n`
}

/** Import-map entries for the dev server: virtual re-export modules so the shell and MFEs share Vite's one optimized copy. */
const virtualPrefix = 'platform-shared:'

/**
 * The shell's platform plugin:
 * - marks shared libraries external in the shell's own build so it uses the import map too;
 * - injects the import map into index.html (from dist/shared/shared.json after `vite build -c vite.shared.config.ts`);
 * - in dev, serves the shared libraries as virtual modules;
 * - serves /platform-env.json from PLATFORM_* environment variables in dev and preview;
 * - serves a sample /api for the pilot app in dev and preview.
 */
export function platformShell(options: { outDir?: string } = {}): Plugin {
  let isBuild = false
  let root = process.cwd()
  return {
    name: 'platform:shell',
    config(_config, env) {
      isBuild = env.command === 'build'
      return {
        build: { rollupOptions: { external: isBuild ? (id: string) => isSharedLibrary(id) && !id.endsWith('.css'): undefined } },
        optimizeDeps: { include: [...SHARED_ENTRIES.filter(e => !e.startsWith('@platform/'))] },
      }
    },
    configResolved(config) {
      root = config.root
    },
    // The shared build runs first into dist/shared and must survive; only the shell's own assets are cleared.
    buildStart() {
      if (!isBuild) return
      const dist = path.resolve(root, options.outDir ?? 'dist')
      rmSync(path.join(dist, 'assets'), { recursive: true, force: true })
      rmSync(path.join(dist, 'index.html'), { force: true })
    },
    resolveId(id) {
      if (id.startsWith(virtualPrefix)) return `\0${id}`
      return null
    },
    load(id) {
      if (!id.startsWith(`\0${virtualPrefix}`)) return null
      const specifier = id.slice(virtualPrefix.length + 1)
      return reexportModuleSource(specifier, createRequire(path.join(root, 'package.json')))
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        // Take the module scripts (and preloads) out: the boot script adds them back after the import map is in place.
        const modules: string[] = []
        html = html.replace(/<script\s+type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>\s*/g, (_m, src: string) => {
          modules.push(src)
          return ''
        })
        html = html.replace(/<link\s+rel="modulepreload"[^>]*>\s*/g, '')
        const config = isBuild
          ? { modules, major: SHELL_REACT_MAJOR, sharedManifests: sharedManifestUrls(path.resolve(root, options.outDir ?? 'dist', SHARED_DIR)) }
          : { modules, major: SHELL_REACT_MAJOR, devShared: devSharedSet() }
        const script = await bundleBootstrap(root, config)
        return { html, tags: [{ tag: 'script', children: script, injectTo: 'body' }] }
      },
    },
    configureServer(server) {
      installMiddleware(server)
    },
    configurePreviewServer(server) {
      installMiddleware(server)
    },
  }
}

const SHELL_REACT_MAJOR = 19

function devSharedSet() {
  const imports: Record<string, { url: string }> = {}
  for (const specifier of SHARED_ENTRIES) imports[specifier] = { url: `/@id/__x00__${virtualPrefix}${specifier}` }
  return { major: SHELL_REACT_MAJOR, imports }
}

/** Every shared.json under dist/shared (the shell's major at the top, others in subdirectories). */
function sharedManifestUrls(sharedDir: string): string[] {
  const urls: string[] = []
  const walk = (dir: string, publicPath: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${publicPath}/${entry.name}`)
      else if (entry.name === 'shared.json') urls.push(`${publicPath}/shared.json`)
    }
  }
  walk(sharedDir, `/${SHARED_DIR}`)
  if (urls.length === 0) throw new Error(`${sharedDir} has no shared.json: run the shared builds first (pnpm --filter @platform/shell build)`)
  return urls
}

let bootstrapCache: { key: string; code: string } | undefined
/** The classic inline boot script, bundled from src/bootstrap.ts with its config baked in. */
async function bundleBootstrap(root: string, config: unknown): Promise<string> {
  const key = JSON.stringify(config)
  if (bootstrapCache?.key === key) return bootstrapCache.code
  const result = await esbuild({
    entryPoints: [path.resolve(root, 'src/bootstrap.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    define: { __BOOT_CONFIG__: key, 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'silent',
  })
  const code = result.outputFiles[0]!.text
  bootstrapCache = { key, code }
  return code
}

function installMiddleware(server: ViteDevServer | PreviewServer) {
  const env = platformEnv()
  const api = createSampleApi()
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/platform-env.json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(env))
      return
    }
    if (url.pathname.startsWith('/api/')) {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => {
        const result = api.handle(req.method ?? 'GET', url.pathname, body)
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(result.body === undefined ? '': JSON.stringify(result.body))
      })
      return
    }
    next()
  })
}

/** One shell image per environment; the values come from the container's environment. */
export function platformEnv(): Record<string, string> {
  const registry = process.env.PLATFORM_REGISTRY_URL ?? 'http://localhost:4100'
  return {
    PLATFORM_ENVIRONMENT: process.env.PLATFORM_ENVIRONMENT ?? 'dev',
    PLATFORM_REGISTRY_URL: registry,
    PLATFORM_CDN_URL: process.env.PLATFORM_CDN_URL ?? registry,
    PLATFORM_API_ORIGINS: process.env.PLATFORM_API_ORIGINS ?? '',
    PLATFORM_HUB_URL: process.env.PLATFORM_HUB_URL ?? '',
    PLATFORM_IDENTITY_URL: process.env.PLATFORM_IDENTITY_URL ?? 'dev',
    PLATFORM_CONFIG_URL: process.env.PLATFORM_CONFIG_URL ?? '',
    PLATFORM_TELEMETRY_URL: process.env.PLATFORM_TELEMETRY_URL ?? '',
  }
}

/** A tiny in-memory orders API so the pilot app has something to talk to. Dev and preview only. */
function createSampleApi() {
  interface Order {
    id: string
    customer: string
    customerId: string
    total: number
    status: 'pending' | 'approved' | 'rejected'
    createdAt: string
  }
  interface Customer {
    id: string
    name: string
    segment: 'enterprise' | 'mid-market' | 'smb'
    country: string
    openOrders: number
  }
  let seq = 1004
  const customers = new Map<string, Customer>([
    ['acme', { id: 'acme', name: 'Acme Corp', segment: 'enterprise', country: 'US', openOrders: 1 }],
    ['globex', { id: 'globex', name: 'Globex', segment: 'mid-market', country: 'DE', openOrders: 0 }],
    ['initech', { id: 'initech', name: 'Initech', segment: 'smb', country: 'UK', openOrders: 1 }],
  ])
  const orders = new Map<string, Order>([
    ['1001', { id: '1001', customer: 'Acme Corp', customerId: 'acme', total: 1280.5, status: 'pending', createdAt: '2026-09-10T09:00:00Z' }],
    ['1002', { id: '1002', customer: 'Globex', customerId: 'globex', total: 310, status: 'approved', createdAt: '2026-09-11T14:30:00Z' }],
    ['1003', { id: '1003', customer: 'Initech', customerId: 'initech', total: 4999.99, status: 'pending', createdAt: '2026-09-12T08:15:00Z' }],
  ])
  const json = (status: number, body?: unknown) => ({ status, body })
  const initial = { orders: structuredClone([...orders.entries()]), customers: structuredClone([...customers.entries()]), seq }
  return {
    handle(method: string, pathname: string, body: string) {
      const parts = pathname.split('/').filter(Boolean) // ['api', 'orders' | 'customers', id?, verb?]
      if (parts[1] === '__reset' && method === 'POST') {
        orders.clear()
        for (const [k, v] of structuredClone(initial.orders)) orders.set(k, v)
        customers.clear()
        for (const [k, v] of structuredClone(initial.customers)) customers.set(k, v)
        seq = initial.seq
        return json(204)
      }
      if (parts[1] === 'customers') {
        if (!parts[2]) return json(200, [...customers.values()])
        const c = customers.get(parts[2])
        return c ? json(200, c) : json(404, { error: `customer ${parts[2]} not found` })
      }
      if (parts[1] !== 'orders') return json(404, { error: 'not found' })
      const id = parts[2]
      const verb = parts[3]
      if (!id) {
        if (method === 'GET') return json(200, [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        if (method === 'POST') {
          const input = JSON.parse(body || '{}') as { customer?: string; total?: number }
          if (!input.customer || typeof input.total !== 'number') return json(400, { error: 'customer and total are required' })
          seq += 1
          const customerId = input.customer.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          if (!customers.has(customerId)) customers.set(customerId, { id: customerId, name: input.customer, segment: 'smb', country: '—', openOrders: 1 })
          const order: Order = { id: String(seq), customer: input.customer, customerId, total: input.total, status: 'pending', createdAt: new Date().toISOString() }
          orders.set(order.id, order)
          return json(201, order)
        }
        return json(405)
      }
      const order = orders.get(id)
      if (!order) return json(404, { error: `order ${id} not found` })
      if (method === 'GET' && !verb) return json(200, order)
      if (method === 'DELETE' && !verb) {
        orders.delete(id)
        return json(204)
      }
      if (method === 'POST' && verb === 'approve') {
        if (order.status !== 'pending') return json(409, { error: 'only pending orders can be approved' })
        order.status = 'approved'
        return json(200, order)
      }
      if (method === 'POST' && verb === 'reject') {
        order.status = 'rejected'
        return json(200, order)
      }
      return json(405)
    },
  }
}

export function integrity(bytes: Uint8Array): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`
}
