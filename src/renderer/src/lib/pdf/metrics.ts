/**
 * Glyph metrics for the base-14 fonts the PDF writer uses (#1113/#1111).
 *
 * Widths are in 1/1000 em, the unit the AFM files and the PDF text operators
 * both speak: a glyph's advance in points is `width * size / 1000`.
 *
 * `/Courier` is monospaced — EVERY glyph is 600/1000 — so a line's width is
 * arithmetic and the code listing can paginate exactly, with no DOM and no
 * `measureText`. Helvetica is proportional, so centring or wrapping a title
 * needs a real table; the one below covers the printable ASCII range (where
 * essentially all of our chrome lives) and derives the accented Latin-1 letters
 * from their base letter, which in Helvetica is the same advance.
 */

/** The base-14 fonts this writer exposes. */
export type PdfFont = 'Helvetica' | 'Helvetica-Bold' | 'Courier'

/** Every `/Courier` glyph advances the same 600/1000 em. */
export const COURIER_WIDTH = 600

/** Helvetica advances for `0x20`–`0x7E`, indexed by `code - 32`. */
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
]

/** Helvetica-Bold advances for `0x20`–`0x7E`, indexed by `code - 32`. */
const HELVETICA_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
]

/** Advances for the punctuation WinAnsi adds above `0x7F` that we actually print. */
const HELVETICA_PUNCT: Readonly<Record<number, number>> = {
  0x2013: 556, // – en dash
  0x2014: 1000, // — em dash
  0x2018: 222, // ‘
  0x2019: 222, // ’
  0x201c: 333, // “
  0x201d: 333, // ”
  0x2022: 350, // •
  0x2026: 1000, // … ellipsis
  0x00a9: 737, // ©
  0x00b0: 400, // °
  0x00b7: 278, // ·
  0x00ae: 737 // ®
}

/** Used when a code point has no entry — Helvetica's most common advance. */
const DEFAULT_WIDTH = 556

/** The advance of one code point in 1/1000 em. */
export function glyphWidth(font: PdfFont, cp: number): number {
  if (font === 'Courier') return COURIER_WIDTH
  const table = font === 'Helvetica-Bold' ? HELVETICA_BOLD : HELVETICA
  if (cp >= 0x20 && cp <= 0x7e) return table[cp - 0x20]
  const punct = HELVETICA_PUNCT[cp]
  if (punct !== undefined) return punct
  // An accented Latin-1 letter advances like its base letter in both Helvetica
  // cuts, so decompose and re-ask rather than carrying a second table.
  const base = String.fromCodePoint(cp).normalize('NFD').codePointAt(0) ?? 0
  if (base !== cp && base >= 0x20 && base <= 0x7e) return table[base - 0x20]
  return DEFAULT_WIDTH
}

/** The width of `text` at `size` points. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  let em = 0
  for (const ch of text) em += glyphWidth(font, ch.codePointAt(0) ?? 0)
  return (em * size) / 1000
}

/**
 * How many `/Courier` characters fit in `width` points at `size`. Exact, because
 * every glyph is {@link COURIER_WIDTH}; never negative.
 */
export function courierCharsPerLine(width: number, size: number): number {
  return Math.max(0, Math.floor(width / ((COURIER_WIDTH * size) / 1000)))
}
