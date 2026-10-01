import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve('src/shared'),
  '@core': resolve('src/core')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // native/ML runtimes stay external so their binaries resolve from node_modules
        external: ['onnxruntime-node', '@huggingface/transformers', 'sharp', 'extract-raw-preview', 'exifr', 'fdir', 'xxhash-wasm', 'hono', '@hono/node-server', 'zod', 'electron-updater'],
        input: {
          index: resolve('src/main/index.ts'),
          backend: resolve('src/backend/index.ts'),
          'fusion-worker': resolve('src/core/edit/fusion-worker.ts'),
          'ml-worker': resolve('src/ml/worker.ts'),
          'db-worker': resolve('src/core/db-worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    server: { port: 5199, strictPort: true }
  }
})
