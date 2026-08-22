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
