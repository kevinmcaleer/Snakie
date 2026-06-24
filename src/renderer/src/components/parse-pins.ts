/**
 * Pure pin-usage parser for the Board View.
 *
 * Scans MicroPython source for the common machine-module peripheral
 * constructors and returns the GPIO/label pins each one wires up, classified by
 * the **connection type** it represents (output / input / pwm / i2c / spi / pio)
 * so the Board View can draw a colour-coded wire from each used header pad to a
 * connection-type badge.
 *
 * It is deliberately best-effort regex (no real Python parse): MicroPython pin
 * wiring is overwhelmingly written as a small set of `X = Ctor(...)` one-liners,
 * and a faithful-enough mapping of variable → constructor → pins is all the
 * visualiser needs. Lines it can't read are simply skipped.
 *
 * Detected forms (per logical line):
 *   - `X = I2C(id, sda=Pin(a), scl=Pin(b))`             → i2c   (pins a, b)
 *   - `X = SPI(id, sck=Pin(..), mosi=Pin(..), ...)`     → spi   (+ cs/dc Pins)
 *   - `X = PWM(Pin(n), ...)`                            → pwm
 *   - `X = ADC(Pin(n))` / `ADC(n)` / `machine.ADC(...)` → adc   (analog input)
 *   - `X = StateMachine(n, prog, ...Pin(..))`           → pio
 *   - `X = Pin("LED" | n, ...)`                         → output | input (see below)
 *
 * Direction inference for a bare `Pin(...)`:
 *   1. If the constructor args name a direction — `Pin.OUT` / `mode=Pin.OUT`, or
 *      a bare `OUT` as the 2nd positional (e.g. `Pin(15, Pin.OUT)`) → `output`.
 *   2. Else `Pin.IN` / `mode=Pin.IN` (incl. with `PULL_UP`/`PULL_DOWN`) → `input`.
 *   3. Else (undirected `Pin(15)`): infer from how the assigned variable is used
 *      LATER in the whole source — a write API (`.on()` / `.off()` / `.high()` /
 *      `.low()` / `.toggle()` / `.value(<arg>)`) ⇒ `output`; a read
 *      (`.value()` with no arg) ⇒ `input`.
 *   4. Fallback: still ambiguous ⇒ `output` (most setup code drives outputs).
 *
 * Kept React/DOM-free so it can be unit-tested in a plain node environment
 * (mirrors `Plotter.parse.ts`, `OutlinePanel`'s `parseOutline`, etc.).
 */

/**
 * The kind of connection a wired pin is — drives the wire colour + badge.
 *
 * `instrument` is a pin the program does NOT wire directly with a `machine`
 * constructor but instead HANDS to the `instruments` library (e.g.
 * `inst.start(buzzer_pin=15)`), so the library owns the `PWM(Pin(...))` for it.
 * It still resolves to a real header pad and is surfaced as "in use".
 */
export type PinType = 'output' | 'input' | 'pwm' | 'adc' | 'i2c' | 'spi' | 'pio' | 'instrument'

/** One parsed connection: a variable wired to one or more pins. */
export interface UsedPins {
  /** Which connection type this is — picks the wire colour and badge label. */
  type: PinType
  /** The pin labels/numbers used, in source order (e.g. `['2']`, `['0', '1']`). */
  pins: string[]
  /** The assigned variable name (e.g. `led`), or `''` if it wasn't an assignment. */
  variable: string
  /** The (trimmed) constructor source for the table, e.g. `Pin(2, Pin.OUT)`. */
  constructor: string
  /**
   * For an `instrument`-type connection, WHICH instrument owns the pin (e.g.
   * `buzzer` from `buzzer_pin=15`). Lets the Board View badge name the device.
   * Absent for ordinary `machine`-module connections.
   */
  instrument?: string
}

/** Connection type → wire/badge colour (matches the skeuomorph palette). */
export const PIN_TYPE_COLOR: Record<PinType, string> = {
  output: '#f4c542',
  input: '#4a9fe0',
  pwm: '#f08a3c',
  adc: '#34c0a8',
  i2c: '#33c6d6',
  spi: '#b06be0',
  pio: '#ff5ca8',
  // A warm amber-gold, distinct from PWM's orange — instrument-owned pins.
  instrument: '#e8b34a'
}

