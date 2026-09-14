import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { execSync } from 'node:child_process'

export interface Project {
  root: string
  id: string
  version: string
  entry: string
  contributions?: string
  frameworkVersion?: string
  sdkVersion: string
  tailwindVersion?: string
  commit?: string
  owner?: { team: string; repo: string }
  registry?: string
}

export function loadProject(root = process.cwd()): Project {
  const pkgPath = path.join(root, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`No package.json in ${root}`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string; mfe?: { entry?: string; contributions?: string; owner?: { team: string; repo: string }; registry?: string } }
  const entry = resolveFirst(root, pkg.mfe?.entry ? [pkg.mfe.entry] : ['src/mfe.tsx', 'src/mfe.ts'])
  if (!entry) throw new Error(`No entry module: expected src/mfe.ts or src/mfe.tsx in ${root}`)
  const contributions = resolveFirst(root, pkg.mfe?.contributions ? [pkg.mfe.contributions] : ['src/contributions.ts', 'src/contributions.tsx'])
  const require = createRequire(path.join(root, 'package.json'))
  const versionOf = (name: string) => {
    try {
      return (require(`${name}/package.json`) as { version: string }).version
    } catch {
      return undefined
    }
  }
  let commit: string | undefined
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    commit = undefined
  }
  const owner = pkg.mfe?.owner ?? (process.env.MFE_OWNER_TEAM ? { team: process.env.MFE_OWNER_TEAM, repo: process.env.MFE_OWNER_REPO ?? '' } : undefined)
  return {
    root,
    id: pkg.name.replace(/^@[^/]+\//, ''),
    version: pkg.version,
    entry,
    contributions: contributions ?? undefined,
    frameworkVersion: versionOf('react'),
    sdkVersion: versionOf('@platform/sdk') ?? '0.0.0',
    tailwindVersion: versionOf('tailwindcss'),
    commit,
    owner,
    registry: pkg.mfe?.registry ?? process.env.PLATFORM_REGISTRY_URL,
  }
}

function resolveFirst(root: string, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const p = path.resolve(root, c)
    if (existsSync(p)) return p
  }
  return undefined
}
