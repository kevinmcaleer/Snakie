/**
 * Entry point for a detached instrument window (`instrument.html`, issue #205).
 *
 * A FOURTH renderer entry (see `electron.vite.config.ts`). When the user undocks
 * an instrument the main process opens this window and buffers its payload; the
 * window pulls the payload on mount and renders the single instrument, which is
 * fed by the live device stream relayed here. The window is natively resizable,
 * so the instrument fills it and reflows (the Plotter / scope ResizeObserver).
 *
 * In the WEB build (#781) this same page is a browser popup opened by the editor
 * tab, and it runs on THAT tab's `window.api` — the same device, the same
 * telemetry (see `web/web-instruments.ts`). If the editor window is gone there is
 * no board to read, so the window says so plainly instead of sitting on an empty
 * instrument.
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { StandaloneInstrument } from './components/instrument-standalone'
import type { InstrumentWindowPayload } from '../../shared/instrument-window'
import { IS_WEB } from './lib/env'
// Soft Shell fonts (#574) — the same faces the editor window loads, so a detached
// instrument is typeset like its docked twin.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'

/** How often a web popup checks that its editor window is still there. */
const HOST_CHECK_MS = 2000

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * The web popup lost (or never had) its editor window. Nothing here can read a
 * board on its own — the device lives in the tab that opened this one — so say
 * that, and how to get the instrument back.
 */
function DisconnectedInstrument(): JSX.Element {
  return (
    <div className="instr-offline" role="alert">
      <h1 className="instr-offline__title">Instrument disconnected</h1>
      <p className="instr-offline__body">
        This instrument reads the board through the Snakie window that opened it, and that
        window is no longer there. In a browser a pop-up cannot reach the simulator or a USB
        board by itself.
      </p>
      <p className="instr-offline__body">
        Open Snakie again and undock the instrument to get a live window back.
      </p>
    </div>
  )
}

function InstrumentWindowApp({ connected }: { connected: boolean }): JSX.Element {
  const [payload, setPayload] = useState<InstrumentWindowPayload | null>(null)
  const [live, setLive] = useState(connected)

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
    if (!live) return
    let alive = true
    void window.api.instruments.requestWindowPayload().then((p) => {
      if (alive && p) setPayload(p)
    })
    const off = window.api.instruments.onWindowPayload((p) => setPayload(p))
    return () => {
      alive = false
      off()
    }
  }, [live])

  // A web popup outlives its editor tab, and everything it shows comes from
  // there — so watch for that tab going away and stop pretending to be live.
  useEffect(() => {
    if (!IS_WEB || !live) return
    let stop: (() => void) | undefined
    void import('./web/web-instruments').then(({ instrumentHostAlive }) => {
      const id = window.setInterval(() => {
        if (!instrumentHostAlive()) setLive(false)
      }, HOST_CHECK_MS)
      stop = () => window.clearInterval(id)
    })
    return () => stop?.()
  }, [live])

  useEffect(() => {
    if (payload) document.title = payload.title
  }, [payload])

  if (!live) return <DisconnectedInstrument />
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

const render = (connected: boolean): void =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <InstrumentWindowApp connected={connected} />
  )

// In the WEB build this window is a browser popup with no preload: adopt the
// editor window's backend before rendering (mirrors board-main.tsx). Without a
// reachable editor window there is no device at all, and the app says so.
if (import.meta.env.VITE_SNAKIE_WEB) {
  import('./web/install-web-api')
    .then((m) => render(m.installWebApi('instrument')))
    .catch((err) => {
      console.error('[Snakie] web backend install failed', err)
      render(false)
    })
} else {
  render(true)
}