/** Connection type → the UPPERCASE label drawn on the badge + in the table. */
export const PIN_TYPE_LABEL: Record<PinType, string> = {
  output: 'OUTPUT',
  input: 'INPUT',
  pwm: 'PWM',
  adc: 'ADC',
  i2c: 'I2C',
  spi: 'SPI',
  pio: 'PIO',
  instrument: 'INST'
}

/**
 * Connection type → the SHORT tag drawn inline on a node-graph card
 * (the {@link PIN_TYPE_LABEL} full words are too wide for the 36px-tall node).
 * `output`/`input` shorten to `OUT`/`IN`; `i2c` uses the typographic `I²C`.
 */
export const PIN_TYPE_TAG: Record<PinType, string> = {
  output: 'OUT',
  input: 'IN',
  pwm: 'PWM',
  adc: 'ADC',
  i2c: 'I²C',
  spi: 'SPI',
  pio: 'PIO',
  instrument: '⚙'
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
 * Decide the direction of an undirected `Pin(n)` from how its assigned variable
 * is used across the whole `source`. A write-style call (`.on()` / `.off()` /
 * `.high()` / `.low()` / `.toggle()` / `.value(<arg>)`) ⇒ output; a bare-read
 * `.value()` ⇒ input; nothing decisive ⇒ output (the documented fallback).
 */
function inferDirection(variable: string, source: string): 'output' | 'input' {
  if (!variable) return 'output'
  // Escape the variable for use in a regex, then look for `<var>.<method>(...)`.
  const v = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Write API: .on()/.off()/.high()/.low()/.toggle() (any args), or .value(<non-empty>).
  const writeRe = new RegExp(
    `\\b${v}\\s*\\.\\s*(?:on|off|high|low|toggle)\\s*\\(|\\b${v}\\s*\\.\\s*value\\s*\\(\\s*[^)\\s]`
  )
  if (writeRe.test(source)) return 'output'
  // Read API: .value() with no argument (a read).
  const readRe = new RegExp(`\\b${v}\\s*\\.\\s*value\\s*\\(\\s*\\)`)
  if (readRe.test(source)) return 'input'
  return 'output'
}

/**
 * Classify a bare `Pin(...)` constructor by direction.
 *
 * Reads the constructor `args` for an explicit `Pin.OUT` / `Pin.IN` (named or as
 * a bare `OUT`/`IN` 2nd positional), else infers from later usage of `variable`
 * across `source` (see {@link inferDirection}).
 */
function classifyPin(args: string, variable: string, source: string): 'output' | 'input' {
  // Explicit direction in the constructor wins. Match `Pin.OUT`, `mode=Pin.OUT`,
  // or a bare `OUT` token (2nd positional, e.g. `Pin(15, OUT)` / `Pin(15, Pin.OUT)`).
  if (/\bPin\.OUT\b|\bmode\s*=\s*(?:\w+\.)?OUT\b|,\s*(?:\w+\.)?OUT\b/.test(args)) return 'output'
  if (/\bPin\.IN\b|\bmode\s*=\s*(?:\w+\.)?IN\b|,\s*(?:\w+\.)?IN\b/.test(args)) return 'input'
  return inferDirection(variable, source)
}

// --- Instrument-library pins ------------------------------------------------

/** One instrument-owned pin: which GPIO number, and which instrument drives it. */
export interface InstrumentPin {
  /** The GPIO/pin number the kwarg names (e.g. `15` from `buzzer_pin=15`). */
  pin: string
  /** The instrument the pin powers (e.g. `buzzer` from `buzzer_pin=15`). */
  instrument: string
}

/**
 * Detect pins the program hands to the `instruments` library rather than wiring
 * directly — so they still light up on the board. We match a `<owner>_<role>=<int>`
 * shape ANYWHERE in the source, where `<role>` is `pin` (single-pin devices like
 * the buzzer) OR `trig` / `echo` (the two pins of an HC-SR04 rangefinder). This
 * matches both the `inst.start(buzzer_pin=15)` / `inst.start(range_trig=3, …)`
 * keywords AND a module constant like `BUZZER_PIN = 0` / `RANGE_TRIG = 3` that the
 * program then passes by name (common in the demos, where the kwarg value isn't a
 * literal so only the constant carries the number).
 *
 * The **owner** stem before `_pin` / `_trig` / `_echo` names the instrument
 * (`buzzer_pin`/`BUZZER_PIN` ⇒ `buzzer`; `range_trig`/`RANGE_ECHO` ⇒ `range`),
 * matched case-insensitively and lower-cased. The value must be a bare **integer**
 * — a `Pin(15)` / variable expression isn't a library-owned raw pin and is skipped
 * (the normal `machine`-constructor scan handles real `Pin`s). Results are de-duped
 * by instrument+pin, so a rangefinder's distinct trig + echo pins both surface.
 * Pure + DOM-free for unit tests.
 */
export function parseInstrumentPins(source: string): InstrumentPin[] {
  if (!source) return []
  const out: InstrumentPin[] = []
  const seen = new Set<string>()
  const re = /\b([A-Za-z_]\w*?)_(?:pin|trig|echo)\s*=\s*(\d+)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const instrument = m[1].toLowerCase()
    const pin = m[2]
    const key = `${instrument}:${pin}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ instrument, pin })
  }
  return out
}

/**
 * Parse `source` into the list of connections it wires up.
 *
 * Each detected constructor yields one {@link UsedPins}. The scan is line-based
 * but tolerant: comments are stripped, and an assignment without a constructor
 * (or a constructor with no pins) is ignored. Order follows source order.
 * Undirected `Pin(n)` direction is inferred from later use of the variable
 * across the full source, defaulting to `output` when ambiguous.
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
    // ADC sits before the bare `Pin` fallback so `ADC(Pin(26))` reads as adc.
    const ctor = rhs.match(/(?:machine\.)?(I2C|SPI|PWM|ADC|StateMachine|Pin)\s*\(/)
    if (!ctor) continue
    const name = ctor[1]
    const openIdx = rhs.indexOf('(', ctor.index)
    const closeIdx = matchParen(rhs, openIdx)
    const args = closeIdx > openIdx ? rhs.slice(openIdx + 1, closeIdx) : rhs.slice(openIdx + 1)
    const ctorSrc = (closeIdx > openIdx ? rhs.slice(ctor.index, closeIdx + 1) : rhs.slice(ctor.index)).trim()

    let type: PinType
    let pins: string[]

    switch (name) {
      case 'I2C':
        type = 'i2c'
        pins = extractPins(args)
        break
      case 'SPI':
        type = 'spi'
        // SPI plus any trailing cs=Pin(..)/dc=Pin(..) on the same line.
        pins = extractPins(rhs.slice(openIdx))
        break
      case 'PWM':
        type = 'pwm'
        pins = extractPins(args)
        break
      case 'ADC': {
        // `ADC(Pin(26))` / `ADC(Pin('GP26'))` → the wrapped Pin's arg; the bare
        // `ADC(26)` form has no inner Pin(...) so fall back to the 1st argument.
        type = 'adc'
        const wrapped = extractPins(args)
        if (wrapped.length > 0) {
          pins = wrapped
        } else {
          const first = args.match(/^\s*("([^"]*)"|'([^']*)'|[^,)\s]+)/)
          pins = first ? [(first[2] ?? first[3] ?? first[1]).trim()] : []
        }
        break
      }
      case 'StateMachine':
        type = 'pio'
        pins = extractPins(args)
        break
      case 'Pin':
      default: {
        // `Pin("LED" | n, ...)` — take the first argument as the pin, then
        // classify the connection as output vs input.
        const first = args.match(/^\s*("([^"]*)"|'([^']*)'|[^,)\s]+)/)
        pins = first ? [(first[2] ?? first[3] ?? first[1]).trim()] : []
        type = classifyPin(args, variable, source)
        break
      }
    }

    if (pins.length === 0) continue
    out.push({ type, pins, variable, constructor: ctorSrc })
  }

  // Append pins the program hands to the `instruments` library (e.g.
  // `inst.start(buzzer_pin=15)`) — they never appear as a `machine` constructor
  // above, but the pin is in use and should surface on the board as an
  // instrument-owned connection.
  for (const ip of parseInstrumentPins(source)) {
    out.push({
      type: 'instrument',
      pins: [ip.pin],
      variable: ip.instrument,
      constructor: `${ip.instrument}_pin=${ip.pin}`,
      instrument: ip.instrument
    })
  }

  return out
}
