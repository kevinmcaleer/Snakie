/**
 * BOARD LIVE VALUES (pure helpers for streaming real pin state into BoardGraph)
 * =============================================================================
 *
 * Pure, DOM-free logic for issue #97 — turn the node-graph Board View's idle
 * value placeholders into the connected board's REAL pin state. Two halves, both
 * unit-tested without a device:
 *
 *   1. {@link buildValueProbe} — given the parsed connections, build ONE compact
 *      MicroPython snippet to run on the device REPL (a single `exec`
 *      round-trip), which prints one sentinel line per connection. Batching all
 *      reads into one snippet keeps port chatter to a single request per poll.
 *
 *   2. {@link parseProbeOutput} — parse that snippet's stdout back into a
 *      `Map<variable, LiveValue>` the component merges into its nodes by
 *      variable. Every per-variable read is wrapped in `try/except` on the
 *      device, so an undefined / not-yet-run variable, a busy bus, or any device
 *      error becomes an `ERR` token → that node falls back to its idle
 *      placeholder. Nothing here ever throws.
 *
 * READ EXPRESSIONS per connection type (the device side):
 *   - `input` / `output` → `<var>.value()` → `0` / `1` (a digital level).
 *   - `pwm`              → `<var>.duty_u16()`, falling back to `<var>.duty()`
 *                          (older PWM API) → the current duty level.
 *   - `adc`              → `<var>.read_u16()` → the 16-bit analog reading (the
 *                          Multimeter derives volts + the 12-bit raw from it).
 *   - `i2c` / `spi` / `pio` → a presence / activity probe (`1 if <var> else 0`):
 *      the object exists in the device's global scope ⇒ "active". We deliberately
 *      do NOT `.scan()` an I²C bus or transfer on SPI — that could disrupt a
 *      running program or a real peripheral; presence is the cheap, safe signal.
 *
 * "ASSERTED / GREEN" RULE (decided per type in {@link liveValueDisplay}):
 *   - `output` → asserted when HIGH (`1`) — a driven output is the active state.
 *   - `input`  → asserted when HIGH (`1`). NOTE: a pull-up button reads `1` at
 *      rest and `0` when pressed, so "asserted = high" is a convention, not a
 *      universal truth; we can't know the wiring, so we treat electrical-high as
 *      asserted uniformly. Documented as a known limitation.
 *   - `pwm`    → asserted when the duty is NON-ZERO (the channel is driving).
 *   - `adc`    → shows the converted voltage (`x.xx V`); asserted above ~50mV so
 *      a pin that's reading a real signal lights green (a grounded pin stays dim).
 *   - `i2c` / `spi` / `pio` → asserted when the bus/object is present ("active").
 *   - Anything unreadable (`ERR`, missing) → idle (dim grey, the placeholder).
 *
 * Mirrors the DOM-free, unit-tested style of {@link ./board-viewport} and
 * {@link ./parse-pins}.
 */

import type { PinType, UsedPins } from './parse-pins'
import { adcFromU16 } from './instrument-data'

/** Sentinel prefix the probe prints before each `index:token` reading line. */
export const PROBE_MARK = '<<SNKV>>'

/** Token the device prints when a read raises (undefined var, busy, error). */
export const PROBE_ERR = 'ERR'

/** A single parsed live reading for one connection (by source index). */
export interface LiveValue {
  /** The parsed numeric reading, or `undefined` when unreadable (→ idle). */
  value?: number
  /** The raw token the device printed (e.g. `'1'`, `'32768'`, `'ERR'`). */
  raw: string
}

/** How a connection's value should render: the text + whether it's "asserted". */
export interface ValueDisplay {
  /** The text shown in the node's value readout. */
  text: string
  /**
   * True when the connection is in its active / asserted state (→ green + glow);
   * false when idle/rest (→ dim grey). Undefined readings are never asserted.
   */
  asserted: boolean
  /** True when we have a real device reading (vs. the idle placeholder). */
  live: boolean
}

/**
 * The MicroPython read-expression for one connection, by type. Returns an
 * expression that evaluates to an int on a healthy device (the `pwm` fallback is
 * handled in {@link buildValueProbe}'s try/except cascade, not here).
 */
function readExpr(type: PinType, variable: string): string {
  switch (type) {
    case 'input':
    case 'output':
      return `${variable}.value()`
    case 'pwm':
      // Primary: 16-bit duty. The fallback to `.duty()` is wired in the snippet.
      return `${variable}.duty_u16()`
    case 'adc':
      // 16-bit analog reading; the Multimeter derives volts + 12-bit raw from it.
      return `${variable}.read_u16()`
    case 'i2c':
    case 'spi':
    case 'pio':
    default:
      // Presence / activity: 1 when the object exists & is truthy, else 0.
      return `(1 if ${variable} else 0)`
  }
}

