import { useEffect, useState } from 'react'
import { resolveBoards } from './part-editor.util'
import { PARTS_CHANGED_EVENT } from './PartsPanel'
import type { BoardDefinition } from '../../../shared/board'

/**
 * The board list for main-window consumers (the mini board view, I²C-detect),
 * sourced from the installed parts libraries (#52) — microcontroller parts → board
 * definitions — plus any Board-Creator boards, with the built-ins as a fallback.
 *
 * Loaded on mount and re-read whenever another window broadcasts a board
 * selection — that signal can reference a board this window hasn't loaded yet
 * (e.g. one just duplicated/created in the board window), so a consumer like the
 * mini board view can resolve and follow it instead of falling back to the first
 * board. The board-window components (BoardGraph) already receive
 * `libraries`/`userBoards` as props and call {@link resolveBoards} directly.
 */
export function useBoards(): BoardDefinition[] {
  const [boards, setBoards] = useState<BoardDefinition[]>(() => resolveBoards([], []))
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [libs, userBoards] = await Promise.all([
        window.api.parts.listLibraries().catch(() => []),
        window.api.board.listUserBoards().catch(() => [])
      ])
      if (alive) setBoards(resolveBoards(libs, userBoards))
    }
    void load()
    const reload = (): void => void load()
    const off = window.api.board.onSelectBoard(reload)
    // Refresh when a part/library is authored — from ANOTHER window (the Part
    // Editor, via the main-process `parts:didChange` broadcast) or THIS one (the
    // same-window PARTS_CHANGED_EVENT) — so e.g. adding I²C pins to a board part
    // shows up in the I²C-detect pin dropdowns without an app reload.
    const offParts = window.api.parts.onChanged(reload)
    window.addEventListener(PARTS_CHANGED_EVENT, reload)
    return () => {
      alive = false
      off()
      offParts()
      window.removeEventListener(PARTS_CHANGED_EVENT, reload)
    }
  }, [])
  return boards
}
