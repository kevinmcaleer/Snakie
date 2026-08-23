/**
 * BITMAP FONT MODEL (#250) — pure, DOM-free glyph/charset/metrics logic for the
 * Font editor instrument. NOTHING here imports React or touches the DOM, so the
 * whole editing model is unit-testable in plain node (mirrors `display-logic`,
 * `buzzer-logic`, `instruments-registry`, …).
 * =============================================================================
 *
 * The model is deliberately plain and predictable — every operation is a PURE
 * function that returns a NEW {@link BitmapFont}; nothing mutates in place, so
 * undo/redo and React state are trivial and the invariants below always hold.
 *
 * ── The shape of a font ──────────────────────────────────────────────────────
 * A font has ONE cell size (`width` × `height`) that bounds every glyph, and a
 * `baseline` measured DOWN FROM THE TOP of the cell (so `baseline` rows sit above
 * the baseline and `height - baseline` below it — the same sense as
 * `font-to-py`'s `baseline()`).
 *
 * Each {@link Glyph} carries its OWN `width` — the glyph's **advance**, i.e. how
 * far the pen moves after drawing it. Ink and spacing are not separated: a
 * proportional `i` is (say) 2px of ink + 1px of trailing space = `width: 3`,
 * exactly as `font_to_py.py` bakes inter-character spacing into each glyph. A
 * `monospaced` font simply pins every glyph's `width` to the font `width`.
 *
 * Invariants held by every function here:
 *   - `glyph.rows.length === font.height`
 *   - `glyph.rows[y].length === glyph.width`
 *   - `1 <= glyph.width <= font.width`
 *   - `monospaced` ⇒ `glyph.width === font.width` for every glyph
 *   - `glyphs` is sorted ascending by `code`, each `code` unique
 *
 * ── Out-of-range is a no-op, never a throw ───────────────────────────────────
 * The editor pokes at pixels from mouse drags and keyboard nudges, so every
 * coordinate-taking function CLAMPS or IGNORES rather than throwing; an
 * out-of-range `setPixel` returns the font unchanged (by reference, so React
 * skips the re-render). Same for an unknown code point.
 */

/** A decoded monochrome bitmap: `w × h`, `pixels[y][x]` true = lit (ink). */
export interface GlyphBitmap {
  w: number
  h: number
  /** Row-major boolean grid, `pixels[y][x]`. Always `h` rows × `w` cols. */
  pixels: boolean[][]
}

/** One glyph: its code point, its advance width, and its bitmap rows. */
export interface Glyph {
  /** The Unicode code point this glyph draws (e.g. 65 for `A`). */
  code: number
  /**
   * The glyph's ADVANCE in pixels — ink plus any trailing spacing, exactly as
   * `font_to_py.py` bakes spacing into a proportional glyph. `1 … font.width`;
   * always equal to `font.width` in a monospaced font.
   */
  width: number
  /** Row-major bitmap, `rows[y][x]`: exactly `font.height` rows × `width` cols. */
  rows: boolean[][]
}

/** A complete editable bitmap font. */
export interface BitmapFont {
  /** Module/identifier stem used for the exported `.py` file (e.g. `jonny5`). */
  name: string
  /** Cell width in px — the maximum (and, when monospaced, the only) glyph width. */
  width: number
  /** Cell height in px — every glyph has exactly this many rows. */
  height: number
  /** Rows above the baseline, measured down from the top of the cell. */
  baseline: number
  /** `true` ⇒ every glyph is exactly `width` wide (a fixed-pitch font). */
  monospaced: boolean
  /** Every glyph, sorted ascending by `code`, codes unique. */
  glyphs: Glyph[]
}

/** The largest cell the editor will accept (keeps the grid renderable + fast). */
export const MAX_CELL = 32
/** The smallest cell that still draws something. */
export const MIN_CELL = 1

/** The preview line the panel renders at 1× (the classic pangram). */
export const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog'

