import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { standardPartsPlugin } from './vite-plugin-standard-parts'

// The desktop app reads its version from Electron's `app.getVersion()`; the web
// build has no Electron, so inject package.json's version at build time and serve
// it from the web `appVersion()` (install-web-api.ts) so the status bar shows it.
const pkgVersion = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version

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
    'import.meta.env.VITE_SNAKIE_WEB': 'true',
    'import.meta.env.VITE_SNAKIE_VERSION': JSON.stringify(pkgVersion)
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
  // The web sim inlines `micropython/instruments.py` + `snakie.py` via `?raw`, and
  // that folder sits ABOVE the renderer root — allow the dev server to read it.
  server: {
    fs: {
      allow: [resolve(__dirname)]
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
    standardPartsPlugin(),
    // PWA (#464): installable to the ChromeOS shelf + offline via a Workbox
    // precache of the built app shell (incl. the MicroPython WASM). Web build
    // only — the plugin lives here, so the Electron build is untouched.
    // `injectRegister: 'script'` emits an external registerSW.js (no inline
    // script) so it passes the strict web CSP (`script-src 'self' …`).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,wasm}'],
        // The MicroPython WASM + Monaco chunks are large; precache them so the
        // classroom app truly works offline after the first visit.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024
      },
      manifest: {
        name: 'Snakie — MicroPython IDE',
        short_name: 'Snakie',
        description:
          'Write MicroPython, run it on a simulated (or real) board, watch the instruments, and build robots in 3-D — right in your browser.',
        theme_color: '#10b981',
        background_color: '#e7e5df',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    }),
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
