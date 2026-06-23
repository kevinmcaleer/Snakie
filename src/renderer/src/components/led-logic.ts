/**
 * LED PANEL LOGIC (#114) — the pure, DOM-free payload builders behind the LED
 * instrument (the WRITE panel).
 * =============================================================================
 *
 * The LED panel drives an output by WRITING an IDE→board control line
 * (`SNKCMD led <payload>\n`, issue #115) via `window.api.device.sendControl`.
 * This module builds the `<payload>` strings so they MATCH the on-device
 * receiver grammar — the `Led` class in `micropython/instruments.py`, whose
 * methods are the source of truth, paired with the attested wire lines:
 *
 *   - `Led.set(on)`        ← `on`  /  `off`             (digital toggle)
 *   - `Led.pwm(level)`     ← `pwm <0..1>`               (brightness, clamped 0..1)
 *   - `Led.rgb(r, g, b)`   ← `rgb <r> <g> <b>`          (three 0..255 channels)
 *
 * The DIGITAL form is the bare `on` / `off` payload — pinned by the docs + tests
 * (`control.feed("SNKCMD led on\n")` in `docs/instruments-library.md`,
 * `terminalTelemetry.test.ts`, `python/tests/test_instruments.py`), NOT `set on`.
 * The PWM form is the canonical `SNKCMD led pwm 0.5` (`docs/instruments-library.md`
 * + `snakieControl.test.ts`). The RGB form mirrors `Led.rgb(r,g,b)`'s 0..255
 * channels (the method is attested; no example pins the exact wire spelling, so
 * `rgb <r> <g> <b>` is the obvious mirror).
 *
 * The board's `Led` receiver has no NeoPixel/WS2812 strip or animation handler
 * today, so for the strip + animation controls we extend the SAME space-delimited
 * grammar in the obvious forward-compatible way — a `strip` sub-command of
 * per-pixel hex colours and an `anim` sub-command of `<name> [args]` — keeping the
 * existing `set`/`pwm`/`rgb` words exactly as the device parses them. These
 * builders are the deliverable; a future `control.on('led', …)` dispatcher can
 * route the same tokens to a `neopixel` driver.
 *
 * Kept React/DOM-free (pure string/number work, nothing throws) so it is
 * unit-testable in node — mirrors `snakie-control.ts`, `instrument-data.ts`.
 */

/** The control target every LED payload is sent under (`sendControl('led', …)`). */
export const LED_TARGET = 'led'

/** An RGB colour as three 0..255 integer channels. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** Clamp `n` into `[lo, hi]` (NaN → `lo`). */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

/** Round + clamp a value to an integer 0..255 channel. */
function toChannel(n: number): number {
  return Math.round(clamp(n, 0, 255))
}

/** Format a 0..1 level for the wire: trimmed to 3dp, no trailing zeros, clamped. */
export function formatLevel(level: number): string {
  const v = clamp(level, 0, 1)
  // 3dp is plenty for an 8/16-bit duty; strip trailing zeros so `0.5` stays `0.5`.
  return parseFloat(v.toFixed(3)).toString()
}

// --- Single-LED payloads (match the device `Led` class methods) -------------

/** `on` / `off` — the digital LED toggle (`Led.set(on)`; attested wire form). */
export function digitalPayload(on: boolean): string {
  return on ? 'on' : 'off'
}

/** `pwm <0..1>` — the PWM brightness (`Led.pwm(level)`); level clamped to 0..1. */
export function pwmPayload(level: number): string {
  return `pwm ${formatLevel(level)}`
}

/** `rgb <r> <g> <b>` — three 0..255 channels (`Led.rgb(r, g, b)`). */
export function rgbPayload({ r, g, b }: Rgb): string {
  return `rgb ${toChannel(r)} ${toChannel(g)} ${toChannel(b)}`
}

// --- NeoPixel / WS2812 strip payloads (forward-compatible extension) --------

/**
 * `strip <hex> <hex> …` — set per-pixel colours on a NeoPixel/WS2812 strip.
 * Each pixel is a `#rrggbb` hex token (lower-case, always 6 digits) so the line
 * stays whitespace-delimited and round-trips through `hexToRgb`. An empty list
 * yields a bare `strip` (clear / no-op). Pure.
 */
export function stripPayload(pixels: string[]): string {
  const toks = pixels.map((p) => rgbToHex(hexToRgb(p)))
  return toks.length === 0 ? 'strip' : `strip ${toks.join(' ')}`
}

/**
 * `anim <name> [args…]` — drive a simple built-in strip animation. `name` is a
 * single token (interior whitespace hyphen-joined); `args` are appended verbatim
 * (e.g. a speed or a hex colour). Pure.
 */
export function animPayload(name: string, args: Array<string | number> = []): string {
  const n = name.trim().split(/\s+/).filter(Boolean).join('-') || 'off'
  const rest = args.map((a) => String(a)).filter((a) => a.length > 0)
  return rest.length === 0 ? `anim ${n}` : `anim ${n} ${rest.join(' ')}`
}

// --- Colour conversion ------------------------------------------------------

/**
 * Parse a `#rgb` / `#rrggbb` (or un-hashed) hex string into an {@link Rgb}.
 * Tolerant: bad / short input falls back to black (`0,0,0`); a 3-digit shorthand
 * is expanded (`#0af` → `00aaff`). Never throws. Pure.
 */
export function hexToRgb(hex: string): Rgb {
  const h = (hex ?? '').trim().replace(/^#/, '').toLowerCase()
  let full = h
  if (/^[0-9a-f]{3}$/.test(h)) {
    full = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (!/^[0-9a-f]{6}$/.test(full)) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  }
}

/**
 * Format an {@link Rgb} as a `#rrggbb` hex string (lower-case, channels clamped
 * to 0..255 then 2-digit zero-padded). Pure; the inverse of {@link hexToRgb} for
 * any in-range, full-form colour.
 */
export function rgbToHex({ r, g, b }: Rgb): string {
  const hx = (n: number): string => toChannel(n).toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

/** The LED panel's output modes (the readout `MODE` cell + which payload to build). */
export type LedMode = 'digital' | 'pwm' | 'rgb' | 'strip'
