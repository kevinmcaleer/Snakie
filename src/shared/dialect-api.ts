/**
 * WHICH API BELONGS TO WHICH RUNTIME (#763, epic #209).
 * =============================================================================
 *
 * `dialect.ts` answers *what is on the board*. This module answers the next
 * question — *so what should we teach?* — and it is the single table the help
 * tree, the editor completions and the context-help resolver all read, rather
 * than each growing its own `if (dialect === 'circuitpython')` ladder.
 *
 * The two runtimes diverge in exactly the places a beginner reaches first:
 *
 * | | MicroPython | CircuitPython |
 * |---|---|---|
 * | a pin | `machine.Pin(15, Pin.OUT)` | `digitalio.DigitalInOut(board.D15)` |
 * | a delay | `time.sleep_ms(500)` | `time.sleep(0.5)` |
 * | I²C | `machine.I2C(0, …)` | `busio.I2C(board.SCL, board.SDA)` + `try_lock()` |
 *
 * Teaching `from machine import Pin` to somebody holding a CircuitPython board
 * is the failure this exists to prevent — every line of it fails on their board,
 * and nothing tells them why.
 *
 * Pure and dependency-free, like `dialect.ts`, so main, preload, renderer and
 * the tests can all import it.
 *
 * ## Adding to the table
 *
 * Add an {@link ApiEquivalent} row for a concept that differs; the completions'
 * cross-dialect hint, the context-help redirect and the "coming from
 * MicroPython" article all pick it up. If the concept only *exists* on one
 * runtime, put it in that runtime's symbol catalogue instead
 * (`circuitpython-symbols.ts` / `micropython-symbols.ts`) — this table is for
 * things a learner will look for on BOTH and find spelled differently.
 */
import type { Dialect } from './dialect'

/**
 * Which runtimes a module, member or help page belongs to.
 *
 * `'both'` means genuinely identical on each — plain Python (`math`, `json`,
 * control flow) rather than "we didn't check". Anything hardware-shaped is
 * almost never `'both'`.
 */
export type DialectScope = 'both' | 'micropython' | 'circuitpython'

/**
 * Is something with this scope shown to a session running `dialect`?
 *
 * `unknown` is NOT "MicroPython by default" — that assumption is precisely what
 * epic #209 exists to remove, and collapsing it into MicroPython is what caused
 * #770. An unestablished dialect sees EVERYTHING, each item labelled with the
 * runtime it belongs to (see {@link dialectTag}), so nothing is presented as the
 * universal truth and nothing useful is hidden from somebody who hasn't plugged
 * a board in yet.
 */
export function inScope(scope: DialectScope | undefined, dialect: Dialect): boolean {
  if (scope === undefined || scope === 'both') return true
  if (dialect === 'unknown') return true
  return scope === dialect
}

/**
 * The label to hang off an item whose runtime the reader can't otherwise infer.
 * Empty when the dialect is established (saying "MicroPython" on every row of a
 * MicroPython session is noise) or when the item is plain Python.
 */
export function dialectTag(scope: DialectScope | undefined, dialect: Dialect): string {
  if (dialect !== 'unknown') return ''
  if (scope === 'micropython') return 'MicroPython'
  if (scope === 'circuitpython') return 'CircuitPython'
  return ''
}

/** The runtime that isn't this one; `null` when the dialect isn't established. */
export function otherDialect(dialect: Dialect): Dialect | null {
  if (dialect === 'micropython') return 'circuitpython'
  if (dialect === 'circuitpython') return 'micropython'
  return null
}

// --- The manual override ----------------------------------------------------

/**
 * What the user asked the help and completions to teach. `'auto'` follows the
 * connected board; the two explicit values are the override for reading the
 * docs BEFORE plugging anything in — which is when most people read them.
 */
export type DialectPreference = 'auto' | 'micropython' | 'circuitpython'

/** How each preference is offered in the UI. */
export const DIALECT_PREFERENCE_LABEL: Record<DialectPreference, string> = {
  auto: 'Auto',
  micropython: 'MicroPython',
  circuitpython: 'CircuitPython'
}

