import { useEffect, useState } from 'react'
import { resolveBoards } from './part-editor.util'
import type { BoardDefinition } from '../../../shared/board'

/**
 * The board list for main-window consumers (the mini board view, I²C-detect),
 * sourced from the installed parts libraries (#52) — microcontroller parts → board
 * definitions — plus any Board-Creator boards, with the built-ins as a fallback.
 *
 * Loaded once on mount. The board-window components (BoardGraph) already receive
 * `libraries`/`userBoards` as props and call {@link resolveBoards} directly.
 */
export function useBoards(): BoardDefinition[] {
  const [boards, setBoards] = useState<BoardDefinition[]>(() => resolveBoards([], []))
  useEffect(() => {
    let alive = true
    void (async () => {
      const [libs, userBoards] = await Promise.all([
        window.api.parts.listLibraries().catch(() => []),
        window.api.board.listUserBoards().catch(() => [])
      ])
      if (alive) setBoards(resolveBoards(libs, userBoards))
    })()
    return () => {
      alive = false
    }
  }, [])
  return boards
}
