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

export interface HeightInput {
  lines: number
  view: EmbedView
  repl: boolean
  plots: boolean
  error: boolean
}

export function preferredHeight({ lines, view, repl, plots, error }: HeightInput): number {
  if (error) return BAR_H + 140 + FOOTER_H
  const code = Math.min(MAX_EDITOR_H, Math.max(MIN_EDITOR_H, lines * LINE_H + PANE_CHROME_H))
  const editor = view === 'code' ? code : Math.max(MIN_BLOCKS_H, code)
  return BAR_H + editor + (repl ? REPL_H : 0) + (plots ? PLOTS_H : 0) + FOOTER_H
}
