/**
 * THE EMBED'S PINS (#1318) — which pins a program uses, on which lines, and
 * what the simulated board says they are doing.
 *
 * Pure: no DOM, no React. `parsePins` (the full app's pin reader) says what is
 * wired; this file adds what the board strip needs on top of it: the line each
 * pin is set up on, the lines that use its variable, whether the pin exists on
 * the chosen board, and the pin-state messages the simulator writes while a
 * program runs.
 */
import { parsePins, type PinType, type UsedPins } from '../components/parse-pins'
import { enumerateBoardPads } from '../components/board-layout'
import type { BoardDefinition } from '../../../shared/board'
import type { RobotDefinition } from '../../../shared/robot'
import { boardWiring, type WiredTo } from '../../../shared/wiring-pins'

/** A pin token resolved against a board. */
export interface ResolvedPin {
  /** Stable key: the pad's silk label (`GP15`), `LED`, or the label it would have. */
  id: string
  /** Index into `enumerateBoardPads(def)`; null for the onboard LED and for a pin that isn't there. */
  padIndex: number | null
  led: boolean
  onBoard: boolean
}

const PIN_NAME_RE = /^(gp|gpio|io|d|a)\d+$/i

/** The letters the board's GPIO labels start with (`GP` on a Pico, `IO` on an ESP32). */
function gpioPrefix(def: BoardDefinition): string {
  for (const { pad } of enumerateBoardPads(def)) {
    if (typeof pad.gpio !== 'number') continue
    const m = /^([A-Za-z]+)\d+$/.exec(pad.label)
    if (m) return m[1]
  }
  return 'GP'
}

/**
 * Resolve what the code (or the simulator) calls a pin: a GPIO number, a silk
 * label, or the onboard LED. Null when the token is not a pin at all, such as a
 * variable name the parser could not follow.
 */
