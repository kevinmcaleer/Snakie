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
  /** `pixel` = a graphic OLED/TFT (framebuffer); `char` = an HD44780 character LCD. */
  type: 'pixel' | 'char'
  /** The wire bus: `i2c` (SSD1306/HD44780) or `spi` (ST7789 TFT). Default `i2c`. */
  bus: 'i2c' | 'spi'
  /** The chip label shown in the wiring header (e.g. `SSD1306`, `ST7789`). */
  driver: 'ssd1306' | 'hd44780' | 'st7789'
  /** Pixel displays: width/height in px. */
  w?: number
  h?: number
  /** Character displays: columns × rows of characters. */
  cols?: number
  charRows?: number
}

/**
 * The configurable geometries (#118): SSD1306/SH1106 graphic OLEDs and HD44780
 * character LCDs over an I²C backpack, plus ST7789 colour TFTs over SPI. Order =
 * the picker order; the first is the default (the common 128×64 SSD1306).
 *
 * The ST7789 variants (240×240 / 240×320 / 135×240 / 170×320) are `bus: 'spi'`, so
 * the panel swaps its wiring to the SPI pin selectors (SCK / MOSI / DC / RST / CS)
 * and drops the I²C address; their `w`/`h` are pushed to the board so the on-device
 * ST7789 driver initialises at the right resolution.
 */
