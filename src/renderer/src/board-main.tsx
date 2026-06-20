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
import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BoardView } from './components/BoardView'
import { BoardCreator } from './components/BoardCreator'
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
  // VIEW vs DESIGN mode: the brass knob in the BoardView title bar enters the
  // Board Creator; "Done" returns to the read-only view (and re-loads boards).
  const [designMode, setDesignMode] = useState(false)

  // Re-read the user boards off disk (after a save/delete, or on Done).
  const refreshUserBoards = useCallback((): void => {
    window.api.board
      .listUserBoards()
      .then(setUserBoards)
      .catch(() => setUserBoards([]))
  }, [])

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
    refreshUserBoards()
  }, [refreshUserBoards])

  // Subscribe to the streamed active-file snapshot; apply its theme live.
  useEffect(() => {
    const off = window.api.board.onSource((p) => {
      setPayload(p)
      if (p.theme) applyTheme(p.theme)
    })
    return off
  }, [])

  // Esc closes the window (a frameless window has no native close affordance);
  // in design mode it first backs out to the read-only view so work isn't lost
  // to a stray Esc, and so a focused input's Esc doesn't slam the window shut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (designMode) {
        setDesignMode(false)
        refreshUserBoards()
      } else {
        window.api.board.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [designMode, refreshUserBoards])

  if (designMode) {
    return (
      <BoardCreator
        userBoards={userBoards}
        asWindow
        onSave={(d) => window.api.board.saveUserBoard(d)}
        onDelete={(id) => window.api.board.deleteUserBoard(id)}
        onDone={() => {
          setDesignMode(false)
          // A newly-saved board must be selectable back in the view.
          refreshUserBoards()
        }}
      />
    )
  }

  return (
    <BoardView
      source={payload.source}
      fileName={payload.fileName}
      isPython={payload.isPython}
      userBoards={userBoards}
      asWindow
      onOpenBoardsFolder={() => void window.api.board.openBoardsFolder().catch(() => undefined)}
      onEnterCreator={() => setDesignMode(true)}
      onClose={() => window.api.board.close()}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<BoardWindowApp />)
