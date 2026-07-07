// The web build's entry point (epic #267 Phase W1). Installs `createWebApi()`
// as `window.api` BEFORE anything renders, then renders the SAME `<App/>`
// used by the Electron renderer, completely unmodified.
import './web/installWebApi'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/jetbrains-mono'
import './index.css'

const rootEl = document.getElementById('root') as HTMLElement

// Surface any boot-time crash visibly instead of a silent blank page — the
// classroom target has no devtools console open by default.
const showFatalError = (error: unknown): void => {
  console.error('[Snakie] fatal boot error', error)
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  rootEl.innerHTML = `<pre style="white-space:pre-wrap;padding:16px;color:#f66;background:#1a1d23;font-family:monospace;">Snakie failed to start:\n${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)}</pre>`
}

window.addEventListener('error', (e) => showFatalError(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason))

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} catch (error) {
  showFatalError(error)
}

// Register the PWA service worker (installable + offline-capable — epic #267
// Phase W1's third deliverable). No-ops if unsupported.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('[Snakie] service worker registration failed', err)
    })
  })
}
