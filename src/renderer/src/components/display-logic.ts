/**
 * I²C DISPLAY LOGIC (#118) — pure, DOM-free helpers for the I²C display mirror &
 * output panel. NOTHING here imports React or touches the DOM, so the framebuffer
 * decode + text layout + push-payload builder are unit-testable in plain node
 * (mirrors `Plotter.parse`, `display`/`board-values`, etc.).
 * =============================================================================
 *
 * The panel renders a monochrome OLED/LCD (SSD1306/SH1106 OLED 128×64 / 128×32,
 * or an HD44780 character LCD via I²C backpack 16×2 / 20×4). Two directions, both
 * handled here as pure data:
 *
 *  - MIRROR (read): the board emits its screen over the `SNK SCR …` telemetry
 *    (parsed upstream by `instrument-telemetry.ts` into a {@link ScreenTelemetry}).
 *    A `text` reading gives rows; an `fb` reading gives a packed framebuffer.
 *    {@link decodeFramebuffer} unpacks the framebuffer to a `w×h` boolean pixel
 *    grid; {@link layoutText} pads/truncates rows to a fixed character grid.
 *
 *  - PUSH (write): the IDE composes rows and pushes them to the real display via
 *    `sendControl('screen', payload)`. {@link buildScreenPayload} builds the
 *    `screen` control payload string in the SAME grammar the device telemetry
 *    `screen()` emitter uses for its rows (`text <row> [<row> …]`, each row a
 *    single ASCII token with spaces encoded as `_`), so an on-device `Screen`
 *    handler can decode the rows exactly as the IDE decodes the echo.
 *
 * ── Framebuffer packing (MUST match `micropython/instruments.py::screen_fb`) ──
 * The device documents two encodings on the wire:
 *   - `b64`: base64 of the RAW 1-bpp buffer, ROW-MAJOR, MSB-first within each
 *     byte. So pixel (x, y) lives at bit index `y*w + x` of a contiguous bit
 *     stream; byte = `idx >> 3`, bit = `7 - (idx & 7)` (the high bit first).
 *   - `rle`: a run-length form `<count>x<0|1>` joined by commas, expanding to a
 *     flat row-major run of pixels (e.g. `3x1,5x0` → 3 on then 5 off).
 * Decoding mirrors that bit-for-bit; a short/garbage payload degrades to OFF
 * pixels rather than throwing (telemetry parsing never throws).
 */

import type { ScreenTelemetry } from './instrument-telemetry'

/** A decoded monochrome screen: `w×h`, `pixels[y][x]` true = lit. */
export interface PixelGrid {
  w: number
  h: number
  /** Row-major boolean grid, `pixels[y][x]`. Always `h` rows × `w` cols. */
  pixels: boolean[][]
}

/** A fixed character grid for a text/LCD display: `rows` lines of `cols` chars. */
export interface CharGrid {
  cols: number
  rows: number
  /** Exactly `rows` strings, each padded/truncated to exactly `cols` chars. */
  lines: string[]
}

/** A known display geometry the panel can be configured to. */
export interface DisplayGeometry {
  /** Stable id used by the size <select>. */
  id: string
  /** Human label shown in the picker + the SIZE readout. */
  label: string
  /** `pixel` = a graphic OLED (framebuffer); `char` = an HD44780 character LCD. */
  type: 'pixel' | 'char'
  /** Pixel displays: width/height in px. */
  w?: number
  h?: number
  /** Character displays: columns × rows of characters. */
  cols?: number
  charRows?: number
}

/**
 * The configurable geometries (#118): SSD1306/SH1106 graphic OLEDs and HD44780
 * character LCDs over an I²C backpack. Order = the picker order; the first is the
 * default (the common 128×64 SSD1306).
 */
export const DISPLAY_GEOMETRIES: DisplayGeometry[] = [
  { id: 'oled-128x64', label: 'OLED 128×64', type: 'pixel', w: 128, h: 64 },
  { id: 'oled-128x32', label: 'OLED 128×32', type: 'pixel', w: 128, h: 32 },
  { id: 'lcd-16x2', label: 'LCD 16×2', type: 'char', cols: 16, charRows: 2 },
  { id: 'lcd-20x4', label: 'LCD 20×4', type: 'char', cols: 20, charRows: 4 }
]

