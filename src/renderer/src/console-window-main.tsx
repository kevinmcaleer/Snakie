/**
 * Entry point for the detached CONSOLE window (`console.html`).
 *
 * A separate renderer entry (see `electron.vite.config.ts`) that renders the
 * same {@link Terminal} as the docked console, filling the window. It's bound to
 * the device stream — which the main process relays to this window (see
 * `src/main/consoleWindow.ts` + the broadcast in `src/main/device/ipc.ts`) — and
 * sends input back over the shared `window.api.device.sendData`, so the
 * popped-out console is fully interactive. Applies the persisted theme so it
 * matches the app (localStorage is shared per-origin).
 *
 * In the WEB build (#810) this same page is a browser popup opened by the editor
 * tab, and it runs on THAT tab's `window.api` — the same device, the same
 * stream, one board (see `web/web-console.ts`). If the editor window is gone
 * there is no board to read or write, so the window says so plainly instead of
 * sitting on a terminal that silently accepts keystrokes going nowhere.
 *
 * Note: this window's terminal is a FRESH xterm seeded with the scrollback handed
 * over at pop-out, so it redraws prior output and then follows the live stream.
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Terminal } from './components/Terminal'
import { IS_WEB } from './lib/env'
// Soft Shell fonts (#574) — the same faces the editor window loads, so a
// detached console is typeset like its docked twin. (JetBrains Mono was the old
// direction; #781 corrected the instrument window and this is its sibling.)
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
 * The web popup lost (or never had) its editor window. Everything this terminal
 * shows — and every keystroke it sends — travels through the tab that opened it,
 * so once that tab is gone the console is a picture. Say that, rather than
 * accepting input that goes nowhere.
 */
function DisconnectedConsole(): JSX.Element {
  return (
    <div className="instr-offline" role="alert">
      <h1 className="instr-offline__title">Console disconnected</h1>
      <p className="instr-offline__body">
        This console reads and writes the board through the Snakie window that opened it, and
        that window is no longer there. In a browser a pop-up cannot reach the simulator or a
        USB board by itself.
      </p>
      <p className="instr-offline__body">
        Open Snakie again and pop the console out to get a live window back.
      </p>
    </div>
  )
}

function ConsoleWindowApp({ connected }: { connected: boolean }): JSX.Element {
  // `null` until the prior console content has been fetched; we wait for it so
  // the terminal seeds (redraws the existing scrollback) before mounting and
  // following the live stream — otherwise the popped-out console starts blank.
  const [seed, setSeed] = useState<string | null>(null)
  const [live, setLive] = useState(connected)

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

  useEffect(() => {
    if (!live) return
    let alive = true
    window.api.console
      .requestSeed()
      .then((s) => {
        if (alive) setSeed(s ?? '')
      })
      .catch(() => {
        if (alive) setSeed('')
      })
    return () => {
      alive = false
    }
  }, [live])

  // A web popup outlives its editor tab, and everything it shows comes from
  // there — so watch for that tab going away and stop pretending to be live.
  useEffect(() => {
    if (!IS_WEB || !live) return
    let stop: (() => void) | undefined
    void import('./web/web-console').then(({ consoleHostAlive }) => {
      const id = window.setInterval(() => {
        if (!consoleHostAlive()) setLive(false)
      }, HOST_CHECK_MS)
      stop = () => window.clearInterval(id)
    })
    return () => stop?.()
  }, [live])

  if (!live) return <DisconnectedConsole />
  if (seed === null) return <div className="console-window" />
  return (
    <div className="console-window">
      <Terminal seed={seed || undefined} />
    </div>
  )
}

const render = (connected: boolean): void =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ConsoleWindowApp connected={connected} />
  )

// In the WEB build this window is a browser popup with no preload: adopt the
// editor window's backend before rendering (mirrors instrument-window-main.tsx).
// Without a reachable editor window there is no device at all, and the app says so.
if (import.meta.env.VITE_SNAKIE_WEB) {
  import('./web/install-web-api')
    .then((m) => render(m.installWebApi('console')))
    .catch((err) => {
      console.error('[Snakie] web backend install failed', err)
      render(false)
    })
} else {
  render(true)
}