/**
 * Is `variable` a safe, plausible Python identifier we can interpolate into a
 * device snippet? Guards against parser quirks producing an empty / odd name
 * (e.g. a connection with no `variable`), which we simply skip (→ stays idle).
 */
export function isProbeableVariable(variable: string | undefined): variable is string {
  return !!variable && /^[A-Za-z_]\w*$/.test(variable)
}

/**
 * Build the single MicroPython snippet that reads every probeable connection's
 * value and prints one `PROBE_MARK<index>:<token>` line each. Each read is in its
 * own `try/except` so one undefined / busy variable can't abort the batch — it
 * prints `PROBE_ERR` and the rest still report. Connections without a usable
 * variable are skipped entirely (they keep their idle placeholder).
 *
 * Returns `''` when there's nothing probeable — the caller then skips the device
 * round-trip altogether.
 */
export function buildValueProbe(conns: UsedPins[]): string {
  const lines: string[] = []
  conns.forEach((conn, i) => {
    if (!isProbeableVariable(conn.variable)) return
    const v = conn.variable
    const expr = readExpr(conn.type, v)
    // For PWM, try the 16-bit duty first, then the legacy `.duty()`; any failure
    // (incl. an undefined var) prints ERR. Everything is one compact line so the
    // snippet stays a single tidy block regardless of N.
    if (conn.type === 'pwm') {
      lines.push(
        `try:\n` +
          ` try: __v=${v}.duty_u16()\n` +
          ` except Exception: __v=${v}.duty()\n` +
          ` print('${PROBE_MARK}${i}:'+str(__v))\n` +
          `except Exception: print('${PROBE_MARK}${i}:${PROBE_ERR}')`
      )
    } else {
      lines.push(
        `try: print('${PROBE_MARK}${i}:'+str(${expr}))\n` +
          `except Exception: print('${PROBE_MARK}${i}:${PROBE_ERR}')`
      )
    }
  })
  return lines.join('\n')
}

/**
 * Parse the probe snippet's stdout into a map of source-index → {@link LiveValue}.
 * Only lines carrying {@link PROBE_MARK} are read; everything else (banners,
 * stray prints) is ignored. A non-numeric / `ERR` token yields a `LiveValue`
 * with no `value` (→ idle). Never throws.
 */
export function parseProbeOutput(stdout: string): Map<number, LiveValue> {
  const out = new Map<number, LiveValue>()
  if (!stdout) return out
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf(PROBE_MARK)
    if (at < 0) continue
    const rest = line.slice(at + PROBE_MARK.length)
    const colon = rest.indexOf(':')
    if (colon < 0) continue
    const idx = Number.parseInt(rest.slice(0, colon), 10)
    if (!Number.isInteger(idx)) continue
    const raw = rest.slice(colon + 1).trim()
    const n = Number(raw)
    const value = raw !== '' && raw !== PROBE_ERR && Number.isFinite(n) ? n : undefined
    out.set(idx, { value, raw })
  }
  return out
}

/**
 * Decide how a connection renders given its (possibly missing) live reading.
 * Returns the idle placeholder when there's no usable value, so a disconnected /
 * pre-run / unreadable connection looks exactly like today. See the module
 * docstring for the per-type "asserted / green" rule.
 */
export function liveValueDisplay(type: PinType, live: LiveValue | undefined): ValueDisplay {
  const boolean = type === 'input' || type === 'output'
  // Idle placeholder (no reading): mirrors the original NodeValue — `1` for
  // boolean input/output, `—` for bus/pwm/adc types — dim, never asserted.
  if (!live || live.value === undefined) {
    return { text: boolean ? '1' : '—', asserted: false, live: false }
  }
  const v = live.value
  switch (type) {
    case 'output':
    case 'input':
      // Digital level → `0`/`1`; asserted (green) when electrically HIGH.
      return { text: v ? '1' : '0', asserted: v !== 0, live: true }
    case 'pwm':
      // Show the raw duty level; asserted when the channel is driving (non-zero).
      return { text: String(v), asserted: v !== 0, live: true }
    case 'adc': {
      // Convert the 16-bit reading to volts; asserted above ~50mV (a real signal).
      const { volts } = adcFromU16(v)
      return { text: `${volts.toFixed(2)} V`, asserted: volts > 0.05, live: true }
    }
    case 'i2c':
    case 'spi':
    case 'pio':
    default:
      // Presence/activity: 1 ⇒ active (green), 0 ⇒ idle.
      return { text: v ? 'active' : 'idle', asserted: v !== 0, live: true }
  }
}
