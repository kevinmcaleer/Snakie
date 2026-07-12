// Install the preload-bridge fallback BEFORE anything renders, so the app
// degrades gracefully if `window.api` is missing (e.g. outside Electron).
import './lib/preloadFallback'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/jetbrains-mono'
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
