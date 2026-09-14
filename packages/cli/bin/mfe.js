#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/main.mjs')
if (!existsSync(dist)) {
  console.error('mfe: the CLI is not built; run `pnpm install` (or `node packages/cli/build.mjs`) first')
  process.exit(1)
}
const { main } = await import(dist)
process.exitCode = await main(process.argv.slice(2))