export const DISPLAY_GEOMETRIES: DisplayGeometry[] = [
  { id: 'oled-128x64', label: 'OLED 128×64', type: 'pixel', bus: 'i2c', driver: 'ssd1306', w: 128, h: 64 },
  { id: 'oled-128x32', label: 'OLED 128×32', type: 'pixel', bus: 'i2c', driver: 'ssd1306', w: 128, h: 32 },
  { id: 'lcd-16x2', label: 'LCD 16×2', type: 'char', bus: 'i2c', driver: 'hd44780', cols: 16, charRows: 2 },
  { id: 'lcd-20x4', label: 'LCD 20×4', type: 'char', bus: 'i2c', driver: 'hd44780', cols: 20, charRows: 4 },
  { id: 'tft-240x240', label: 'TFT 240×240', type: 'pixel', bus: 'spi', driver: 'st7789', w: 240, h: 240 },
  { id: 'tft-240x320', label: 'TFT 240×320', type: 'pixel', bus: 'spi', driver: 'st7789', w: 240, h: 320 },
  { id: 'tft-135x240', label: 'TFT 135×240', type: 'pixel', bus: 'spi', driver: 'st7789', w: 135, h: 240 },
  { id: 'tft-170x320', label: 'TFT 170×320', type: 'pixel', bus: 'spi', driver: 'st7789', w: 170, h: 320 }
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

// ---------------------------------------------------------------------------
// RP2040 I²C SDA/SCL pin mux — the basis for the panel's INVALID-PIN warning.
// Mirrors `micropython/instruments.py::_i2c_block_for_pins` exactly: each I²C
// block exposes SDA/SCL on a fixed set of GPIOs, and a pair is VALID iff BOTH
// pins live in the SAME block (SDA from its SDA set AND SCL from its SCL set):
//
//   I2C0 — SDA ∈ {0,4,8,12,16,20},  SCL ∈ {1,5,9,13,17,21}
//   I2C1 — SDA ∈ {2,6,10,14,18,26}, SCL ∈ {3,7,11,15,19,27}
// ---------------------------------------------------------------------------

const I2C0_SDA = new Set([0, 4, 8, 12, 16, 20])
const I2C0_SCL = new Set([1, 5, 9, 13, 17, 21])
const I2C1_SDA = new Set([2, 6, 10, 14, 18, 26])
const I2C1_SCL = new Set([3, 7, 11, 15, 19, 27])

/**
 * The RP2040 I²C block (`0` or `1`) a `(sda, scl)` pair selects, or `null` when
 * the pair is invalid. A pair is valid only when both pins belong to the SAME
 * block's SDA/SCL sets; any cross-block pair or an unknown pin yields `null`.
 * Pure — backs both {@link i2cPinsValid} and the panel's pin warning.
 */
export function i2cBlockForPins(sda: number, scl: number): 0 | 1 | null {
  if (I2C0_SDA.has(sda) && I2C0_SCL.has(scl)) return 0
  if (I2C1_SDA.has(sda) && I2C1_SCL.has(scl)) return 1
  return null
}

/** Whether `(sda, scl)` is a valid RP2040 I²C pin pair (see {@link i2cBlockForPins}). */
export function i2cPinsValid(sda: number, scl: number): boolean {
  return i2cBlockForPins(sda, scl) !== null
}

// ---------------------------------------------------------------------------
// RP2040 SPI SCK/MOSI(TX) pin mux — the basis for the ST7789 panel's INVALID-PIN
// warning (mirrors `micropython/instruments.py::_spi_block_for_pins`). Each SPI
// block drives SCK/TX on a fixed set of GPIOs; a pair is VALID iff BOTH pins live
// in the SAME block (SCK from its SCK set AND MOSI from its TX set). DC/RST/CS are
// plain GPIOs (any pin), so only the SCK+MOSI pair is mux-constrained:
//
//   SPI0 — SCK ∈ {2,6,18,22}, MOSI ∈ {3,7,19,23}
//   SPI1 — SCK ∈ {10,14,26},  MOSI ∈ {11,15,27}
// ---------------------------------------------------------------------------

const SPI0_SCK = new Set([2, 6, 18, 22])
const SPI0_TX = new Set([3, 7, 19, 23])
const SPI1_SCK = new Set([10, 14, 26])
const SPI1_TX = new Set([11, 15, 27])

/**
 * The RP2040 SPI block (`0` or `1`) a `(sck, mosi)` pair selects, or `null` when
 * the pair is invalid. Valid only when both pins belong to the SAME block's
 * SCK/TX sets; any cross-block pair or unknown pin yields `null`. Pure — backs
 * both {@link spiPinsValid} and the ST7789 panel's pin warning.
 */
export function spiBlockForPins(sck: number, mosi: number): 0 | 1 | null {
  if (SPI0_SCK.has(sck) && SPI0_TX.has(mosi)) return 0
  if (SPI1_SCK.has(sck) && SPI1_TX.has(mosi)) return 1
  return null
}

/** Whether `(sck, mosi)` is a valid RP2040 SPI pin pair (see {@link spiBlockForPins}). */
export function spiPinsValid(sck: number, mosi: number): boolean {
  return spiBlockForPins(sck, mosi) !== null
}

/** A whole, non-negative GPIO number (defaults to `fallback` for a non-finite input). */
function gpio(n: number, fallback = 0): number {
  return Math.max(0, Math.round(Number.isFinite(n) ? n : fallback))
}

/**
 * The `<payload>` that (re)targets an ST7789 SPI display:
 * `spi <sck> <mosi> <dc> <rst> <cs> <w> <h>`. Every pin is a whole GPIO number,
 * except `rst` and `cs`, which may each be `-1` to mean **tied** (no reset / no
 * chip-select pin driven) — e.g. the Pimoroni Pico Explorer has no reset GPIO.
 * `w`/`h` (≥1) tell the on-device driver the panel resolution. Pass to
 * `sendControl('screen', screenSpiPayload(...))` → the device sees
 * `SNKCMD screen spi …`.
 */
export function screenSpiPayload(
  sck: number,
  mosi: number,
  dc: number,
  rst: number,
  cs: number,
  w: number,
  h: number
): string {
  const rstTok = rst < 0 ? -1 : gpio(rst)
  const csTok = cs < 0 ? -1 : gpio(cs)
  const ww = Math.max(1, Math.round(Number.isFinite(w) ? w : 1))
  const hh = Math.max(1, Math.round(Number.isFinite(h) ? h : 1))
  return `spi ${gpio(sck)} ${gpio(mosi)} ${gpio(dc)} ${rstTok} ${csTok} ${ww} ${hh}`
}

// ---------------------------------------------------------------------------
// Screen control payload + code-sync (mirrors range-logic's pin sync) — the
// on-device receiver (`micropython/instruments.py` `Display` + `screen_command`)
// attests the `screen` control grammar the panel WRITES:
//
//     SNKCMD screen pins <sda> <scl>           # retarget the I²C SDA/SCL pins
//     SNKCMD screen addr <0xNN>                # set the I²C address
//
// `screenPinsPayload(sda, scl)` produces the `<payload>` half;
// `sendControl('screen', payload)` frames the `SNKCMD screen …` line. The two
// code-sync helpers read/rewrite the demo's `SCREEN_SDA`/`SCREEN_SCL` (or a
// `screen_sda=`/`screen_scl=` kwarg) so the panel can warn on + fix a mismatch.
// ---------------------------------------------------------------------------

/** An SDA/SCL pin pair read out of source code; `null` for an absent/symbolic one. */
export interface ScreenPins {
  sda: number | null
  scl: number | null
}

/**
 * The `<payload>` that retargets the display's SDA/SCL pins: `pins <sda> <scl>`.
 * Each pin is rounded to a whole, non-negative GPIO number. Pass to
 * `sendControl('screen', screenPinsPayload(0, 1))` → the device sees
 * `SNKCMD screen pins 0 1`.
 */
export function screenPinsPayload(sda: number, scl: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sda) ? sda : 0))
  const c = Math.max(0, Math.round(Number.isFinite(scl) ? scl : 0))
  return `pins ${s} ${c}`
}

