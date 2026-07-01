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
 * Note: this window's terminal is a FRESH xterm, so it shows the live stream from
 * pop-out onward rather than the docked console's prior scrollback (which is kept
 * intact in the main window for when you re-dock).
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { Terminal } from './components/Terminal'
import '@fontsource/jetbrains-mono'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function ConsoleWindowApp(): JSX.Element {
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

  return (
    <div className="console-window">
      <Terminal />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<ConsoleWindowApp />)
