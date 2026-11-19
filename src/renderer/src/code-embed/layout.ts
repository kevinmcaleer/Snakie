/**
 * How tall an embed would like to be (#1288) — posted to the host page, which
 * sizes the iframe to it, so a five-line example isn't a 600px box and a long
 * one doesn't scroll inside a scrolling page. Pure, so it is unit-tested.
 */
import type { EmbedView } from './params'

export const BAR_H = 44
export const FOOTER_H = 34
export const LINE_H = 24
/** The code pane's own header strip, plus padding. */
export const PANE_CHROME_H = 44
export const REPL_H = 170
export const PLOTS_H = 230
export const MIN_EDITOR_H = 120
export const MAX_EDITOR_H = 560
/** Blocks need room to breathe: a canvas shorter than this is all toolbox. */
export const MIN_BLOCKS_H = 400
/** The board drawn beside the code needs this much height to be readable (#1318). */
export const MIN_BOARD_H = 300
/** The row of pin chips under the code, where the box is too narrow for the board. */
export const PIN_CHIPS_H = 44

export interface HeightInput {
  lines: number
  view: EmbedView
  repl: boolean
  plots: boolean
  error: boolean
  /** The pin strip (#1318): beside the code, as a row of chips under it, or absent. */
  board?: 'side' | 'chips' | null
}

export function preferredHeight({ lines, view, repl, plots, error, board = null }: HeightInput): number {
  if (error) return BAR_H + 140 + FOOTER_H
  const code = Math.min(MAX_EDITOR_H, Math.max(MIN_EDITOR_H, lines * LINE_H + PANE_CHROME_H))
  const pane = view === 'code' ? code : Math.max(MIN_BLOCKS_H, code)
  const editor = board === 'side' ? Math.max(MIN_BOARD_H, pane) : board === 'chips' ? pane + PIN_CHIPS_H : pane
  return BAR_H + editor + (repl ? REPL_H : 0) + (plots ? PLOTS_H : 0) + FOOTER_H
}
