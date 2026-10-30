import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { embedScope } from './vite-plugin-embed-scope'

const pkgVersion = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version

/**
 * EMBEDDABLE PARTS BUNDLE — snakie#1277 (for kevinmcaleer/kevsrobots.com#254).
 * =============================================================================
 *
 * `npm run build:embed` → `dist-embed/snakie-parts.js` + `snakie-parts.css`: one
 * IIFE exposing `window.SnakieParts` (mountCatalog / mountPartEditor /
 * mountWiring + the parts.yml / robot.yml helpers), with React bundled. Nothing
 * else of the app comes along: the entry imports only those three components,
 * so Blockly, Monaco and the MicroPython WASM stay out. Every stylesheet is
 * scoped under `.snakie-embed` (vite-plugin-embed-scope.ts) so it can share a
 * page with the host's CSS. Part images are the host's: libraries arrive with
 * image URLs, never bundled assets. See docs/embed.md.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // The app's public/ (favicons, board images for the PWA) isn't the embed's.
  publicDir: false,
  define: {
    'import.meta.env.VITE_SNAKIE_WEB': 'true',
    'import.meta.env.VITE_SNAKIE_VERSION': JSON.stringify(pkgVersion),
    // React reads process.env.NODE_ENV; a lib build doesn't replace it for us.
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  css: {
    postcss: { plugins: [embedScope()] }
  },
  build: {
    outDir: resolve(__dirname, 'dist-embed'),
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    lib: {
      entry: resolve(__dirname, 'src/renderer/src/embed/snakie-parts.tsx'),
      name: 'SnakieParts',
      formats: ['iife'],
      fileName: () => 'snakie-parts.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'snakie-parts.css' : 'assets/[name]-[hash][extname]'),
        inlineDynamicImports: true
      }
    }
  },
  plugins: [react()]
})
