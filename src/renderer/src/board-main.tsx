/**
 * Entry point for the floating Board View window (`board.html`).
 *
 * It is a SECOND renderer entry (see `electron.vite.config.ts`), mounting a
 * minimal app that:
 *   - applies the editor theme (from `localStorage` then live from each
 *     streamed payload) as `data-theme` on `<html>` so it matches the app,
 *   - subscribes to the streamed active-file snapshot (`window.api.board.onSource`),
 *   - loads any user-authored board definitions once
 *     (`window.api.board.listUserBoards`),
 *   - renders the generic {@link BoardView} fed by the streamed
 *     `{ source, fileName, isPython, theme }`.
 *
 * No scrim/modal chrome — it fills the OS window; the title bar is the draggable
 * region (handled inside BoardView via `asWindow`).
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BoardView } from './components/BoardView'
import type { BoardDefinition, BoardSourcePayload } from '../../preload/index.d'
import '@fontsource/jetbrains-mono'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function BoardWindowApp(): JSX.Element {
  const [payload, setPayload] = useState<BoardSourcePayload>({
    source: '',
    fileName: undefined,
    isPython: false,
    theme: 'skeuomorph'
  })
  const [userBoards, setUserBoards] = useState<BoardDefinition[]>([])

  // Apply the persisted theme immediately so the first paint matches the app.
  useEffect(() => {
    let initial = 'skeuomorph'
    try {
      const raw = window.localStorage.getItem(THEME_KEY)
      if (raw) initial = JSON.parse(raw) as string
    } catch {
      // Ignore — fall back to the default.
    }
    applyTheme(initial)
    setPayload((p) => ({ ...p, theme: initial }))
  }, [])

  // Load user-authored boards once (read off disk by the main process).
  useEffect(() => {
    window.api.board
      .listUserBoards()
      .then(setUserBoards)
      .catch(() => setUserBoards([]))
  }, [])

  // Subscribe to the streamed active-file snapshot; apply its theme live.
  useEffect(() => {
    const off = window.api.board.onSource((p) => {
      setPayload(p)
      if (p.theme) applyTheme(p.theme)
    })
    return off
  }, [])

  return (
    <BoardView
      source={payload.source}
      fileName={payload.fileName}
      isPython={payload.isPython}
      userBoards={userBoards}
      asWindow
      onOpenBoardsFolder={() => void window.api.board.openBoardsFolder().catch(() => undefined)}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<BoardWindowApp />)
