/**
 * The whole-file hint pass (epic #634 §2.4, phase R7 / #807).
 *
 * The right-click menu answers "what can I do *here*". This answers "what is
 * worth knowing about this file" — it runs every rule over the whole buffer and
 * turns the matches into `hint`-severity diagnostics so they appear in the
 * Problems panel and the gutter, without shouting at a beginner with red
 * squiggles.
 *
 * Two policies live here, both from the epic:
 *
 * - **§9's default question.** MicroPython rules are bugs waiting to happen —
 *   a raw `ticks_ms()` subtraction WILL misbehave in the field — so those are on
 *   by default. Style rules are opinions, and a file full of blue hints would
 *   demoralise a learner, so those are off until asked for.
 * - **§5's deduplication.** Where ruff already reports a smell, we don't report
 *   it twice; ours wins only when it carries a "Why?" article ruff has no
 *   equivalent for.
 */
import type { Diagnostic } from '../../../preload/index.d'
import { createContext, detectAll } from '../../../shared/refactor/engine'
import { ALL_RULES } from '../../../shared/refactor/rules'
import type { BoardCapabilities, RefactorCategory } from '../../../shared/refactor/types'

/** The `source` every refactoring hint carries, for the Problems filter. */
export const REFACTOR_SOURCE = 'refactor'

/** Categories that are on by default — the ones that are latent bugs, not taste. */
const DEFAULT_ON: ReadonlySet<RefactorCategory> = new Set<RefactorCategory>([
  'micropython',
  'board'
])

export interface HintOptions {
  /** Also show the style-rule hints (control flow, loops, naming, …). */
  includeStyleHints?: boolean
  /** The connected board's capabilities; absent means no board-gated hints. */
  capabilities?: BoardCapabilities
  fileName?: string
  /**
   * Rule ids another producer already reported, so we don't double-report the
   * same smell (§5). Typically derived from the ruff diagnostics on the file.
   */
  alreadyReported?: ReadonlySet<string>
}

/**
 * Run the catalogue over `src` and return the hints for the Problems panel.
 *
 * Returns an empty list for a file that does not parse — the engine's flat
 * refusal to say anything about code it cannot fully read, which also means a
 * half-typed line never lights the panel up.
 */
export function refactorHints(src: string, opts: HintOptions = {}): Diagnostic[] {
  const ctx = createContext(src, {
    capabilities: opts.capabilities,
    fileName: opts.fileName
  })
  if (!ctx) return []

  const rules = ALL_RULES.filter(
    (rule) => opts.includeStyleHints || DEFAULT_ON.has(rule.category)
  )
  if (rules.length === 0) return []

  const out: Diagnostic[] = []
  for (const offer of detectAll(ctx, rules)) {
    if (opts.alreadyReported?.has(offer.rule.id)) continue
    const range = ctx.lines.rangeOf(offer.match)
    out.push({
      line: range.startLine,
      column: range.startColumn,
      endLine: range.endLine,
      endColumn: range.endColumn,
      severity: offer.rule.severity,
      message: offer.match.message ?? offer.rule.message,
      source: REFACTOR_SOURCE,
      ruleId: offer.rule.id,
      helpArticle: offer.rule.helpArticle
    })
  }
  return out
}

/**
 * Merge diagnostics from every producer into the single list the Problems panel
 * renders, ordered by position. Duplicates at the same place from the same rule
 * are collapsed — two producers agreeing is not two problems.
 */
export function mergeDiagnostics(...groups: readonly Diagnostic[][]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const group of groups) {
    for (const d of group) {
      const key = `${d.source}:${d.ruleId ?? d.message}:${d.line}:${d.column ?? 0}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(d)
    }
  }
  return out.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0))
}

/** The distinct `source` values present, for the panel's filter chips. */
export function diagnosticSources(diagnostics: readonly Diagnostic[]): string[] {
  return [...new Set(diagnostics.map((d) => d.source))].sort()
}

/**
 * Smells ruff already reports, mapped to the rule of ours that would say the
 * same thing (epic #634 §5).
 *
 * The epic's wording is that ours wins "if it produces a better-explained fix".
 * In practice every rule of ours carries a "Why?" article, so that test would
 * always come out in our favour — and the user would get two rows for one
 * problem, which is worse than either. So the policy here is the simpler half
 * of §5: **defer to ruff and don't double-report.** Ruff's row keeps its
 * autofix, and our explanation is still one click away in the Refactoring book
 * and on the right-click menu, which is where somebody goes when they want to
 * understand rather than just clear a squiggle.
 *
 * Keyed on ruff's code, which the bundled linter prefixes into the message
 * (`"B006: Do not use mutable data structures…"`).
 */
const RUFF_OVERLAP: Record<string, readonly string[]> = {
  // Unused import / unused local — rule 32 is a deliberate no-op for this
  // reason, but list it so the intent is visible in one place.
  F401: ['ruff-owned-unused'],
  F841: ['ruff-owned-unused'],
  // Mutable default argument.
  B006: ['mutable-default'],
  // Bare `except:`, and `except: pass`.
  E722: ['specific-exception', 'except-pass'],
  // `== None` / `!= None`, and `== True` / `== False`.
  E711: ['simplify-comparison'],
  E712: ['simplify-comparison'],
  // `.format()` / `%` that could be an f-string.
  UP032: ['use-fstring'],
  UP031: ['use-fstring'],
  // Repeated `x == a or x == b`.
  PLR1714: ['membership-test'],
  // `if k in d: … else: …` that is `d.get`.
  SIM401: ['dict-get-default'],
  // `if c: x = a else: x = b`.
  SIM108: ['conditional-expression'],
  // `for k in d.keys()`.
  SIM118: ['iterate-dict-items'],
  // `open()` without a `with`.
  SIM115: ['use-with']
}

/** Ruff's rule code, which the bundled linter prefixes into the message. */
function ruffCode(diagnostic: Diagnostic): string | null {
  if (diagnostic.source !== 'ruff') return null
  const m = /^([A-Z]+\d+):/.exec(diagnostic.message)
  return m ? m[1] : null
}

/**
 * Which of our rules another producer has already covered, so the hint pass can
 * stay quiet about them. Pass the result as {@link HintOptions.alreadyReported}.
 */
export function rulesCoveredByLinter(diagnostics: readonly Diagnostic[]): Set<string> {
  const out = new Set<string>()
  for (const d of diagnostics) {
    const code = ruffCode(d)
    if (!code) continue
    for (const ruleId of RUFF_OVERLAP[code] ?? []) out.add(ruleId)
  }
  return out
}
