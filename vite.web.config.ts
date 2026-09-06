import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { standardPartsPlugin } from './vite-plugin-standard-parts'
import { webConnectSrc } from './src/renderer/src/web/web-hosts'

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
    'import.meta.env.VITE_SNAKIE_VERSION': JSON.stringify(pkgVersion),
    // Shared feedback app key (same CI secret as the desktop builds) so the web
    // app can post bug reports. Post-only + rate-limited + Cloudflare-fronted on
    // the server, so shipping it in the bundle is an accepted trade-off (#513).
    'import.meta.env.VITE_SNAKIE_FEEDBACK_KEY': JSON.stringify(process.env.SNAKIE_FEEDBACK_KEY || '')
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
      // The main app entry plus the two windows that pop OUT of it in the
      // browser: the Board View (`window.open('board.html')` + a BroadcastChannel
      // relay — src/renderer/src/web/web-board.ts) and a detached instrument
      // (`instrument.html`, which runs on the editor tab's own device — see
      // src/renderer/src/web/web-instruments.ts, #781) and the console
      // (`console.html`, the same bridge for one window — web-console.ts, #810).
      // Find stays an in-page pane on the web.
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        board: resolve(__dirname, 'src/renderer/board.html'),
        instrument: resolve(__dirname, 'src/renderer/instrument.html'),
        console: resolve(__dirname, 'src/renderer/console.html')
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
    // The registration is NOT injected by the plugin; `web-updates.ts` does it,
    // which keeps it out of an inline script the strict CSP would reject
    // (`script-src 'self' …`) just as the old `injectRegister: 'script'` did —
    // see the note on `injectRegister` below for why that value had to go.
    VitePWA({
      registerType: 'autoUpdate',
      // WE register the worker, from `web-updates.ts` (#971). The plugin's own
      // injected script is a bare `navigator.serviceWorker.register(…)` with no
      // update handling at all — and `injectRegister: 'script'`, which we used to
      // set to keep the registration out of an inline script the strict CSP would
      // reject, ALSO silently disables `registerType: 'autoUpdate'`:
      //
      //   // vite-plugin-pwa/dist/index.js
      //   if ((injectRegister === "auto" || injectRegister == null) && registerType === "autoUpdate") {
      //     workbox.skipWaiting = true
      //     workbox.clientsClaim = true
      //   }
      //
      // So the config read as if it auto-updated while the build shipped a worker
      // that waited forever — see the skipWaiting/clientsClaim note below.
      // Registering from app code satisfies the CSP just as well (our bundle IS
      // `'self'`) and lets us react to an update instead of only publishing one.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // BOTH SET EXPLICITLY, not left to the plugin to infer (#971). Without
        // them Workbox emits a worker that calls `skipWaiting()` only when the
        // page posts it a `SKIP_WAITING` message — which nothing did — and never
        // calls `clients.claim()`. A new deploy therefore installed and then sat
        // in `waiting` until every tab of the origin closed, while each
        // navigation kept being answered from the OLD precache. That is the
        // "app.snakie.org needs a hard reload" bug: a hard reload was the one
        // thing that bypassed the worker.
        //
        // `clientsClaim` matters as much as `skipWaiting`: activating without
        // claiming leaves the open page on the previous worker, whose precache
        // the new one has already cleaned up — the classic post-deploy failure
        // to lazy-load a chunk.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,wasm}'],
        // The MicroPython WASM + Monaco chunks are large; precache them so the
        // classroom app truly works offline after the first visit.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // The app is an SPA, so every navigation falls back to `index.html` —
        // but the pop-out windows are REAL pages, and answering their
        // navigation with the shell opens the whole editor inside a 460px
        // instrument window (#781) or a 760px console (#810). They are precached
        // in their own right, so exclude them and let the precache (or the
        // network) serve them.
        navigateFallbackDenylist: [
          /^\/board\.html/,
          /^\/instrument\.html/,
          /^\/console\.html/
        ]
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
      // A version stamp the running page can check itself against (#971).
      // The service worker is the primary "you are stale" signal; this is the
      // fallback for contexts that have no worker (Safari private browsing, a
      // blocked-storage profile) and what lets the notice name the new version.
      // Written by the build so it cannot drift from what actually shipped.
      name: 'snakie-web-version-stamp',
      generateBundle(): void {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkgVersion, builtAt: new Date().toISOString() }, null, 2)
        })
      }
    },
    {
      // Relax the renderer CSP for the WEB build ONLY (Electron keeps its strict
      // one): `'wasm-unsafe-eval'` lets the MicroPython WASM instantiate, and
      // `font-src data:` lets Vite's inlined fonts load. `connect-src` is built
      // from `web-hosts.ts` — the SAME list the install path checks a URL
      // against before fetching it, so the policy and the code cannot drift.
      name: 'snakie-web-csp',
      transformIndexHtml(html: string): string {
        return html.replace(
          /content="default-src 'self';[^"]*"/,
          `content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ` +
            `style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
            `font-src 'self' data:; ${webConnectSrc()}"`
        )
      }
    }
  ]
})
