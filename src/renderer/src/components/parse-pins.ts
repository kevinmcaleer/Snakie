/**
 * Pure pin-usage parser for the Board View popup.
 *
 * Scans MicroPython source for the common machine-module peripheral
 * constructors and returns the GPIO/label pins each one wires up, grouped by
 * "bus" so the Board View can draw a colour-coded wire from each used header pad
 * to a representative peripheral.
 *
 * It is deliberately best-effort regex (no real Python parse): MicroPython pin
 * wiring is overwhelmingly written as a small set of `X = Ctor(...)` one-liners,
 * and a faithful-enough mapping of variable → constructor → pins is all the
 * visualiser needs. Lines it can't read are simply skipped.
 *
 * Detected forms (per logical line):
 *   - `X = Pin("LED" | n, ...)`                          → digital
 *   - `X = PWM(Pin(n), ...)`                             → pwm
 *   - `X = I2C(id, sda=Pin(a), scl=Pin(b))`             → i2c   (pins a, b)
 *   - `X = SPI(id, sck=Pin(..), mosi=Pin(..), ...)`     → spi   (+ cs/dc Pins)
 *   - `X = StateMachine(n, prog, ...Pin(..))`           → pio
 *
 * Kept React/DOM-free so it can be unit-tested in a plain node environment
 * (mirrors `Plotter.parse.ts`, `OutlinePanel`'s `parseOutline`, etc.).
 */

/** The peripheral bus a connection belongs to (drives wire colour + drawing). */
export type PinBus = 'digital' | 'pwm' | 'i2c' | 'pio' | 'spi'

/** One parsed peripheral connection: a variable wired to one or more pins. */
export interface UsedPins {
  /** Which bus this connection is — picks the wire colour and peripheral. */
  bus: PinBus
  /** The pin labels/numbers used, in source order (e.g. `['2']`, `['0', '1']`). */
  pins: string[]
  /** The assigned variable name (e.g. `led`), or `''` if it wasn't an assignment. */
  variable: string
  /** The (trimmed) constructor source for the table, e.g. `Pin(2, Pin.OUT)`. */
  constructor: string
}

/**
 * Map a bus to the representative peripheral the Board View draws for it.
 * Exported so the component and tests share one source of truth.
 */
export const BUS_PERIPHERAL: Record<PinBus, string> = {
  digital: 'LED',
  pwm: 'SG90 servo',
  i2c: 'BME280',
  pio: 'WS2812',
  spi: 'ST7789 TFT'
}

/** Bus → wire colour, matching the skeuomorph palette in `BoardView.css`. */
export const BUS_COLOR: Record<PinBus, string> = {
  digital: '#f4c542',
  pwm: '#f08a3c',
  i2c: '#33c6d6',
  pio: '#ff5ca8',
  spi: '#b06be0'
}

/**
 * Pull every `Pin(<arg>)` reference out of a fragment, returning the first
 * argument of each (the pin number or quoted label). Handles `machine.Pin(...)`
 * and bare `Pin(...)`. Strips quotes from string labels so `Pin("LED")` → `LED`.
 */
function extractPins(fragment: string): string[] {
  const pins: string[] = []
  const re = /(?:machine\.)?Pin\(\s*("([^"]*)"|'([^']*)'|[^,)\s]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment)) !== null) {
    // Prefer the captured (unquoted) string body; else the raw first token.
    const label = m[2] ?? m[3] ?? m[1]
    pins.push(label.trim())
  }
  return pins
}

/** Find the matched closing `)` for the `(` immediately after `openIdx`. */
function matchParen(src: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Parse `source` into the list of peripheral connections it wires up.
 *
 * Each detected constructor yields one {@link UsedPins}. The scan is line-based
 * but tolerant: comments are stripped, and an assignment without a constructor
 * (or a constructor with no pins) is ignored. Order follows source order.
 */
export function parsePins(source: string): UsedPins[] {
  if (!source) return []
  const out: UsedPins[] = []

  for (const rawLine of source.split('\n')) {
    // Drop trailing comments (naive: a `#` not inside a string is rare in pin
    // wiring one-liners). Skip blank lines fast.
    const hash = rawLine.indexOf('#')
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim()
    if (!line) continue

    // Optional `var =` (or `var: Type =`) prefix; capture the bare name.
    const assign = line.match(/^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(.*)$/)
    const variable = assign ? assign[1] : ''
    const rhs = assign ? assign[2] : line

    // Identify the outermost constructor on the RHS and its argument span.
    const ctor = rhs.match(/(?:machine\.)?(I2C|SPI|PWM|StateMachine|Pin)\s*\(/)
    if (!ctor) continue
    const name = ctor[1]
    const openIdx = rhs.indexOf('(', ctor.index)
    const closeIdx = matchParen(rhs, openIdx)
    const args = closeIdx > openIdx ? rhs.slice(openIdx + 1, closeIdx) : rhs.slice(openIdx + 1)
    const ctorSrc = (closeIdx > openIdx ? rhs.slice(ctor.index, closeIdx + 1) : rhs.slice(ctor.index)).trim()

    let bus: PinBus
    let pins: string[]

    switch (name) {
      case 'I2C':
        bus = 'i2c'
        pins = extractPins(args)
        break
      case 'SPI':
        bus = 'spi'
        // SPI plus any trailing cs=Pin(..)/dc=Pin(..) on the same line.
        pins = extractPins(rhs.slice(openIdx))
        break
      case 'PWM':
        bus = 'pwm'
        pins = extractPins(args)
        break
      case 'StateMachine':
        bus = 'pio'
        pins = extractPins(args)
        break
      case 'Pin':
      default: {
        bus = 'digital'
        // `Pin("LED" | n, ...)` — take the first argument as the pin.
        const first = args.match(/^\s*("([^"]*)"|'([^']*)'|[^,)\s]+)/)
        pins = first ? [(first[2] ?? first[3] ?? first[1]).trim()] : []
        break
      }
    }

    if (pins.length === 0) continue
    out.push({ bus, pins, variable, constructor: ctorSrc })
  }

  return out
}
