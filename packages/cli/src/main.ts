import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from './build'
import { loadProject } from './project'
import { createRegistryClient, publish } from './registry'
import { generateTypes } from './types'

const HELP = `mfe — the MFE platform CLI

  mfe build [--out dist] [--quiet]           bundle, scope CSS, write manifest.json
  mfe publish [--registry URL] [--promote]   upload dist/ and record the version (CI)
  mfe promote <version|null> [--registry]    make a version live, or withdraw the MFE
  mfe init --team NAME [--repo URL]          claim this MFE's id in the registry
  mfe types [--registry URL]                 write platform-registry.d.ts from the release
  mfe inspect                                print the manifest in dist/

Registry URL: --registry, package.json "mfe.registry", or PLATFORM_REGISTRY_URL.
Token: --token or PLATFORM_REGISTRY_TOKEN.`

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)
  const root = process.cwd()
  try {
    switch (command) {
      case 'build':
        await build(root, { outDir: flags.out as string | undefined, quiet: !!flags.quiet })
        return 0
      case 'publish': {
        const project = loadProject(root)
        const manifest = await publish({ dist: path.resolve(root, (flags.out as string) ?? 'dist'), registry: registryUrl(flags, project.registry), token: token(flags), promote: !!flags.promote })
        console.log(`published ${manifest.id}@${manifest.version}${flags.promote ? ' and made it live' : ''}`)
        return 0
      }
      case 'promote': {
        const project = loadProject(root)
        const version = flags._[0]
        if (!version) throw new Error('mfe promote <version|null>')
        await createRegistryClient({ url: registryUrl(flags, project.registry), token: token(flags) }).promote(project.id, version === 'null' ? null : version)
        console.log(`${project.id}: live = ${version}`)
        return 0
      }
      case 'init': {
        const project = loadProject(root)
        if (!flags.team) throw new Error('mfe init --team NAME [--repo URL]')
        await createRegistryClient({ url: registryUrl(flags, project.registry), token: token(flags) }).claim(project.id, { team: String(flags.team), repo: String(flags.repo ?? '') })
        console.log(`claimed ${project.id} for team ${flags.team}`)
        return 0
      }
      case 'types': {
        const project = loadProject(root)
        const file = await generateTypes({ root, registry: registryUrl(flags, project.registry), token: token(flags) })
        console.log(`wrote ${path.relative(root, file)}`)
        return 0
      }
      case 'inspect':
        console.log(readFileSync(path.resolve(root, (flags.out as string) ?? 'dist', 'manifest.json'), 'utf8'))
        return 0
      default:
        console.log(HELP)
        return command === undefined || command === 'help' || command === '--help' ? 0 : 1
    }
  } catch (error) {
    console.error(`mfe ${command}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function registryUrl(flags: Record<string, unknown>, fallback?: string): string {
  const url = (flags.registry as string | undefined) ?? fallback
  if (!url) throw new Error('No registry URL: pass --registry, set package.json "mfe.registry", or PLATFORM_REGISTRY_URL')
  return url
}

function token(flags: Record<string, unknown>): string | undefined {
  return (flags.token as string | undefined) ?? process.env.PLATFORM_REGISTRY_TOKEN
}

function parseFlags(args: string[]): Record<string, unknown> & { _: string[] } {
  const out: Record<string, unknown> & { _: string[] } = { _: [] }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next
        i += 1
      } else out[key] = true
    } else out._.push(a)
  }
  return out
}
