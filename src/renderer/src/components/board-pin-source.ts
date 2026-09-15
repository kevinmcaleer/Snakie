import { boardPinsFromPart, type BoardPinInfo } from './board-pin-check'
import { boardPartFor, partToBoardDefinition } from './part-editor.util'
import { DEFAULT_BOARD_ID } from './board-defs'
import { PARTS_CHANGED_EVENT } from './PartsPanel'

/**
 * WHICH BOARD IS SELECTED, AND WHAT ITS PINS CAN DO.
 * =============================================================================
 *
 * Extracted from `MonacoEditor.tsx` (#1012, epic #1007) when the block canvas
 * needed the same answer: the editor's bus check wants per-pin `signals` and bus
 * numbers, and the hardware blocks' pin dropdowns want per-pin `capabilities`.
 * Both are the same question — *which board, and what are its pins?* — asked
 * from two places, and two copies of the answer would drift the first time
 * anything about board selection changed.
 *
 * The board id lives in `localStorage` under `snakie.board.id`, written by the
 * Board View. The pins come from the board's PART, because a part is the only
 * thing that carries per-pin capabilities — the drawable `BoardDefinition` has
 * pads and labels but nothing about what a pad can do.
 */

/** The selected board, as much of it as anything here needs. */
export interface SelectedBoard {
  /** The board id from storage, or the default. */
  id: string
  /** Its pins, with capabilities, signals and bus numbers. Empty when unknown. */
  pins: BoardPinInfo[]
  /**
   * The onboard-LED pin token — `"LED"` on a Pico W (where the LED hangs off the
   * wireless chip and has no GPIO at all) or `"25"` on a plain Pico. Absent when
   * the board declares none.
   */
  ledLabel?: string
}

/** The selected board's id. Never throws — storage can be off or unavailable. */
export function selectedBoardId(): string {
  try {
    return window.localStorage.getItem('snakie.board.id') || DEFAULT_BOARD_ID
  } catch {
    return DEFAULT_BOARD_ID
  }
}

/**
 * Load the selected board. Resolves to an empty pin list rather than rejecting:
 * every caller's fallback is "assume nothing", and a rejected promise would make
 * each of them write the same catch.
 */
export async function loadSelectedBoard(): Promise<SelectedBoard> {
  const id = selectedBoardId()
  try {
    const libs = (await window.api?.parts?.listLibraries?.()) ?? []
    const part = boardPartFor(libs, id)
    return {
      id,
      pins: boardPinsFromPart(part),
      ledLabel: part ? partToBoardDefinition(part).ledLabel : undefined
    }
  } catch {
    return { id, pins: [] }
  }
}

/**
 * Call `onChange` whenever the selected board or the parts libraries change.
 *
 * Both matter: picking a different board in the Board View, and editing a board
 * part so its pins change under a board that is already selected.
 */
export function watchSelectedBoard(onChange: () => void): () => void {
  const offSelect = window.api?.board?.onSelectBoard?.(onChange)
  const offParts = window.api?.parts?.onChanged?.(onChange)
  window.addEventListener(PARTS_CHANGED_EVENT, onChange)
  return () => {
    offSelect?.()
    offParts?.()
    window.removeEventListener(PARTS_CHANGED_EVENT, onChange)
  }
}