/** Look up a geometry by id (falls back to the first / default geometry). */
export function geometryById(id: string): DisplayGeometry {
  return DISPLAY_GEOMETRIES.find((g) => g.id === id) ?? DISPLAY_GEOMETRIES[0]
}

/** An all-OFF `w×h` grid (the blank/standby screen). */
export function blankGrid(w: number, h: number): PixelGrid {
  const safeW = Math.max(0, Math.floor(w) || 0)
  const safeH = Math.max(0, Math.floor(h) || 0)
  const pixels: boolean[][] = []
  for (let y = 0; y < safeH; y++) pixels.push(new Array<boolean>(safeW).fill(false))
  return { w: safeW, h: safeH, pixels }
}

/** The base64 alphabet → 6-bit value, built once (DOM-free, no `atob`). */
const B64_INDEX: Record<string, number> = (() => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const map: Record<string, number> = {}
  for (let i = 0; i < alphabet.length; i++) map[alphabet[i]] = i
  return map
})()

/**
 * Decode a base64 string to a byte array, DOM-free (no `atob`/`Buffer`). Ignores
 * `=` padding and any non-alphabet character; a malformed tail just stops early.
 * Never throws — returns whatever full bytes it could assemble.
 */
export function base64ToBytes(b64: string): number[] {
  const bytes: number[] = []
  let acc = 0
  let bits = 0
  for (const ch of b64) {
    if (ch === '=' ) break
    const v = B64_INDEX[ch]
    if (v === undefined) continue // skip whitespace / stray chars
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  return bytes
}

/**
 * Decode a `b64` framebuffer to a flat row-major bit array of length `w*h`.
 * Bit `i` (= `y*w + x`) is byte `i>>3`, bit `7-(i&7)` (MSB-first), matching the
 * device `screen_fb(encoding="b64")` packing. Missing bits (short payload) read
 * as `0`/OFF.
 */
export function decodeB64Bits(data: string, count: number): boolean[] {
  const bytes = base64ToBytes(data)
  const out: boolean[] = new Array<boolean>(Math.max(0, count)).fill(false)
  for (let i = 0; i < out.length; i++) {
    const byte = bytes[i >> 3]
    if (byte === undefined) break
    out[i] = ((byte >> (7 - (i & 7))) & 1) === 1
  }
  return out
}

/**
 * Decode an `rle` framebuffer (`<count>x<0|1>` runs joined by commas) to a flat
 * row-major bit array. Stops at `count` bits; pads with OFF if the runs fall
 * short. Bad/empty tokens are skipped (never throws), matching the device
 * `screen_fb(encoding="rle")` form.
 */
export function decodeRleBits(data: string, count: number): boolean[] {
  const out: boolean[] = new Array<boolean>(Math.max(0, count)).fill(false)
  if (!data) return out
  let i = 0
  for (const tok of data.split(',')) {
    const x = tok.indexOf('x')
    if (x <= 0) continue
    const run = Number(tok.slice(0, x))
    const bit = tok.slice(x + 1)
    if (!Number.isFinite(run) || run <= 0 || (bit !== '0' && bit !== '1')) continue
    const on = bit === '1'
    for (let k = 0; k < run && i < out.length; k++, i++) out[i] = on
  }
  return out
}

/**
 * Decode a {@link ScreenTelemetry} framebuffer into a `w×h` {@link PixelGrid}.
 *
 * Mirrors the device `screen_fb` packing exactly: a contiguous row-major,
 * MSB-first 1-bpp stream where pixel (x, y) is bit `y*w + x` (`b64`), or a
 * comma-joined `<count>x<0|1>` run list in the same row-major order (`rle`). An
 * unknown encoding or non-positive dimensions yield a blank grid; a short payload
 * leaves the unspecified pixels OFF. Never throws.
 */
export function decodeFramebuffer(fb: {
  w: number
  h: number
  encoding: string
  data: string
}): PixelGrid {
  const w = Math.max(0, Math.floor(fb.w) || 0)
  const h = Math.max(0, Math.floor(fb.h) || 0)
  const count = w * h
  let bits: boolean[]
  if (fb.encoding === 'b64') bits = decodeB64Bits(fb.data, count)
  else if (fb.encoding === 'rle') bits = decodeRleBits(fb.data, count)
  else return blankGrid(w, h)

  const pixels: boolean[][] = []
  for (let y = 0; y < h; y++) {
    const row = new Array<boolean>(w).fill(false)
    for (let x = 0; x < w; x++) row[x] = bits[y * w + x] === true
    pixels.push(row)
  }
  return { w, h, pixels }
}

/**
 * Lay out text `rows` into a fixed `cols × rows` character grid: each line is
 * padded with spaces (right) or truncated to exactly `cols` chars, and the line
 * count is padded with blank rows / truncated to exactly `rows`. Used for the
 * character-LCD mirror and as the text fallback for a graphic display.
 */
export function layoutText(
  inputRows: readonly string[] | undefined,
  cols: number,
  rows: number
): CharGrid {
  const safeCols = Math.max(0, Math.floor(cols) || 0)
  const safeRows = Math.max(0, Math.floor(rows) || 0)
  const src = inputRows ?? []
  const lines: string[] = []
  for (let r = 0; r < safeRows; r++) {
    const raw = src[r] ?? ''
    lines.push(fitLine(raw, safeCols))
  }
  return { cols: safeCols, rows: safeRows, lines }
}

/** Pad (right) or truncate a single string to EXACTLY `cols` characters. */
export function fitLine(text: string, cols: number): string {
  const n = Math.max(0, Math.floor(cols) || 0)
  const s = text ?? ''
  if (s.length >= n) return s.slice(0, n)
  return s + ' '.repeat(n - s.length)
}

/**
 * Encode one row as a single ASCII token for the wire: spaces → `_`, mirroring
 * the device `instruments._scr_token` so a row stays one space-delimited token.
 */
export function encodeRowToken(row: string): string {
  return (row ?? '').replace(/ /g, '_')
}

/**
 * Build the `screen` CONTROL payload pushed via `sendControl('screen', payload)`.
 *
 * The payload mirrors the device's own `SNK SCR <addr> text <row> …` telemetry
 * grammar (the part after `<addr>`), so an on-device `screen` control handler can
 * decode the rows with the SAME `_`→space rule the IDE uses for the echo:
 *
 *   text <row> [<row> …]                      (default, no addr)
 *   addr=<addr> text <row> [<row> …]          (when `addr` is given)
 *
 * Each row is `_`-encoded (spaces → `_`) and, when `cols` is provided, fitted to
 * exactly `cols` chars first so the pushed rows match the previewed layout. Empty
 * input yields a bare `text` (clear the display). The `target` ('screen') is NOT
 * included here — `buildControlLine(target, payload)` prepends it.
 */
export function buildScreenPayload(
  rows: readonly string[],
  opts: { addr?: string; cols?: number } = {}
): string {
  const fitted = opts.cols && opts.cols > 0 ? rows.map((r) => fitLine(r, opts.cols as number)) : rows
  const toks = fitted.map(encodeRowToken)
  const prefix = opts.addr ? `addr=${opts.addr} text` : 'text'
  return toks.length > 0 ? `${prefix} ${toks.join(' ')}` : prefix
}

/**
 * Reduce a {@link ScreenTelemetry} reading into the panel's render model: either
 * a decoded pixel grid (an `fb` reading) or a character grid (a `text` reading),
 * tagged so the view can pick its renderer. Returns `null` for an empty/odd
 * reading. Pure — the panel calls this from its telemetry callback.
 */
export type ScreenView =
  | { mode: 'pixels'; grid: PixelGrid; addr: string }
  | { mode: 'text'; rows: string[]; addr: string }

export function readingToView(r: ScreenTelemetry): ScreenView | null {
  if (r.framebuffer) {
    return { mode: 'pixels', grid: decodeFramebuffer(r.framebuffer), addr: r.addr }
  }
  if (r.rows) {
    return { mode: 'text', rows: r.rows.slice(), addr: r.addr }
  }
  return null
}

/** Format a frames-per-second estimate from an interval in ms (for the readout). */
export function fpsFromIntervalMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '——'
  const fps = 1000 / ms
  if (fps >= 100) return String(Math.round(fps))
  return fps.toFixed(1)
}