export function resolvePin(token: string | number, def: BoardDefinition): ResolvedPin | null {
  const t = String(token).trim().replace(/^["']|["']$/g, '')
  if (!t) return null
  const lower = t.toLowerCase()
  if (def.ledLabel && (lower === 'led' || lower === def.ledLabel.toLowerCase())) {
    return { id: 'LED', padIndex: null, led: true, onBoard: true }
  }
  const pads = enumerateBoardPads(def)
  const isNum = /^\d+$/.test(t)
  if (isNum) {
    const num = Number(t)
    const hit = pads.find((p) => p.pad.gpio === num)
    if (hit) return { id: hit.pad.label, padIndex: hit.index, led: false, onBoard: true }
    return { id: `${gpioPrefix(def)}${num}`, padIndex: null, led: false, onBoard: false }
  }
  const hit = pads.find((p) => p.pad.label.toLowerCase() === lower)
  if (hit) return { id: hit.pad.label, padIndex: hit.index, led: false, onBoard: true }
  if (PIN_NAME_RE.test(t)) return { id: t.toUpperCase(), padIndex: null, led: false, onBoard: false }
  return null
}

/** One pin the program uses, as the board strip lists it. */
export interface EmbedPin extends ResolvedPin {
  type: PinType
  /** What it is doing, in words: `Output`, `PWM`, `I2C SDA`. */
  kind: string
  /** The variable it is assigned to, or `''`. */
  variable: string
  /** 1-based lines that set this pin up. */
  setupLines: number[]
  /** 1-based lines that set it up or use its variable. */
  lines: number[]
  /** Two different lines each claim this pin by number. */
  shared: boolean
}

export interface PinProblem {
  line: number
  /** 1-based columns of the offending token, end exclusive. */
  startColumn: number
  endColumn: number
  message: string
}

export interface CodePins {
  pins: EmbedPin[]
  /** Line → the ids of the pins it sets up or uses. */
  byLine: Map<number, string[]>
  problems: PinProblem[]
}

function kindOf(entry: UsedPins, i: number): string {
  const role = entry.roles?.[i]
  switch (entry.type) {
    case 'output':
      return 'Output'
    case 'input':
      return 'Input'
    case 'pwm':
      return 'PWM'
    case 'adc':
      return 'Analogue in'
    case 'i2c':
      return role ? `I2C ${role}` : 'I2C'
    case 'spi':
      return role ? `SPI ${role}` : 'SPI'
    case 'pio':
      return 'PIO'
    case 'instrument':
      return entry.instrument ? entry.instrument.charAt(0).toUpperCase() + entry.instrument.slice(1) : 'Instrument'
  }
}

function stripComment(line: string): string {
  const hash = line.indexOf('#')
  return hash >= 0 ? line.slice(0, hash) : line
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Where a pin token is written on a line: 1-based columns, or null when it came through a variable. */
function tokenSpan(line: string, token: string): { start: number; end: number } | null {
  const code = stripComment(line)
  const m = new RegExp(`(?<![\\w.])["']?${escapeRe(token)}["']?(?![\\w.])`).exec(code)
  if (!m) return null
  return { start: m.index + 1, end: m.index + 1 + m[0].length }
}

/**
 * The pins a program uses on `def`, with their lines. Each line of the source
 * that `parsePins` reads a connection from is matched, in order, to the entry
 * the whole-program parse made for it (which knows directions and variables).
 */
export function pinsInCode(source: string, def: BoardDefinition): CodePins {
  const lines = source.split('\n')
  const entries = parsePins(source)
  const machine = entries.filter((e) => e.type !== 'instrument')
  const located: { entry: UsedPins; line: number }[] = []
  let next = 0
  lines.forEach((text, i) => {
    const count = parsePins(text).filter((e) => e.type !== 'instrument').length
    for (let k = 0; k < count && next < machine.length; k++) located.push({ entry: machine[next++], line: i + 1 })
  })
  for (const entry of entries) {
    if (entry.type !== 'instrument' || !entry.instrument) continue
    const re = new RegExp(`\\b${escapeRe(entry.instrument)}_pin\\s*=`)
    const at = lines.findIndex((l) => re.test(stripComment(l)))
    located.push({ entry, line: at >= 0 ? at + 1 : 1 })
  }

  const byId = new Map<string, EmbedPin>()
  const literalLines = new Map<string, Set<number>>()
  const problems: PinProblem[] = []
  for (const { entry, line } of located) {
    entry.pins.forEach((token, i) => {
      const resolved = resolvePin(token, def)
      if (!resolved) return
      const span = tokenSpan(lines[line - 1] ?? '', token)
      if (span) {
        const set = literalLines.get(resolved.id) ?? new Set<number>()
        set.add(line)
        literalLines.set(resolved.id, set)
        if (!resolved.onBoard) {
          problems.push({
            line,
            startColumn: span.start,
            endColumn: span.end,
            message: `${def.name} has no pin ${resolved.id}.`
          })
        }
      }
      const existing = byId.get(resolved.id)
      if (existing) {
        // A later line says more about the pin: `p = Pin(15)` then `PWM(p)`.
        existing.type = entry.type
        existing.kind = kindOf(entry, i)
        if (entry.variable) existing.variable = entry.variable
        if (!existing.setupLines.includes(line)) existing.setupLines.push(line)
      } else {
        byId.set(resolved.id, {
          ...resolved,
          type: entry.type,
          kind: kindOf(entry, i),
          variable: entry.variable,
          setupLines: [line],
          lines: [],
          shared: false
        })
      }
    })
  }

  // Which variables stand for which pins (every variable a setup line assigned).
  const varPins = new Map<string, Set<string>>()
  for (const { entry } of located) {
    if (!entry.variable) continue
    for (const token of entry.pins) {
      const id = resolvePin(token, def)?.id
      if (!id) continue
      const set = varPins.get(entry.variable) ?? new Set<string>()
      set.add(id)
      varPins.set(entry.variable, set)
    }
  }

  const byLine = new Map<number, string[]>()
  const note = (line: number, id: string): void => {
    const ids = byLine.get(line) ?? []
    if (!ids.includes(id)) ids.push(id)
    byLine.set(line, ids)
  }
  for (const pin of byId.values()) for (const line of pin.setupLines) note(line, pin.id)
  if (varPins.size > 0) {
    const names = new RegExp(`(?<![\\w.])(${[...varPins.keys()].map(escapeRe).join('|')})\\b`, 'g')
    lines.forEach((text, i) => {
      for (const m of stripComment(text).matchAll(names)) {
        for (const id of varPins.get(m[1]) ?? []) note(i + 1, id)
      }
    })
  }
  for (const [line, ids] of byLine) {
    for (const id of ids) byId.get(id)?.lines.push(line)
  }
  for (const pin of byId.values()) pin.lines.sort((a, b) => a - b)

  for (const [id, set] of literalLines) {
    const pin = byId.get(id)
    if (!pin || !pin.onBoard || set.size < 2) continue
    pin.shared = true
    const [first, ...rest] = [...set].sort((a, b) => a - b)
    for (const line of rest) {
      const token = located.find((l) => l.line === line)?.entry.pins.find((t) => resolvePin(t, def)?.id === id)
      const span = token ? tokenSpan(lines[line - 1] ?? '', token) : null
      if (!span) continue
      problems.push({
        line,
        startColumn: span.start,
        endColumn: span.end,
        message: `${id} is already set up on line ${first}.`
      })
    }
  }

  return { pins: [...byId.values()], byLine, problems }
}

// ---------------------------------------------------------------- live state

/** What the simulator says a pin is doing. */
export interface PinEvent {
  /** `p`: a digital level (0 or 1). `w`: a PWM duty, 0 to 65535. */
  kind: 'p' | 'w'
  /** The pin as the program named it: `15`, `GP15`, `LED`. */
  pin: string
  value: number
}

const MARK = '\x1b]7373;'
const END = '\x07'
/** A pin message is short; a longer unfinished one is not ours. */
const MAX_PENDING = 96

/**
 * The simulated `machine` module is asked to report pin changes on stdout
 * ({@link PIN_WATCH_PY}), as OSC escapes: `ESC ] 7373 ; kind ; pin ; value BEL`.
 * This takes them back out of the stream, across chunk boundaries, so the
 * terminal only ever sees the program's own output.
 */
export class PinEventStream {
  private pending = ''

  push(chunk: string): { text: string; events: PinEvent[] } {
    let data = this.pending + chunk
    this.pending = ''
    const events: PinEvent[] = []
    let text = ''
    for (;;) {
      const at = data.indexOf(MARK)
      if (at < 0) break
      const end = data.indexOf(END, at)
      if (end < 0) {
        if (data.length - at > MAX_PENDING) break
        text += data.slice(0, at)
        this.pending = data.slice(at)
        return { text, events }
      }
      text += data.slice(0, at)
      const [kind, pin, value] = data.slice(at + MARK.length, end).split(';')
      const n = Number(value)
      if ((kind === 'p' || kind === 'w') && pin && Number.isFinite(n)) events.push({ kind, pin, value: n })
      data = data.slice(end + 1)
    }
    // Hold back a tail that may be the start of a message.
    for (let keep = Math.min(MARK.length - 1, data.length); keep > 0; keep--) {
      if (MARK.startsWith(data.slice(data.length - keep))) {
        this.pending = data.slice(data.length - keep)
        data = data.slice(0, data.length - keep)
        break
      }
    }
    return { text: text + data, events }
  }
}

/**
 * Turns the reporting on. Run once per interpreter, captured, so it prints
 * nothing and leaves no name behind in the REPL.
 */
export const PIN_WATCH_PY = `
def __snakie_watch_pins():
    import machine
    def tell(kind, pin, value):
        print('\\x1b]7373;%s;%s;%s\\x07' % (kind, pin, value), end='')
    machine._watch = tell
__snakie_watch_pins()
del __snakie_watch_pins
`

/** A pin's live state, as the strip words it: `on`, `off`, `PWM 8%`. */
export function pinStateLabel(event: Pick<PinEvent, 'kind' | 'value'>): string {
  if (event.kind === 'p') return event.value ? 'on' : 'off'
  return `PWM ${Math.round((Math.max(0, Math.min(65535, event.value)) / 65535) * 100)}%`
}

// ------------------------------------------------------------ project wiring

/** A project's wiring, keyed the way the strip keys pins (`GP15`). */
export interface ProjectWiring {
  /** Pin id → what is wired to it. */
  byPin: Map<string, WiredTo[]>
  /** The GPIO pins something is wired to (power and ground left out). */
  signalPins: string[]
}

/** Read a robot definition's wires against a board (#1320). */
export function projectWiring(robot: RobotDefinition | null | undefined, def: BoardDefinition): ProjectWiring {
  const byPin = new Map<string, WiredTo[]>()
  const signalPins: string[] = []
  const pads = enumerateBoardPads(def)
  for (const [name, wired] of boardWiring(robot)) {
    const resolved = resolvePin(name, def)
    if (!resolved) continue
    byPin.set(resolved.id, [...(byPin.get(resolved.id) ?? []), ...wired])
    const pad = resolved.padIndex !== null ? pads[resolved.padIndex]?.pad : null
    if (pad && typeof pad.gpio === 'number' && !signalPins.includes(resolved.id)) signalPins.push(resolved.id)
  }
  return { byPin, signalPins }
}

/** Where the code and the wiring disagree. */
export interface WiringMismatch {
  /** Pins the code uses that nothing is wired to. */
  unwired: string[]
  /** Pins something is wired to that the code never uses. */
  unused: string[]
}

export function wiringMismatch(pins: readonly EmbedPin[], wiring: ProjectWiring): WiringMismatch {
  const used = new Set(pins.map((p) => p.id))
  return {
    // The onboard LED needs no wire.
    unwired: pins.filter((p) => p.onBoard && !p.led && !wiring.byPin.has(p.id)).map((p) => p.id),
    unused: wiring.signalPins.filter((id) => !used.has(id))
  }
}
