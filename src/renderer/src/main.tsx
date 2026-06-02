// Install the preload-bridge fallback BEFORE anything renders, so the app
// degrades gracefully if `window.api` is missing (e.g. outside Electron).
import './lib/preloadFallback'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fontsource/press-start-2p'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
