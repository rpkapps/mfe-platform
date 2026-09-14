import { serve } from '@hono/node-server'
import path from 'node:path'
import { createRegistryApp } from './app'
import { createFileStore } from './store'

const port = Number(process.env.PORT ?? 4100)
const dataDir = process.env.REGISTRY_DATA_DIR ?? path.resolve(process.cwd(), 'data')
const publicUrl = process.env.REGISTRY_PUBLIC_URL ?? `http://localhost:${port}`
const app = createRegistryApp({ store: createFileStore(dataDir), token: process.env.REGISTRY_TOKEN, publicUrl, shellVersion: process.env.SHELL_VERSION })

serve({ fetch: app.fetch, port }, info => {
  console.log(`registry listening on http://localhost:${info.port} (data: ${dataDir}${process.env.REGISTRY_TOKEN ? ', writes need REGISTRY_TOKEN' : ', writes open'})`)
})
