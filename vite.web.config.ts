import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * STANDALONE WEB BUILD of the Snakie renderer — epic #267 (Snakie for Web), Phase W0.
 * =============================================================================
 *
 * The SAME React renderer, built as a plain static SPA for the browser (no
 * Electron shell). It reuses the exact renderer sources; the electron-vite build
 * (`electron.vite.config.ts`) still produces the desktop app unchanged.
 *
 * In the browser there is no preload, so `window.api` is absent — the renderer's
 * `preloadFallback` (already imported in `main.tsx`) installs no-op stubs, so the
 * UI renders and degrades gracefully. Device / file / sim features are INERT until
 * the web backend lands (Phase W1: `web-api.ts` + the MicroPython WASM Worker).
 *
 * Output: `dist-web/` — static assets, deployable to app.snakie.org (see the
 * deploy issue on the epic). `base: '/'` targets a subdomain root; for a subpath
 * (e.g. snakie.org/app) set `base: '/app/'`.
 *
 * Run:  npm run build:web   (or  npm run dev:web  for a live server)
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '/',
  // Statically flag the web build so `main.tsx` installs the WASM device backend.
  define: {
    'import.meta.env.VITE_SNAKIE_WEB': 'true'
  },
  // The sim runs in a module Worker that imports the WASM, so worker bundles need
  // ES format (the default 'iife' can't code-split the dynamic WASM import).
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    // The MicroPython WASM loader (micropython.mjs) uses TOP-LEVEL AWAIT, so the
    // target must allow it (esnext); all Web-Serial-capable Chromium versions do.
    target: 'esnext',
    // Monaco is a big, lazily-loaded, independently-cacheable chunk (mirrors the
    // electron build), so raise the warning limit past its size.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // Only the main app entry for the web MVP. The Electron detached windows
      // (board / find / instrument / console) become in-page panes on the web
      // (Phase W1/dockview), so they are not separate HTML entries here.
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
  plugins: [
    react(),
    {
      // Relax the renderer CSP for the WEB build ONLY (Electron keeps its strict
      // one): `'wasm-unsafe-eval'` lets the MicroPython WASM instantiate, and
      // `font-src data:` lets Vite's inlined fonts load.
      name: 'snakie-web-csp',
      transformIndexHtml(html: string): string {
        return html.replace(
          /content="default-src 'self';[^"]*"/,
          `content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ` +
            `style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
            `font-src 'self' data:; connect-src 'self'"`
        )
      }
    }
  ]
})