// ── Charsets ────────────────────────────────────────────────────────────────

/** A named set of code points the editor can populate a font with. */
export interface Charset {
  /** Stable id used by the charset `<select>`. */
  id: string
  /** Human label shown in the picker. */
  label: string
  /** The code points, ascending. */
  codes: number[]
}

/** Inclusive `[from…to]` range as an ascending array of code points. */
export function codeRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let c = Math.min(from, to); c <= Math.max(from, to); c++) out.push(c)
  return out
}

/**
 * The charsets offered by the picker. Printable ASCII first (the default, and
 * what `font-to-py` emits by default); the smaller sets exist because a 7-segment
 * clock or a score readout only needs digits, and a 95-glyph font wastes flash on
 * a small board.
 */
export const CHARSETS: Charset[] = [
  { id: 'ascii', label: 'Printable ASCII (32–126)', codes: codeRange(0x20, 0x7e) },
  {
    id: 'upper',
    label: 'Uppercase + digits',
    codes: [0x20, ...codeRange(0x30, 0x39), ...codeRange(0x41, 0x5a)]
  },
  { id: 'digits', label: 'Digits 0–9', codes: codeRange(0x30, 0x39) },
  {
    id: 'clock',
    label: 'Clock (digits : . -)',
    codes: [0x20, 0x2d, 0x2e, ...codeRange(0x30, 0x39), 0x3a]
  }
]

/** Look up a charset by id (falls back to the first — printable ASCII). */
export function charsetById(id: string): Charset {
  return CHARSETS.find((c) => c.id === id) ?? CHARSETS[0]
}

/**
 * A short printable label for a code point, for the charset navigator's cells:
 * the character itself for anything printable, `SP` for the space (which would
 * otherwise render as an empty cell), and `·` for anything non-printable.
 */
export function codeLabel(code: number): string {
  if (code === 0x20) return 'SP'
  if (code < 0x20 || code === 0x7f) return '·'
  return String.fromCodePoint(code)
}

// ── Construction ────────────────────────────────────────────────────────────

/** A fresh all-off bitmap of `w × h`. */
export function blankRows(w: number, h: number): boolean[][] {
  return Array.from({ length: Math.max(0, h) }, () =>
    new Array<boolean>(Math.max(0, w)).fill(false)
  )
}

/** Deep-copy a bitmap (so callers can never alias a font's rows). */
function copyRows(rows: boolean[][]): boolean[][] {
  return rows.map((r) => r.slice())
}

/** Clamp `n` into `[lo, hi]` (NaN ⇒ `lo`). */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

export interface CreateFontOptions {
  name?: string
  width?: number
  height?: number
  /** Rows above the baseline; defaults to `height` (baseline at the cell foot). */
  baseline?: number
  monospaced?: boolean
  /** The code points to populate; defaults to printable ASCII. */
  codes?: number[]
}

/**
 * A new font of blank glyphs. The cell is clamped into `[MIN_CELL, MAX_CELL]` and
 * the baseline into `[0, height]`; duplicate codes collapse and the glyph list
 * comes back sorted, so a caller can pass any old array.
 */
export function createFont(opts: CreateFontOptions = {}): BitmapFont {
  const width = clamp(opts.width ?? 5, MIN_CELL, MAX_CELL)
  const height = clamp(opts.height ?? 7, MIN_CELL, MAX_CELL)
  const codes = [...new Set(opts.codes ?? CHARSETS[0].codes)].sort((a, b) => a - b)
  return {
    name: opts.name ?? 'myfont',
    width,
    height,
    baseline: clamp(opts.baseline ?? height, 0, height),
    monospaced: opts.monospaced ?? true,
    glyphs: codes.map((code) => ({ code, width, rows: blankRows(width, height) }))
  }
}

