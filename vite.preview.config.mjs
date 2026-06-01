// LOCAL-ONLY preview config (not committed) — serves the renderer in a browser
// so the UI/UX can be reviewed without an Electron window / display.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: 'src/renderer',
  plugins: [
    react(),
    {
      // The renderer ships a strict CSP for Electron; strip it from the
      // dev-served HTML only so Vite's react-refresh preamble can load.
      name: 'strip-csp-for-preview',
      transformIndexHtml(html) {
        return html.replace(
          /<meta[^>]*Content-Security-Policy[^>]*>/i,
          '<!-- CSP stripped for browser preview -->'
        )
      }
    }
  ],
  resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
  server: { host: '0.0.0.0', port: 5174, strictPort: true }
})