/**
 * Resolve the dialect the help + completions should teach.
 *
 * `'auto'` follows the board LIVE — the dialect is a property of the thing
 * plugged into the machine, and connecting is the moment you learn it, so help
 * that still taught the other runtime a second later would be stale. With no
 * board (or a board that wouldn't say) `'auto'` resolves to `'unknown'`, which
 * shows both runtimes side by side rather than guessing one.
 */
export function effectiveDialect(
  preference: DialectPreference,
  boardDialect: Dialect | undefined
): Dialect {
  if (preference !== 'auto') return preference
  return boardDialect ?? 'unknown'
}

/** Where the effective dialect came from — drives the caption under the picker. */
export type DialectSource = 'board' | 'manual' | 'none'

/** Which of the three states {@link effectiveDialect} was in. */
export function dialectSource(
  preference: DialectPreference,
  boardDialect: Dialect | undefined
): DialectSource {
  if (preference !== 'auto') return 'manual'
  return boardDialect && boardDialect !== 'unknown' ? 'board' : 'none'
}

// --- The equivalence table --------------------------------------------------

/** One runtime's way of doing a thing. */
export interface DialectApi {
  /** The modules you import to get it (`['machine']`, `['board', 'digitalio']`). */
  modules: string[]
  /**
   * The names a learner types or right-clicks, lower-cased. Used to spot a
   * symbol from the WRONG runtime, so keep them specific: a name that exists on
   * both (`sleep`, `scan`) belongs in neither list.
   */
  symbols: string[]
  /** The shortest honest example, for the hint text and the migration page. */
  snippet: string
  /** The help article that teaches it on this runtime. */
  article: string
}

/** A concept both runtimes have, spelled differently. */
export interface ApiEquivalent {
  id: string
  /** How the concept is named in prose ("Digital output"). */
  title: string
  micropython: DialectApi
  circuitpython: DialectApi
  /** The one-line difference worth saying out loud, if there is one. */
  note?: string
}

/**
 * The concepts a beginner meets in their first hour, in the order they meet
 * them. Deliberately short: this is the "you will get this wrong" list, not a
 * port of both API references.
 */