/** The glyph for `code`, or `undefined` when the font has no such glyph. */
export function glyphAt(font: BitmapFont, code: number): Glyph | undefined {
  return font.glyphs.find((g) => g.code === code)
}

/** Whether `font` has a glyph for `code`. */
export function hasGlyph(font: BitmapFont, code: number): boolean {
  return glyphAt(font, code) !== undefined
}

/**
 * Replace ONE glyph, keeping the list sorted. Returns the font unchanged (by
 * reference) when `code` isn't in the font — the "unknown code is a no-op" rule.
 */
function withGlyph(font: BitmapFont, code: number, next: Glyph): BitmapFont {
  const i = font.glyphs.findIndex((g) => g.code === code)
  if (i < 0) return font
  const glyphs = font.glyphs.slice()
  glyphs[i] = next
  return { ...font, glyphs }
}

// ── Pixel editing ───────────────────────────────────────────────────────────

/** Read one pixel (out-of-range / unknown code ⇒ `false`, never a throw). */
export function getPixel(font: BitmapFont, code: number, x: number, y: number): boolean {
  return glyphAt(font, code)?.rows[y]?.[x] === true
}

/**
 * Set one pixel on/off. An out-of-range coordinate or an unknown code point is a
 * NO-OP that returns the same font by reference (so React skips the re-render);
 * setting a pixel to the value it already has does the same.
 */
export function setPixel(
  font: BitmapFont,
  code: number,
  x: number,
  y: number,
  on: boolean
): BitmapFont {
  const g = glyphAt(font, code)
  if (!g) return font
  if (!Number.isInteger(x) || !Number.isInteger(y)) return font
  if (x < 0 || y < 0 || y >= g.rows.length || x >= g.width) return font
  if (g.rows[y][x] === on) return font
  const rows = copyRows(g.rows)
  rows[y][x] = on
  return withGlyph(font, code, { ...g, rows })
}

/** Flip one pixel (same no-op rules as {@link setPixel}). */
export function togglePixel(font: BitmapFont, code: number, x: number, y: number): BitmapFont {
  return setPixel(font, code, x, y, !getPixel(font, code, x, y))
}

/** Blank one glyph's bitmap (its width is kept). */
export function clearGlyph(font: BitmapFont, code: number): BitmapFont {
  const g = glyphAt(font, code)
  if (!g) return font
  return withGlyph(font, code, { ...g, rows: blankRows(g.width, font.height) })
}

/** Invert one glyph's bitmap (ink ⇄ paper) — handy for building cursors/blocks. */
export function invertGlyph(font: BitmapFont, code: number): BitmapFont {
  const g = glyphAt(font, code)
  if (!g) return font
  return withGlyph(font, code, { ...g, rows: g.rows.map((r) => r.map((v) => !v)) })
}

/**
 * Shift one glyph by `dx` columns / `dy` rows. Vacated cells come in blank and
 * ink pushed past an edge is DROPPED (it does not wrap — wrapping ink is never
 * what you want when nudging a letter into place).
 *
 * So a shift is reversible exactly while no ink falls off the edge: for a glyph
 * with a clear margin on the side it moves toward, `shift(-dx)` after `shift(dx)`
 * restores the original bitmap. The editor's nudge buttons rely on that.
 */
export function shiftGlyph(font: BitmapFont, code: number, dx: number, dy: number): BitmapFont {
  const g = glyphAt(font, code)
  if (!g) return font
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || (dx === 0 && dy === 0)) return font
  const rows = blankRows(g.width, font.height)
  for (let y = 0; y < font.height; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= font.height) continue
    for (let x = 0; x < g.width; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= g.width) continue
      rows[y][x] = g.rows[sy][sx]
    }
  }
  return withGlyph(font, code, { ...g, rows })
}

/**
 * Crop/pad a bitmap to `w × h`, anchored TOP-LEFT: every pixel that still fits
 * keeps its `(x, y)`, anything outside the new box is dropped, and new cells come
 * in blank. This one helper is what makes "a resize preserves what still fits"
 * true for both the per-glyph width and the whole-font cell resize.
 */
