import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import path from 'node:path'
import { build } from './build'
import { loadProject } from './project'

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** Serves a directory with the CORS and no-cache headers a shell on another origin needs to load an MFE from it. */
export function serveDist(dir: string, port: number, host = '127.0.0.1') {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = path.join(dir, pathname === '/' ? 'manifest.json' : pathname)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  })
  return new Promise<{ url: string; close(): Promise<void> }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      resolve({ url: `http://localhost:${actualPort}`, close: () => new Promise(r => server.close(() => r())) })
    })
  })
}

/**
 * `mfe dev`: build, serve dist/ with CORS, rebuild on change. Paste the printed manifest URL into the shell's
 * DevTools (MFEs tab) to run this app inside any shell, deployed or local.
 */
export async function dev(root = process.cwd(), options: { port?: number; open?: boolean } = {}) {
  const project = loadProject(root)
  const outDir = path.resolve(root, 'dist')
  const rebuild = async () => {
    const started = Date.now()
    try {
      await build(root, { quiet: true })
      console.log(`${new Date().toLocaleTimeString()} built ${project.id}@${project.version} in ${Date.now() - started} ms`)
    } catch (error) {
      console.error(`build failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await rebuild()
  const server = await serveDist(outDir, options.port ?? 4200)
  console.log(`\n${project.id} is served from ${server.url}\n  manifest: ${server.url}/manifest.json\n  In the shell: enable DevTools (localStorage platform.devtools = "true"), open the MFEs tab, paste the manifest URL for "${project.id}", apply and reload.\n`)

  // Recursive fs.watch works on Windows, macOS, and Linux (Node 20+).
  let timer: NodeJS.Timeout | undefined
  let building = false
  let pending = false
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (building) {
        pending = true
        return
      }
      building = true
      await rebuild()
      building = false
      if (pending) {
        pending = false
        schedule()
      }
    }, 150)
  }
  const watched = [path.join(root, 'src'), path.join(root, 'package.json')].filter(existsSync)
  const watchers = watched.map(target => watch(target, { recursive: statSync(target).isDirectory() }, () => schedule()))
  const stop = async () => {
    watchers.forEach(w => w.close())
    await server.close()
  }
  process.once('SIGINT', () => void stop().then(() => process.exit(0)))
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)))
  return { url: server.url, stop }
}
