import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Web build target (Snakie for Web, #281/#267 Phase W0 — "the seam").
 *
 * This is a SEPARATE, plain Vite config (not `electron-vite`) that bundles the
 * EXISTING renderer (`src/renderer/**`) as an ordinary browser SPA, with no
 * Electron main/preload processes at all. `src/renderer/src/lib/preloadFallback`
 * (imported for its side effect from `main.tsx`) installs a fully-typed no-op
 * `window.api`/`window.electron` stub when the Electron preload bridge is
 * absent, so the renderer boots against that stub here instead of a real
 * device/backend.
 *
 * Purpose: prove the renderer has no Electron/Node leakage and can build +
 * load standalone — nothing more. It is NOT production-ready, not deployed
 * anywhere (that's #286), and does NOT wire up a real simulated-device backend
 * (the WASM-in-worker sim is #282); it is a structural smoke test only, run via
 * `npm run build:web` / `npm run dev:web`.
 *
 * Only the main `index.html` entry is built. `board.html` / `find.html` /
 * `instrument.html` / `console.html` are Electron-only detached OS windows
 * that relay to the main window over `ipcRenderer` — they have no meaning
 * outside Electron and are intentionally left out of this target.
 *
 * Output goes to `out-web/` (kept separate from `electron-vite`'s `out/`, so
 * `npm run build` and `npm run build:web` never clobber each other).
 */
export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out-web'),
    emptyOutDir: true,
    // Same rationale as electron.vite.config.ts: Monaco is split into its own
    // lazily-loaded chunk, so raise the warning limit past its size.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html')
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