export const API_EQUIVALENTS: ApiEquivalent[] = [
  {
    id: 'digital-out',
    title: 'Digital output (an LED)',
    micropython: {
      modules: ['machine'],
      symbols: ['machine', 'pin'],
      snippet: 'from machine import Pin\n\nled = Pin(15, Pin.OUT)\nled.value(1)',
      article: 'ref-pins'
    },
    circuitpython: {
      modules: ['board', 'digitalio'],
      symbols: ['digitalio', 'digitalinout', 'direction'],
      snippet:
        'import board\nimport digitalio\n\nled = digitalio.DigitalInOut(board.D15)\nled.direction = digitalio.Direction.OUTPUT\nled.value = True',
      article: 'cp-digitalio'
    },
    note: 'CircuitPython `value` is an attribute you assign, not a method you call.'
  },
  {
    id: 'digital-in',
    title: 'Digital input (a button)',
    micropython: {
      modules: ['machine'],
      symbols: ['pull_up', 'pull_down'],
      snippet: 'from machine import Pin\n\nbtn = Pin(14, Pin.IN, Pin.PULL_UP)\nprint(btn.value())',
      article: 'ref-pins'
    },
    circuitpython: {
      modules: ['board', 'digitalio'],
      symbols: ['pull'],
      snippet:
        'import board\nimport digitalio\n\nbtn = digitalio.DigitalInOut(board.D14)\nbtn.switch_to_input(pull=digitalio.Pull.UP)\nprint(btn.value)',
      article: 'cp-digitalio'
    }
  },
  {
    id: 'analog-in',
    title: 'Analogue input',
    micropython: {
      modules: ['machine'],
      symbols: ['adc', 'read_u16'],
      snippet: 'from machine import ADC\n\npot = ADC(26)\nprint(pot.read_u16())',
      article: 'ref-pins'
    },
    circuitpython: {
      modules: ['board', 'analogio'],
      symbols: ['analogio', 'analogin'],
      snippet: 'import board\nimport analogio\n\npot = analogio.AnalogIn(board.A0)\nprint(pot.value)',
      article: 'cp-analogio'
    },
    note: 'Both read 0–65535, so a reading ported straight across still scales the same.'
  },
  {
    id: 'pwm',
    title: 'PWM (dimming, servos, tones)',
    micropython: {
      modules: ['machine'],
      symbols: ['duty_u16'],
      snippet:
        'from machine import Pin, PWM\n\npwm = PWM(Pin(15))\npwm.freq(1000)\npwm.duty_u16(32768)',
      article: 'ref-pwm'
    },
    circuitpython: {
      modules: ['board', 'pwmio'],
      symbols: ['pwmio', 'pwmout', 'duty_cycle'],
      snippet:
        'import board\nimport pwmio\n\npwm = pwmio.PWMOut(board.D15, frequency=1000)\npwm.duty_cycle = 32768',
      article: 'cp-pwmio'
    },
    note: 'Both take a 16-bit duty; `duty_u16(x)` is a call, `duty_cycle = x` is an attribute.'
  },
  {
    id: 'i2c',
    title: 'I²C',
    micropython: {
      modules: ['machine'],
      symbols: ['softi2c'],
      snippet:
        'from machine import I2C, Pin\n\ni2c = I2C(0, scl=Pin(5), sda=Pin(4))\nprint(i2c.scan())',
      article: 'ref-i2c'
    },
    circuitpython: {
      modules: ['board', 'busio'],
      symbols: ['busio', 'try_lock', 'unlock'],
      snippet:
        'import board\nimport busio\n\ni2c = busio.I2C(board.SCL, board.SDA)\nwhile not i2c.try_lock():\n    pass\ntry:\n    print(i2c.scan())\nfinally:\n    i2c.unlock()',
      article: 'cp-busio'
    },
    note: 'CircuitPython hands the bus to the display/USB stack too, so you must `try_lock()` before scanning and `unlock()` after.'
  },
  {
    id: 'spi',
    title: 'SPI',
    micropython: {
      modules: ['machine'],
      symbols: ['softspi'],
      snippet:
        'from machine import SPI, Pin\n\nspi = SPI(0, baudrate=1000000, sck=Pin(2), mosi=Pin(3), miso=Pin(4))',
      article: 'ref-spi'
    },
    circuitpython: {
      modules: ['board', 'busio'],
      symbols: ['configure'],
      snippet: 'import board\nimport busio\n\nspi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)',
      article: 'cp-busio'
    }
  },
  {
    id: 'uart',
    title: 'UART (serial)',
    micropython: {
      modules: ['machine'],
      symbols: [],
      snippet: 'from machine import UART, Pin\n\nuart = UART(0, 115200, tx=Pin(0), rx=Pin(1))',
      article: 'ref-uart'
    },
    circuitpython: {
      modules: ['board', 'busio'],
      symbols: [],
      snippet: 'import board\nimport busio\n\nuart = busio.UART(board.TX, board.RX, baudrate=115200)',
      article: 'cp-busio'
    }
  },
  {
    id: 'delay',
    title: 'Waiting',
    micropython: {
      modules: ['time'],
      symbols: ['sleep_ms', 'sleep_us', 'ticks_ms', 'ticks_us', 'ticks_diff', 'ticks_add'],
      snippet: 'import time\n\ntime.sleep_ms(500)\nstart = time.ticks_ms()',
      article: 'ref-timing'
    },
    circuitpython: {
      modules: ['time'],
      symbols: ['monotonic', 'monotonic_ns'],
      snippet: 'import time\n\ntime.sleep(0.5)\nstart = time.monotonic()',
      article: 'cp-timing'
    },
    note: 'CircuitPython has no `sleep_ms`/`ticks_ms` — `time.sleep()` takes seconds (a float) and `time.monotonic()` returns seconds.'
  },
  {
    id: 'pin-names',
    title: 'Naming a pin',
    micropython: {
      modules: ['machine'],
      symbols: [],
      snippet: 'from machine import Pin\n\nled = Pin(25, Pin.OUT)   # GPIO number',
      article: 'ref-pins'
    },
    circuitpython: {
      modules: ['board'],
      symbols: ['board'],
      snippet: 'import board\n\nprint(dir(board))        # the names THIS board has\npin = board.D13',
      article: 'cp-board'
    },
    note: 'MicroPython takes the GPIO number; CircuitPython takes an object from `board`, whose names are per-board — `dir(board)` lists them.'
  },
  {
    id: 'program-file',
    title: 'The program that runs at boot',
    micropython: {
      modules: [],
      symbols: [],
      snippet: '# main.py runs after boot.py',
      article: 'gs-run'
    },
    circuitpython: {
      modules: [],
      symbols: [],
      snippet: '# code.py runs, and re-runs on every save',
      article: 'cp-code-py'
    },
    note: 'CircuitPython auto-reloads: saving a file restarts `code.py` immediately.'
  },
  {
    id: 'libraries',
    title: 'Installing a library',
    micropython: {
      modules: ['mip'],
      symbols: ['mip'],
      snippet: "import mip\n\nmip.install('ssd1306')",
      article: 'gs-packages'
    },
    circuitpython: {
      modules: [],
      symbols: [],
      snippet: '# copy the .mpy from the Adafruit bundle into CIRCUITPY/lib/',
      article: 'cp-libraries'
    },
    note: 'CircuitPython has no `mip` — libraries are files copied from the Adafruit bundle into `/lib`.'
  }
]

