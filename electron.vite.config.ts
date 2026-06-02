import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          // The preload must be CommonJS. package.json has "type": "module", so
          // a `.js` file is treated as ESM and Electron's require() of it fails
          // with ERR_REQUIRE_ESM — emit `.cjs` so Node always loads it as CJS.
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      // Monaco is split into its own lazily-loaded, long-lived cacheable chunk
      // (see EditorArea's React.lazy + the manualChunks below), so the genuine
      // initial chunk is small. Raise the warning limit past Monaco's size so
      // the remaining (expected, on-demand) monaco chunk doesn't trip a noisy
      // warning on every build.
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          manualChunks(id: string) {
            // Pull all of monaco-editor into a single dedicated chunk. It is
            // only imported via the lazy MonacoEditor, so this chunk is fetched
            // on demand and cached independently of app code.
            if (id.includes('node_modules/monaco-editor')) return 'monaco'
            return undefined
          }
        }
      }
    },
    plugins: [react()]
  }
})
