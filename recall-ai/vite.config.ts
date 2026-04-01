import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: {
          main: 'electron/main.ts',
          'worker-worker': 'src/main/services/worker-worker.ts',
          'brain-worker': 'src/main/services/brain-worker.ts'
        },
        vite: {
          build: {
            rollupOptions: {
              // Native modules must be treated as external —
              // they cannot be bundled by Rollup/Vite
              external: ['better-sqlite3', 'sqlite-vec', 'node-llama-cpp'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ],
})
