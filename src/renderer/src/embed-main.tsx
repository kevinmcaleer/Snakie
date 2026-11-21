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
// Snakie Flat (#1308): the embed wears the app's current look. Imported last, so it wins.
import './flat.css'
import { EMBED_PARAMS } from './code-embed/embed-boot'

// The robot frame (#1321) brings three.js; a code frame never loads it.
const RobotFrame = React.lazy(() => import('./code-embed/RobotFrame'))
// The lesson runner's output panel needs no editor: Monaco and Blockly stay unloaded.
const OutputFrame = React.lazy(() => import('./code-embed/OutputFrame'))
const EmbedApp = React.lazy(() => import('./code-embed/EmbedApp'))

/**
 * THE CODE EMBED'S ENTRY (#1286, epic #1285) — `embed.html` in the web build.
 *
 * Just the editor, the blocks and a REPL, for other sites to iframe. No web API
 * install (no file system, no Web Serial, no IndexedDB): the program comes from
 * GitHub and the engines are driven directly.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      {EMBED_PARAMS.robot ? (
        <RobotFrame params={EMBED_PARAMS} />
      ) : EMBED_PARAMS.output ? (
        <OutputFrame params={EMBED_PARAMS} />
      ) : (
        <EmbedApp />
      )}
    </React.Suspense>
  </React.StrictMode>
)
