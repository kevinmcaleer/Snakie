/**
 * Entry point for the floating Find & Replace window (`find.html`, issue #146).
 *
 * A THIRD renderer entry (see `electron.vite.config.ts`), mounting the
 * {@link FindReplace} panel. The window has no editor access — it drives the main
 * window's Monaco over IPC (`window.api.find`) — so this entry is tiny: it just
 * applies the shared editor theme so the dialog matches the app, then renders the
 * panel which fills the frameless OS window.
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { FindReplace } from './components/FindReplace'
import '@fontsource/jetbrains-mono'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function FindWindowApp(): JSX.Element {
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

  return <FindReplace />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<FindWindowApp />)