/**
 * The `<payload>` that sets the display's I²C address: `addr <0xNN>` (the address
 * is normalised to a clean lowercase `0xNN` literal). Pass to
 * `sendControl('screen', screenAddrPayload('0x3C'))` → `SNKCMD screen addr 0x3c`.
 */
export function screenAddrPayload(addr: string): string {
  const parsed = addr ? Number(/^0x/i.test(addr) ? addr : `0x${addr}`) : NaN
  const n = Number.isFinite(parsed) ? parsed : 0x3c
  return `addr 0x${n.toString(16)}`
}

/**
 * The regex matching a `SCREEN_SDA = <digits>` (or `screen_sda=<digits>`)
 * declaration, with the value captured. Case-insensitive, whitespace-tolerant.
 * Built per-role so {@link findScreenPinsInCode} / {@link setScreenPinsInCode}
 * agree on the grammar. Not `/g` — both helpers act on the FIRST match of each role.
 */
const SCREEN_SDA_RE = /screen_sda\s*=\s*([0-9]+)/i
const SCREEN_SCL_RE = /screen_scl\s*=\s*([0-9]+)/i

/**
 * Find the numeric SDA + SCL pins declared by `SCREEN_SDA = <digits>` /
 * `SCREEN_SCL = <digits>` (or the lowercase `screen_sda=`/`screen_scl=` kwarg) in
 * `source`. Case-insensitive; tolerant of whitespace around the `=`. Returns the
 * FIRST such pin per role as a number, or `null` for a role the code declares no
 * numeric value for (including symbolic values like `screen_sda=SCREEN_SDA`).
 * Pure, never throws.
 */
export function findScreenPinsInCode(source: string): ScreenPins {
  if (!source) return { sda: null, scl: null }
  const s = SCREEN_SDA_RE.exec(source)
  const c = SCREEN_SCL_RE.exec(source)
  return {
    sda: s ? Number(s[1]) : null,
    scl: c ? Number(c[1]) : null
  }
}

/**
 * Rewrite the FIRST `SCREEN_SDA = <digits>` AND `SCREEN_SCL = <digits>` assignments
 * in `source` to `sda` / `scl`, preserving the surrounding text (and the author's
 * spacing + casing around each `=`). A role with no numeric match is left untouched
 * (nothing to sync). Each new pin is rounded to a whole, non-negative GPIO number.
 * Pure, never mutates — backs the panel's one-click "Update code". Mirrors
 * {@link setRangePinsInCode}.
 */
export function setScreenPinsInCode(source: string, sda: number, scl: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sda) ? sda : 0))
  const c = Math.max(0, Math.round(Number.isFinite(scl) ? scl : 0))
  const replaceValue = (value: number) => (matched: string, digits: string): string => {
    const numStart = matched.lastIndexOf(digits)
    return matched.slice(0, numStart) + String(value)
  }
  let out = source.replace(SCREEN_SDA_RE, replaceValue(s))
  out = out.replace(SCREEN_SCL_RE, replaceValue(c))
  return out
}
