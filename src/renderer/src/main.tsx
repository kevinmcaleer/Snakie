// Install the preload-bridge fallback BEFORE anything renders, so the app
// degrades gracefully if `window.api` is missing (e.g. outside Electron).
import './lib/preloadFallback'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Soft Shell fonts (#574, epic #573): IBM Plex Mono is --font-mono (code /
// console / telemetry), Plus Jakarta Sans is --font-ui (chrome). Bundled locally
// so the offline-first app never reaches for a network font.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
// Nunito Sans — the learning system's prose font (see --font-learn). Weights:
// 400 body, 600/700 emphasis, 800 lesson headings.
import '@fontsource/nunito-sans/400.css'
import '@fontsource/nunito-sans/600.css'
import '@fontsource/nunito-sans/700.css'
import '@fontsource/nunito-sans/800.css'
import './index.css'

const render = (): void =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

// In the WEB build (epic #267), swap the fallback's inert `device` stub for the
// real MicroPython WASM simulator before rendering. Dynamic import so the Electron
// bundle never pulls in the WASM; a failure still renders the (device-inert) shell.
// After render, auto-connect the sim — it's the only port on the web, and Run
// stays greyed out until connected, which reads as "the app can't run programs".
if (import.meta.env.VITE_SNAKIE_WEB) {
  import('./web/install-web-api')
    .then((m) => {
      m.installWebApi()
      render()
      m.autoConnectSimulator()
    })
    .catch((err) => {
      console.error('[Snakie] web backend install failed', err)
      render()
    })
} else {
  render()
}
