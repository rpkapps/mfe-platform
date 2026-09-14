#!/usr/bin/env node
// Runs the whole slice locally:
//   pnpm start        registry → build and publish the apps → build the shell → serve it     (http://localhost:4000)
//   pnpm dev          same, but the shell runs on Vite's dev server with hot reload
//   pnpm start --skip-apps   keep what the registry has; just start the registry and the shell
import { spawn } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const dev = args.has('--dev')
const registryPort = Number(process.env.REGISTRY_PORT ?? 4100)
const registryUrl = `http://localhost:${registryPort}`
const children = []

process.env.PLATFORM_REGISTRY_URL ??= registryUrl
process.env.PLATFORM_CDN_URL ??= registryUrl

// Every tool is run as `node <script>` so this works on Windows too (`pnpm` there is pnpm.cmd, which spawn cannot find).
const node = process.execPath
const bin = (pkgDir, pkg) => {
  const req = createRequire(path.join(root, pkgDir, 'package.json'))
  const manifest = req(`${pkg}/package.json`)
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[pkg]
  return path.join(path.dirname(req.resolve(`${pkg}/package.json`)), entry)
}
const tsx = bin('services/registry', 'tsx')
const vite = bin('apps/shell', 'vite')
const mfe = path.join(root, 'packages/cli/bin/mfe.js')
const cliBuild = path.join(root, 'packages/cli/build.mjs')
const shellDir = path.join(root, 'apps/shell')

const run = (cmd, argv, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: root, stdio: 'inherit', ...opts })
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} exited with ${code}`))))
  })
const start = (name, cmd, argv, opts = {}) => {
  const child = spawn(cmd, argv, { cwd: root, stdio: 'inherit', ...opts })
  child.on('exit', code => {
    if (code !== null && code !== 0) console.error(`${name} exited with ${code}`)
  })
  children.push(child)
  return child
}
const stopAll = () => {
  for (const c of children) c.kill()
}
process.on('SIGINT', () => (stopAll(), process.exit(0)))
process.on('SIGTERM', () => (stopAll(), process.exit(0)))

const waitFor = async (url, ms = 15000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`${url} did not come up`)
}

const step = msg => console.log(`\n▶ ${msg}`)

try {
  step(`registry on ${registryUrl}`)
  start('registry', node, [tsx, 'src/server.ts'], { cwd: path.join(root, 'services/registry'), env: { ...process.env, PORT: String(registryPort) } })
  await waitFor(`${registryUrl}/healthz`)

  if (!args.has('--skip-apps')) {
    // Every workspace app with an `mfe` field is an MFE: build, claim its id, publish, make it live.
    const appsDir = path.join(root, 'apps')
    const mfeApps = readdirSync(appsDir).filter(name => {
      const pkg = path.join(appsDir, name, 'package.json')
      return existsSync(pkg) && 'mfe' in JSON.parse(readFileSync(pkg, 'utf8'))
    })
    step('mfe CLI: build')
    await run(node, [cliBuild])
    for (const name of mfeApps) {
      const cwd = path.join(appsDir, name)
      const { mfe: meta } = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'))
      step(`${name}: build`)
      await run(node, [mfe, 'build', '--quiet'], { cwd })
      step(`${name}: publish and make live`)
      await run(node, [mfe, 'init', '--team', meta.owner?.team ?? 'local', '--repo', meta.owner?.repo ?? '', '--registry', registryUrl], { cwd })
      await run(node, [mfe, 'publish', '--promote', '--replace', '--registry', registryUrl], { cwd })
    }
  }

  if (dev) {
    step('shell (Vite dev server) on http://localhost:4000')
    start('shell', node, [vite, '--configLoader', 'runner'], { cwd: shellDir })
  } else {
    step('shell: build')
    // One shared-library set per React major, then the shell itself (same as the shell's build script).
    await run(node, [vite, 'build', '--configLoader', 'runner', '-c', 'vite.shared.config.ts'], { cwd: shellDir })
    await run(node, [vite, 'build', '--configLoader', 'runner', '-c', 'vite.shared18.config.ts'], { cwd: shellDir })
    await run(node, [vite, 'build', '--configLoader', 'runner'], { cwd: shellDir })
    step('shell on http://localhost:4000')
    start('shell', node, [vite, 'preview', '--configLoader', 'runner'], { cwd: shellDir })
  }
  await waitFor('http://localhost:4000/platform-env.json')
  console.log('\n✔ ready: http://localhost:4000/orders   (Ctrl+C stops everything)\n')
} catch (error) {
  console.error(error.message)
  stopAll()
  process.exit(1)
}
