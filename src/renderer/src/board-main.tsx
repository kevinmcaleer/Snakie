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
 *   - renders the node-graph {@link BoardGraph} fed by the streamed
 *     `{ source, fileName, isPython, theme }` (the generic {@link BoardView}
 *     drawer is kept for the Board Creator's preview).
 *
 * The Board Viewer also HOSTS the **Parts Library** (#129/#130): the parts
 * library is only used by the board-viewer UX (parts get placed on the board), so
 * its browser + the Part Editor live here rather than in the main editor window.
 * A chip button in the title bar opens the Parts mode; authoring a part opens the
 * Part Editor as a full-window overlay.
 *
 * No scrim/modal chrome — it fills the OS window; the title bar is the draggable
 * region (handled inside BoardView via `asWindow`).
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BoardGraph } from './components/BoardGraph'
import { BoardCreator } from './components/BoardCreator'
import { PartsPanel, OPEN_PART_EDITOR_EVENT, PARTS_CHANGED_EVENT, type OpenPartEditorDetail } from './components/PartsPanel'
import { PartEditor } from './components/PartEditor'
import type {
  BoardDefinition,
  BoardSourcePayload,
  PartDefinition,
  PartLibrary
} from '../../preload/index.d'
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
  // The window has three modes: the live board VIEW, the Board Creator (DESIGN),
  // and the PARTS library. `editing` overlays the Part Editor on the parts mode.
  const [designMode, setDesignMode] = useState(false)
  const [partsMode, setPartsMode] = useState(false)
  const [editing, setEditing] = useState<{
    libraryId: string
    part: PartDefinition | null
    libraries: PartLibrary[]
    existingParts: PartDefinition[]
  } | null>(null)

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

  // Pull the latest snapshot on mount (covers the open-time push race).
  useEffect(() => {
    window.api.board
      .requestSource()
      .then((p) => {
        if (p) {
          setPayload(p)
          if (p.theme) applyTheme(p.theme)
        }
      })
      .catch(() => undefined)
  }, [])

  // The Parts panel asks (via a window event) to open the Part Editor for a
  // new/existing part. Fetch the libraries here so the editor gets the target
  // library list + the existing parts (for id-collision checks).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<OpenPartEditorDetail>).detail
      if (!detail) return
      window.api.parts
        .listLibraries()
        .then((libs) => {
          const lib = libs.find((l) => l.id === detail.libraryId)
          setEditing({
            libraryId: detail.libraryId,
            part: detail.part,
            libraries: libs,
            existingParts: lib?.parts ?? []
          })
        })
        .catch(() =>
          setEditing({ libraryId: detail.libraryId, part: detail.part, libraries: [], existingParts: [] })
        )
    }
    window.addEventListener(OPEN_PART_EDITOR_EVENT, handler)
    return () => window.removeEventListener(OPEN_PART_EDITOR_EVENT, handler)
  }, [])

  // Esc backs out one level at a time (so a stray Esc / a focused input's Esc
  // never slams the window shut): editor → parts → design → board → close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (editing) setEditing(null)
      else if (partsMode) setPartsMode(false)
      else if (designMode) {
        setDesignMode(false)
        refreshUserBoards()
      } else {
        window.api.board.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, partsMode, designMode, refreshUserBoards])

  if (designMode) {
    return (
      <BoardCreator
        userBoards={userBoards}
        asWindow
        onSave={(d) => window.api.board.saveUserBoard(d)}
        onDelete={(id) => window.api.board.deleteUserBoard(id)}
        onDone={() => {
          setDesignMode(false)
          refreshUserBoards()
        }}
      />
    )
  }

  if (partsMode) {
    return (
      <div className="bw-parts">
        <header className="bw-parts__bar">
          <div className="bw-parts__title">
            <span className="bw-parts__title-main">My Parts Library</span>
            <span className="bw-parts__title-sub">Parts you create are saved here.</span>
          </div>
          <button type="button" className="bw-parts__done" onClick={() => setPartsMode(false)} title="Back to the board view (Esc)">
            Done
          </button>
        </header>
        <div className="bw-parts__body">
          <PartsPanel />
        </div>
        {editing && (
          <PartEditor
            libraryId={editing.libraryId}
            initial={editing.part}
            existingParts={editing.existingParts}
            libraries={editing.libraries}
            onSaved={() => window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))}
            onClose={() => {
              setEditing(null)
              window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
            }}
          />
        )}
      </div>
    )
  }

  return (
    <BoardGraph
      source={payload.source}
      fileName={payload.fileName}
      isPython={payload.isPython}
      userBoards={userBoards}
      asWindow
      onOpenParts={() => setPartsMode(true)}
      onOpenBoardsFolder={() => void window.api.board.openBoardsFolder().catch(() => undefined)}
      onEnterCreator={() => setDesignMode(true)}
      onClose={() => window.api.board.close()}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<BoardWindowApp />)
