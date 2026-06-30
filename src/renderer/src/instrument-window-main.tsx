/**
 * Entry point for a detached instrument OS window (`instrument.html`, issue #205).
 *
 * A FOURTH renderer entry (see `electron.vite.config.ts`). When the user undocks
 * an instrument the main process opens this window and buffers its payload; the
 * window pulls the payload on mount and renders the single instrument, which is
 * fed by the live device stream relayed here. The window is natively resizable,
 * so the instrument fills it and reflows (the Plotter / scope ResizeObserver).
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { StandaloneInstrument } from './components/instrument-standalone'
import type { InstrumentWindowPayload } from '../../shared/instrument-window'
import '@fontsource/jetbrains-mono'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function InstrumentWindowApp(): JSX.Element {
  const [payload, setPayload] = useState<InstrumentWindowPayload | null>(null)

  // Apply the persisted theme immediately so the first paint matches the app
  // (localStorage is shared per-origin with the main window).
  useEffect(() => {
    let initial = 'skeuomorph'
    try {
      const raw = window.localStorage.getItem(THEME_KEY)
      if (raw) initial = JSON.parse(raw) as string
    } catch {
      // Ignore — fall back to the default.
    }
    applyTheme(initial)
  }, [])

  // Pull the buffered payload on mount (covers the open-time race) and track any
  // refresh the main process pushes.
  useEffect(() => {
    let alive = true
    void window.api.instruments.requestWindowPayload().then((p) => {
      if (alive && p) setPayload(p)
    })
    const off = window.api.instruments.onWindowPayload((p) => setPayload(p))
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    if (payload) document.title = payload.title
  }, [payload])

  if (!payload) {
    return <div className="instr-window__loading">Loading instrument…</div>
  }
  return (
    <div className="instr-window">
      <StandaloneInstrument
        payload={payload}
        onDock={() => window.api.instruments.closeWindow(payload.key)}
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<InstrumentWindowApp />)
