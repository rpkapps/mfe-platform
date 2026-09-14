import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { platformShell } from './plugins/platform'

export default defineConfig({
  plugins: [react(), tailwindcss(), platformShell()],
  server: { port: 4000, strictPort: true },
  preview: { port: 4000, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Dist/shared is written by vite.shared.config.ts first; keep it.
    emptyOutDir: false,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
})
