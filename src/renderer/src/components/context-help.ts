/**
 * CONTEXT-SENSITIVE HELP (#221) — resolve the word under the editor cursor to a
 * mini-help article: an installed library PART (right-clicking `bme280` in
 * `from bme280 import BME280` opens that part's bundled help) or a LANGUAGE
 * reference topic (`Pin`, `PWM`, `I2C`, `sleep`, …). Pure + unit-tested; the
 * Monaco context-menu action calls {@link resolveHelpTarget} and dispatches the
 * shared open-help event with the result.
 */
import type { PartDefinition } from '../../../shared/part'

/** Fold a word list into `map` → one target article id (builder for the table). */
function topic(map: Record<string, string>, words: string[], article: string): void {
  for (const w of words) map[w] = article
}

/**
 * Language-reference topics by (lower-cased) symbol → help article id. Covers
 * the hardware modules PLUS standard Python: keywords, the common value types,
 * and the everyday built-ins — so right-clicking `while`, `dict` or `len`
 * lands on the matching reference page.
 */
export const LANGUAGE_HELP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  // Hardware / MicroPython modules.
  topic(m, ['machine', 'pin', 'adc'], 'ref-pins')
  topic(m, ['pwm'], 'ref-pwm')
  topic(m, ['i2c', 'softi2c'], 'ref-i2c')
  topic(m, ['spi', 'softspi'], 'ref-spi')
  topic(m, ['uart'], 'ref-uart')
  topic(m, ['time', 'sleep', 'sleep_ms', 'sleep_us', 'ticks_ms', 'ticks_us', 'ticks_diff'], 'ref-timing')
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

export interface HelpTarget {
  articleId: string
  title: string
}

/**
 * Resolve a symbol to its help article. Installed PARTS win over the language
 * table (a part named `pwm` should open ITS help); matching is case-insensitive
 * against each part's id and import module — the same tokens the Help panel's
 * "In This Project" detector uses. Returns null for an unknown word.
 */
export function resolveHelpTarget(
  word: string | null | undefined,
  libraries: { id: string; parts: PartDefinition[] }[]
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
  const ref = LANGUAGE_HELP[w]
  if (ref) return { articleId: ref, title: word ?? '' }
  return null
}