export function fitRows(rows: boolean[][], w: number, h: number): boolean[][] {
  const out = blankRows(w, h)
  for (let y = 0; y < Math.min(h, rows.length); y++) {
    const src = rows[y]
    for (let x = 0; x < Math.min(w, src.length); x++) out[y][x] = src[x] === true
  }
  return out
}

/**
 * Copy the bitmap AND width of `from` onto `to` (the editor's "copy from…"). The
 * source is cropped/padded on the right if the destination is a different width
 * — which only happens in a proportional font, since a monospaced font's glyphs
 * are all the cell width.
 */
export function copyGlyph(font: BitmapFont, from: number, to: number): BitmapFont {
  const src = glyphAt(font, from)
  const dst = glyphAt(font, to)
  if (!src || !dst || from === to) return font
  const width = font.monospaced ? font.width : src.width
  return withGlyph(font, to, { code: to, width, rows: fitRows(src.rows, width, font.height) })
}

/**
 * Set ONE glyph's advance width (proportional fonts). Clamped to
 * `[1, font.width]`; the bitmap is cropped/padded on the right. A no-op on a
 * monospaced font — every glyph there is the cell width by definition, so the UI
 * disables the control rather than silently breaking the invariant.
 */
export function setGlyphWidth(font: BitmapFont, code: number, width: number): BitmapFont {
  const g = glyphAt(font, code)
  if (!g || font.monospaced) return font
  const w = clamp(width, 1, font.width)
  if (w === g.width) return font
  return withGlyph(font, code, { ...g, width: w, rows: fitRows(g.rows, w, font.height) })
}

/** The x of the rightmost inked column + 1 (i.e. the ink width); 0 when blank. */
export function inkWidth(glyph: Glyph): number {
  for (let x = glyph.width - 1; x >= 0; x--) {
    for (let y = 0; y < glyph.rows.length; y++) {
      if (glyph.rows[y][x]) return x + 1
    }
  }
  return 0
}

/**
 * Shrink one glyph's width to its ink plus `pad` columns of trailing spacing —
 * the "auto-fit" button that turns a hand-drawn monospaced letter into a properly
 * proportional one.
 *
 * A BLANK glyph is left alone: a space auto-fitted to its (nonexistent) ink would
 * collapse to a single column, which is never what anyone wants. Widths still
 * clamp to the cell, so a glyph whose ink fills the cell gets no spacing — see
 * {@link autoFitAll}, which grows the cell first so that can't happen.
 */
export function autoWidth(font: BitmapFont, code: number, pad = 1): BitmapFont {
  const g = glyphAt(font, code)
  if (!g || font.monospaced) return font
  const ink = inkWidth(g)
  if (ink === 0) return font
  return setGlyphWidth(font, code, ink + Math.max(0, Math.round(pad)))
}

/**
 * Make the whole font proportional in one step — the panel's "Auto-fit widths"
 * button.
 *
 * The cell is first GROWN (never shrunk) to `widest ink + pad`, so that every
 * glyph can keep its `pad` columns of trailing spacing instead of being silently
 * clamped and having its letters touch; then each inked glyph takes width
 * `ink + pad`. Blank glyphs (the space) keep whatever advance they had. Growing
 * the cell is capped at {@link MAX_CELL}.
 */
export function autoFitAll(font: BitmapFont, pad = 1): BitmapFont {
  const p = Math.max(0, Math.round(pad))
  const widest = font.glyphs.reduce((m, g) => Math.max(m, inkWidth(g)), 0)
  let out = setMonospaced(font, false)
  if (widest + p > out.width) out = resizeFont(out, Math.min(MAX_CELL, widest + p), out.height)
  for (const g of out.glyphs) out = autoWidth(out, g.code, p)
  return out
}

