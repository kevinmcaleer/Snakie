// FIRST: URL params, private storage and the skin — before any store loads.
import './code-embed/embed-boot'
import './lib/preloadFallback'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import './index.css'
import { EmbedApp } from './code-embed/EmbedApp'

/**
 * THE CODE EMBED'S ENTRY (#1286, epic #1285) — `embed.html` in the web build.
 *
 * Just the editor, the blocks and a REPL, for other sites to iframe. No web API
 * install (no file system, no Web Serial, no IndexedDB): the program comes from
 * GitHub and the engines are driven directly.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <EmbedApp />
  </React.StrictMode>
)
