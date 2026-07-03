/**
 * CONTEXT-SENSITIVE HELP (#221) — resolve the word under the editor cursor to a
 * mini-help article: an installed library PART (right-clicking `bme280` in
 * `from bme280 import BME280` opens that part's bundled help) or a LANGUAGE
 * reference topic (`Pin`, `PWM`, `I2C`, `sleep`, …). Pure + unit-tested; the
 * Monaco context-menu action calls {@link resolveHelpTarget} and dispatches the
 * shared open-help event with the result.
 */
import type { PartDefinition } from '../../../shared/part'

/** Language-reference topics by (lower-cased) symbol → help article id. */
export const LANGUAGE_HELP: Record<string, string> = {
  machine: 'ref-pins',
  pin: 'ref-pins',
  adc: 'ref-pins',
  pwm: 'ref-pwm',
  i2c: 'ref-i2c',
  softi2c: 'ref-i2c',
  spi: 'ref-spi',
  softspi: 'ref-spi',
  uart: 'ref-uart',
  time: 'ref-timing',
  sleep: 'ref-timing',
  sleep_ms: 'ref-timing',
  sleep_us: 'ref-timing',
  ticks_ms: 'ref-timing',
  ticks_diff: 'ref-timing',
  print: 'ref-print'
}

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