/** Fast lookup by concept id. */
export const API_EQUIVALENTS_BY_ID: Record<string, ApiEquivalent> = Object.fromEntries(
  API_EQUIVALENTS.map((r) => [r.id, r])
)

/** One runtime's half of a row. `unknown` has no half, so it returns null. */
export function apiFor(equivalent: ApiEquivalent, dialect: Dialect): DialectApi | null {
  if (dialect === 'micropython') return equivalent.micropython
  if (dialect === 'circuitpython') return equivalent.circuitpython
  return null
}

/**
 * The row a symbol belongs to on the runtime we are NOT running — i.e. "you
 * typed a name from the other Python".
 *
 * Returns `null` when the dialect isn't established (nothing is wrong yet), when
 * the symbol is fine here, or when it is unknown to the table. Matching is on
 * the bare word, case-insensitively: `machine`, `Pin`, `sleep_ms`, `DigitalInOut`.
 */
export function foreignApi(
  symbol: string | null | undefined,
  dialect: Dialect
): ApiEquivalent | null {
  const other = otherDialect(dialect)
  if (!other) return null
  const w = (symbol ?? '').trim().toLowerCase()
  if (!w) return null
  // A symbol that is legitimate HERE is never foreign, even if the other
  // runtime happens to list it too — checked first, so an overlap can never
  // produce a hint telling somebody their own runtime's API is wrong.
  for (const row of API_EQUIVALENTS) {
    const here = apiFor(row, dialect)
    if (here && (here.symbols.includes(w) || here.modules.includes(w))) return null
  }
  for (const row of API_EQUIVALENTS) {
    const there = apiFor(row, other)
    if (there && (there.symbols.includes(w) || there.modules.includes(w))) return row
  }
  return null
}

/**
 * The sentence to show when somebody reaches for the other runtime's API — the
 * whole point of #763, delivered at the moment the mistake is made.
 *
 * `null` when there is nothing to correct.
 */
export function crossDialectHint(symbol: string | null | undefined, dialect: Dialect): string | null {
  const row = foreignApi(symbol, dialect)
  if (!row) return null
  const other = otherDialect(dialect)
  if (!other) return null
  const here = apiFor(row, dialect)
  if (!here) return null
  const wrong = other === 'micropython' ? 'MicroPython' : 'CircuitPython'
  const right = dialect === 'micropython' ? 'MicroPython' : 'CircuitPython'
  const how = here.modules.length > 0 ? `use ${here.modules.map((m) => `\`${m}\``).join(' + ')}` : 'see the help page'
  return `\`${symbol}\` is ${wrong}. On ${right}, ${how} — ${row.title.toLowerCase()}.`
}

/**
 * Where a symbol from the other runtime should send a reader instead — the
 * article that teaches the same concept HERE. Powers right-click → "Help for
 * symbol" on a `machine.Pin` a CircuitPython user pasted from a tutorial.
 */
export function foreignApiArticle(
  symbol: string | null | undefined,
  dialect: Dialect
): string | null {
  const row = foreignApi(symbol, dialect)
  return row ? (apiFor(row, dialect)?.article ?? null) : null
}
