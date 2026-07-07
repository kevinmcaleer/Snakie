import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Web build target (epic #267). Started in #281/"Web W0" as a structural
 * smoke test of the existing renderer against the (fixed) `preloadFallback`
 * no-op stub; this Phase W1 version (#282) wires up a REAL backend on top of
 * that same seam — MicroPython-in-a-Worker, OPFS/File System Access projects
 * — for classroom Chromebooks where a native app install isn't possible.
 *
 * `web.html` / `web-main.tsx` are a dedicated entry (installs `createWebApi()`
 * then renders the SAME `<App/>` the Electron build uses — no UI fork). Kept
 * as its own HTML/script pair (rather than reusing `index.html`/`main.tsx`,
 * which still boot the inert `preloadFallback` stub) so that Rollup's module
 * graph for `electron.vite.config.ts` never has a static edge into this
 * build's device/worker/OPFS modules — the Electron output stays byte-for-
 * byte unaffected by this whole subsystem.
 *
 * The MicroPython Web Worker (`src/renderer/src/web/device/micropython.worker.ts`)
 * is picked up automatically by Vite's `new URL(..., import.meta.url)` +
 * `new Worker(..., { type: 'module' })` convention (see `WorkerDeviceClient.ts`)
 * — no extra config needed beyond `worker.format: 'es'`, since the worker
 * itself uses static `import`s.
 *
 * Output goes to `out-web/` (kept separate from `electron-vite`'s `out/`, so
 * `npm run build` and `npm run build:web` never clobber each other).
 */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

export default defineConfig({
  root: 'src/renderer',
  // PWA manifest/service worker/icons are web-only — kept out of the shared
  // `src/renderer/public/` dir so they never end up in the Electron build.
  publicDir: resolve(__dirname, 'src/renderer/public-web'),
  define: {
    __SNAKIE_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  worker: {
    format: 'es'
  },
  build: {
    // Emscripten's glue code uses top-level `await` (gated behind a
    // Node-only branch, but esbuild still needs the syntax target to allow
    // it). Classroom Chromebooks are Chromium-only, so `esnext` is safe.
    target: 'esnext',
    outDir: resolve(__dirname, 'out-web'),
    emptyOutDir: true,
    // Monaco is split into its own lazily-loaded, long-lived cacheable chunk
    // (mirrors electron.vite.config.ts's renderer build), so the initial
    // chunk stays small; the WASM interpreter is fetched by the worker, not
    // bundled into any JS chunk.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        web: resolve(__dirname, 'src/renderer/web.html')
      },
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/monaco-editor')) return 'monaco'
          return undefined
        }
      }
    }
  },
  plugins: [react()]
})