// ── Whole-font operations ───────────────────────────────────────────────────

/**
 * Resize the CELL. Every glyph's bitmap is cropped/padded anchored top-left, so
 * everything that still fits survives; glyph widths are clamped to the new cell
 * width (and pinned to it when monospaced), and the baseline is clamped into the
 * new height.
 */
export function resizeFont(font: BitmapFont, width: number, height: number): BitmapFont {
  const w = clamp(width, MIN_CELL, MAX_CELL)
  const h = clamp(height, MIN_CELL, MAX_CELL)
  if (w === font.width && h === font.height) return font
  return {
    ...font,
    width: w,
    height: h,
    baseline: clamp(font.baseline, 0, h),
    glyphs: font.glyphs.map((g) => {
      const gw = font.monospaced ? w : Math.min(g.width, w)
      return { ...g, width: gw, rows: fitRows(g.rows, gw, h) }
    })
  }
}

/**
 * Switch between fixed-pitch and proportional. Going MONOSPACED pads every glyph
 * out to the cell width (nothing is lost). Going PROPORTIONAL leaves the widths
 * exactly as they are — the user then auto-fits or drags them narrower, so the
 * change is visible only when they ask for it.
 */
export function setMonospaced(font: BitmapFont, monospaced: boolean): BitmapFont {
  if (monospaced === font.monospaced) return font
  if (!monospaced) return { ...font, monospaced }
  return {
    ...font,
    monospaced,
    glyphs: font.glyphs.map((g) =>
      g.width === font.width
        ? g
        : { ...g, width: font.width, rows: fitRows(g.rows, font.width, font.height) }
    )
  }
}

/** Set the baseline (clamped into `[0, height]`). */
export function setBaseline(font: BitmapFont, baseline: number): BitmapFont {
  const b = clamp(baseline, 0, font.height)
  return b === font.baseline ? font : { ...font, baseline: b }
}

/**
 * Change the font's charset to exactly `codes`. Existing glyphs for codes that
 * survive are KEPT (drawing work is never silently thrown away by a picker
 * change); new codes arrive blank. Returns a sorted, deduped glyph list.
 */
export function setCharset(font: BitmapFont, codes: number[]): BitmapFont {
  const want = [...new Set(codes)].sort((a, b) => a - b)
  const glyphs = want.map(
    (code) =>
      glyphAt(font, code) ?? {
        code,
        width: font.width,
        rows: blankRows(font.width, font.height)
      }
  )
  return { ...font, glyphs }
}

/** The font's code points, ascending. */
export function fontCodes(font: BitmapFont): number[] {
  return font.glyphs.map((g) => g.code)
}

/** Whether a glyph has any ink at all (drives the navigator's "drawn" marker). */
export function glyphHasInk(g: Glyph): boolean {
  return g.rows.some((r) => r.some(Boolean))
}

/** How many glyphs in the font have ink — the panel's progress readout. */
export function drawnCount(font: BitmapFont): number {
  return font.glyphs.filter(glyphHasInk).length
}

// ── Metrics & text rendering ────────────────────────────────────────────────

/**
 * The advance used for `code` when laying out a string: the glyph's own width,
 * or the full cell width when the font has no glyph for it (so missing
 * characters show as a blank of predictable size rather than vanishing).
 */
export function advanceOf(font: BitmapFont, code: number): number {
  return glyphAt(font, code)?.width ?? font.width
}

/** The rendered pixel width of `text` — the sum of its advances. */
export function measureText(font: BitmapFont, text: string): number {
  let w = 0
  for (const ch of text) w += advanceOf(font, ch.codePointAt(0) ?? 0)
  return w
}

/**
 * Lay `text` out into a single-line bitmap at 1× — what the preview strip and the
 * simulated OLED both draw. Glyphs are placed left-to-right at their advance;
 * a character with no glyph leaves a blank cell of `font.width`.
 */
