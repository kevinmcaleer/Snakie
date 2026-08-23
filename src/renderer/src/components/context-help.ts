/**
 * CONTEXT-SENSITIVE HELP (#221) — resolve the word under the editor cursor to a
 * mini-help article: an installed library PART (right-clicking `bme280` in
 * `from bme280 import BME280` opens that part's bundled help) or a LANGUAGE
 * reference topic (`Pin`, `PWM`, `I2C`, `sleep`, …). Pure + unit-tested; the
 * Monaco context-menu action calls {@link resolveHelpTarget} and dispatches the
 * shared open-help event with the result.
 *
 * ## Dialect (#763, epic #209)
 *
 * The same word means different pages on different runtimes: `I2C` is
 * `machine.I2C` on MicroPython and `busio.I2C` (with the lock) on CircuitPython.
 * And a word from the WRONG runtime is the most valuable one to resolve —
 * somebody right-clicking `machine` on a CircuitPython board has pasted a
 * MicroPython tutorial and needs the page that explains what to write instead,
 * not a dead end.
 */
import type { PartDefinition } from '../../../shared/part'
import type { Dialect } from '../../../shared/dialect'
import { foreignApiArticle } from '../../../shared/dialect-api'

/** Fold a word list into `map` → one target article id (builder for the table). */
function topic(map: Record<string, string>, words: string[], article: string): void {
  for (const w of words) map[w] = article
}

/**
 * Topics that are plain Python — the same page whatever the board is running:
 * keywords, the common value types, and the everyday built-ins, so right-clicking
 * `while`, `dict` or `len` lands on the matching reference page.
 */
const SHARED_HELP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  topic(m, ['print'], 'ref-print')
  // Control flow (keywords + boolean/membership operators).
  topic(
    m,
    ['if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'and', 'or', 'not', 'in', 'is'],
    'ref-flow'
  )
  // Functions & scope.
  topic(m, ['def', 'return', 'lambda', 'global', 'nonlocal', 'yield'], 'ref-functions')
  // Classes.
  topic(m, ['class', 'self', 'super', 'property', '__init__'], 'ref-classes')
  // Errors & exceptions.
  topic(
    m,
    ['try', 'except', 'finally', 'raise', 'assert', 'oserror', 'valueerror', 'typeerror', 'keyerror', 'exception'],
    'ref-exceptions'
  )
  // Imports & modules.
  topic(m, ['import', 'from', 'as', 'sys', 'os'], 'ref-imports')
  // Values & types.
  topic(
    m,
    ['int', 'float', 'str', 'bool', 'list', 'dict', 'tuple', 'set', 'bytes', 'bytearray', 'none', 'true', 'false', 'complex', 'frozenset'],
    'ref-types'
  )
  // Everyday built-ins.
  topic(
    m,
    ['len', 'range', 'enumerate', 'zip', 'min', 'max', 'sum', 'abs', 'round', 'sorted', 'reversed', 'input', 'type', 'isinstance', 'hex', 'bin', 'chr', 'ord', 'dir', 'help', 'map', 'filter', 'open'],
    'ref-builtins'
  )
  return m
})()

/** MicroPython's hardware vocabulary. */
const MICROPYTHON_HELP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  topic(m, ['machine', 'pin', 'adc', 'read_u16', 'pull_up', 'pull_down'], 'ref-pins')
  topic(m, ['pwm', 'duty_u16'], 'ref-pwm')
  topic(m, ['i2c', 'softi2c'], 'ref-i2c')
  topic(m, ['spi', 'softspi'], 'ref-spi')
  topic(m, ['uart'], 'ref-uart')
  topic(
    m,
    ['time', 'sleep', 'sleep_ms', 'sleep_us', 'ticks_ms', 'ticks_us', 'ticks_diff', 'ticks_add'],
    'ref-timing'
  )
  topic(m, ['mip'], 'gs-packages')
  return m
})()

/** CircuitPython's hardware vocabulary. */
const CIRCUITPYTHON_HELP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  topic(m, ['board'], 'cp-board')
  topic(m, ['digitalio', 'digitalinout', 'direction', 'pull', 'keypad'], 'cp-digitalio')
  topic(m, ['analogio', 'analogin', 'analogout', 'reference_voltage'], 'cp-analogio')
  topic(m, ['pwmio', 'pwmout', 'duty_cycle', 'variable_frequency'], 'cp-pwmio')
  topic(m, ['busio', 'i2c', 'spi', 'uart', 'try_lock', 'unlock', 'bitbangio'], 'cp-busio')
  topic(m, ['time', 'sleep', 'monotonic', 'monotonic_ns'], 'cp-timing')
  topic(m, ['storage', 'remount'], 'cp-readonly')
  topic(m, ['supervisor', 'autoreload', 'reload'], 'cp-code-py')
  return m
})()

/**
 * Language-reference topics by (lower-cased) symbol → help article id, for one
 * runtime.
 *
 * On `unknown` the two hardware tables are merged with MicroPython first, so an
 * overlapping name (`i2c`, `sleep`, `time`) keeps the page it has always opened
 * rather than silently changing meaning for somebody with no board attached.
 * Names unique to CircuitPython (`digitalio`, `try_lock`) still resolve.
 */
export function languageHelpFor(dialect: Dialect): Record<string, string> {
  if (dialect === 'circuitpython') return { ...SHARED_HELP, ...CIRCUITPYTHON_HELP }
  if (dialect === 'micropython') return { ...SHARED_HELP, ...MICROPYTHON_HELP }
  return { ...SHARED_HELP, ...CIRCUITPYTHON_HELP, ...MICROPYTHON_HELP }
}

/**
 * The table as it was before dialects existed — MicroPython plus plain Python.
 * Kept as the default export shape for callers that have no dialect to hand.
 */
export const LANGUAGE_HELP: Record<string, string> = languageHelpFor('micropython')

export interface HelpTarget {
  articleId: string
  title: string
}

/**
 * Resolve a symbol to its help article. Installed PARTS win over the language
 * table (a part named `pwm` should open ITS help); matching is case-insensitive
 * against each part's id and import module — the same tokens the Help panel's
 * "In This Project" detector uses. Returns null for an unknown word.
 *
 * `dialect` decides WHICH language table is consulted, and — when the word turns
 * out to belong to the other runtime entirely — sends the reader to the page
 * that teaches the same idea here (`machine` on a CircuitPython board opens the
 * `digitalio` page rather than nothing).
 */
export function resolveHelpTarget(
  word: string | null | undefined,
  libraries: { id: string; parts: PartDefinition[] }[],
  dialect: Dialect = 'unknown'
): HelpTarget | null {
  const w = (word ?? '').trim().toLowerCase()
  if (!w) return null
  for (const lib of libraries) {
    for (const part of lib.parts) {
      const toks = [part.id, part.library?.module]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
      if (toks.includes(w)) return { articleId: `part-${part.id}`, title: part.name }
    }
  }
  const ref = languageHelpFor(dialect)[w]
  if (ref) return { articleId: ref, title: word ?? '' }
  // Not in this runtime's vocabulary — but it may be the OTHER runtime's, which
  // is exactly the moment somebody needs the equivalent page.
  const foreign = foreignApiArticle(w, dialect)
  if (foreign) return { articleId: foreign, title: word ?? '' }
  return null
}
