import { defineConfig } from 'vitest/config'
export default defineConfig({
  // Tecton is consumed as TSX source from node_modules; transform it with the automatic JSX runtime.
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', include: ['test/**/*.test.tsx'], setupFiles: ['test/setup.ts'], server: { deps: { inline: ['@tecton/react'] } } },
})