export function renderText(font: BitmapFont, text: string): GlyphBitmap {
  const w = measureText(font, text)
  const pixels = blankRows(w, font.height)
  let pen = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const g = glyphAt(font, code)
    if (g) {
      for (let y = 0; y < font.height; y++) {
        for (let x = 0; x < g.width; x++) {
          if (g.rows[y]?.[x]) pixels[y][pen + x] = true
        }
      }
    }
    pen += advanceOf(font, code)
  }
  return { w, h: font.height, pixels }
}

// ── ASCII-art interchange (authoring + tests) ───────────────────────────────

/**
 * Parse a glyph from ASCII art — one string per row, `#`/`X`/`x`/`1`/`*` = ink and
 * anything else = paper. Rows are padded/cropped to `width` (defaulting to the
 * longest row) and `height` (defaulting to the row count), so ragged art is
 * tolerated. Used by the bundled starter font (which is authored AS art, so it
 * can be read and corrected by eye) and by the tests.
 */
export function parseGlyphArt(art: string[], width?: number, height?: number): boolean[][] {
  const w = width ?? art.reduce((m, r) => Math.max(m, r.length), 0)
  const h = height ?? art.length
  const rows = art.map((line) =>
    Array.from({ length: w }, (_, x) => {
      const c = line[x]
      return c === '#' || c === 'X' || c === 'x' || c === '1' || c === '*'
    })
  )
  return fitRows(rows, w, h)
}

/** Render a bitmap back to ASCII art (`#` ink, `.` paper) — the tests' oracle. */
export function toGlyphArt(rows: boolean[][]): string[] {
  return rows.map((r) => r.map((v) => (v ? '#' : '.')).join(''))
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * The on-disk / localStorage shape of a font. Glyph bitmaps are stored as the
 * same `/`-joined ASCII art the bundled starter font is authored in — compact,
 * diffable, and readable if anyone ever opens the JSON.
 */
export interface FontJson {
  v: 1
  name: string
  width: number
  height: number
  baseline: number
  monospaced: boolean
  glyphs: { c: number; w: number; a: string }[]
}

/** Serialise a font for persistence. */
export function toFontJson(font: BitmapFont): FontJson {
  return {
    v: 1,
    name: font.name,
    width: font.width,
    height: font.height,
    baseline: font.baseline,
    monospaced: font.monospaced,
    glyphs: font.glyphs.map((g) => ({ c: g.code, w: g.width, a: toGlyphArt(g.rows).join('/') }))
  }
}

/**
 * Rebuild a font from {@link toFontJson} output. DEFENSIVE: the input comes from
 * localStorage (or a file the user edited), so anything malformed returns `null`
 * rather than throwing, and individual glyph fields are clamped back into the
 * model's invariants instead of being trusted.
 */
export function fromFontJson(value: unknown): BitmapFont | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<FontJson>
  if (raw.v !== 1 || !Array.isArray(raw.glyphs)) return null
  const width = clamp(Number(raw.width), MIN_CELL, MAX_CELL)
  const height = clamp(Number(raw.height), MIN_CELL, MAX_CELL)
  const monospaced = raw.monospaced !== false
  const seen = new Set<number>()
  const glyphs: Glyph[] = []
  for (const g of raw.glyphs) {
    const code = Number(g?.c)
    if (!Number.isInteger(code) || code < 0 || seen.has(code)) continue
    seen.add(code)
    const w = monospaced ? width : clamp(Number(g?.w), 1, width)
    const art = typeof g?.a === 'string' ? g.a.split('/') : []
    glyphs.push({ code, width: w, rows: parseGlyphArt(art, w, height) })
  }
  if (glyphs.length === 0) return null
  glyphs.sort((a, b) => a.code - b.code)
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'myfont',
    width,
    height,
    baseline: clamp(Number(raw.baseline), 0, height),
    monospaced,
    glyphs
  }
}
