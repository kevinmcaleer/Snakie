import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // The shared first-party feedback app key (issue #206), baked in at BUILD
      // time from the CI/build env so packaged apps can post anonymous bug
      // reports without a user session. The RUNTIME `process.env.SNAKIE_FEEDBACK_KEY`
      // still takes precedence in src/main/feedback/ipc.ts, so
      // `SNAKIE_FEEDBACK_KEY=… npm run dev` keeps overriding this in development.
      // Empty when unset (e.g. contributor builds) — the feedback path just stays
      // authorised-only, exactly as before.
      __SNAKIE_FEEDBACK_KEY__: JSON.stringify(process.env.SNAKIE_FEEDBACK_KEY || '')
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The simulated device runs the MicroPython WASM in a worker_threads
          // worker so a `while True:` can't freeze the main process. It's loaded
          // by filename from out/main, so keep entry names unhashed.
          'mp-node-worker': resolve(__dirname, 'src/main/device/mp-node-worker.ts')
        },
        output: {
          entryFileNames: '[name].js'
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
    // Statically false in the desktop build so the web-only WASM device backend
    // (epic #267) is tree-shaken out — Electron uses the real preload bridge.
    define: {
      'import.meta.env.VITE_SNAKIE_WEB': 'false'
    },
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
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Second entry: the floating Board View window (issue: Board View v2).
          board: resolve(__dirname, 'src/renderer/board.html'),
          // Third entry: the floating Find & Replace window (issue #146).
          find: resolve(__dirname, 'src/renderer/find.html'),
          // Fourth entry: a detached instrument OS window (issue #205).
          instrument: resolve(__dirname, 'src/renderer/instrument.html'),
          // Fifth entry: the detached console (bottom REPL, popped out).
          console: resolve(__dirname, 'src/renderer/console.html')
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
