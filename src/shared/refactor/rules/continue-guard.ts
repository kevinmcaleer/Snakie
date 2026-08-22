/**
 * Rule 4 — **Invert to a continue guard** (epic #634 §3.1, phase R1).
 *
 * The guard clause (rule 1), but for loops: when a loop body is nothing but one
 * big `if`, the interesting work is indented for a condition that has already
 * been decided.
 *
 * ```python
 * for reading in samples:          for reading in samples:
 *     if reading > threshold:          if reading <= threshold:
 *         count += 1                       continue
 *         log(reading)                 count += 1
 *                                      log(reading)
 * ```
 *
 * `continue` skips to the next iteration, which is precisely what falling off
 * the end of the `if` did before — so the rewrite preserves behaviour exactly,
 * including a `for … else`, which only an unrelated `break` can skip.
 *
 * The reason to do it is readability under nesting: on a microcontroller these
 * loops grow (debounce, then range check, then a flag) and each new condition
 * costs another level. As guards they stay a flat list of reasons to skip this
 * reading, with the real work at the bottom, unindented.
 */
import type { ForStmt, IfStmt, WhileStmt } from '../ast'
import type { AnyNode } from '../ast'
import { walk } from '../ast'
import { dedent, indentAt, lineEnd } from '../text'
import type { TextEdit } from '../text'
import { invertCondition } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { colonAfter } from './guard-clause'

interface ContinueGuardMatch {
  loop: ForStmt | WhileStmt
  ifStmt: IfStmt
}

export const continueGuardRule = defineRule<ContinueGuardMatch>({
  id: 'continue-guard',
  title: 'Invert to a continue guard',
  message: 'This `if` wraps the whole loop body — `continue` would flatten it',
  catalogue: 4,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-continue-guard',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ContinueGuardMatch>[] {
    const out: RefactorMatch<ContinueGuardMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      if (node.body.length !== 1) return
      const only = node.body[0]
      if (only.type !== 'If') return
      // With an `else` the two branches are peers; skipping one is not the same
      // as running the other.
      if (only.orelse.length > 0) return
      // Flattening a one-statement body just moves the indentation around.
      if (only.body.length < 2) return
      // A single-line `if x: do()` has no block to dedent.
      if (ctx.lines.positionAt(only.start).line === ctx.lines.positionAt(only.body[0].start).line) {
        return
      }
      out.push({
        ruleId: 'continue-guard',
        start: only.start,
        end: colonAfter(ctx.src, only.test.end),
        data: { loop: node, ifStmt: only }
      })
    })
    return out
  },

  apply(match: RefactorMatch<ContinueGuardMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const colonEnd = colonAfter(ctx.src, ifStmt.test.end)
    if (colonEnd < 0) return null

    // Inverting rebuilds the condition from its operands, which would drop a
    // comment written inside a parenthesised test. Leave those alone.
    const test = ifStmt.test
    if (ctx.comments.some((c) => c.start >= test.start && c.end <= test.end)) return null

    const unit = ctx.indentUnit
    const ifIndent = indentAt(ctx.src, ifStmt.start)
    const inverted = invertCondition(ctx, test)

    // One dedent must land the body on the loop-body column the `if` occupies.
    // A block written deeper than one unit would stay inside the guard, after
    // the `continue` — code that parses and never runs.
    if (indentAt(ctx.src, ifStmt.body[0].start) !== ifIndent + unit) return null

    // The body region starts on the line after the header, so any comment
    // between the two travels with the body and is dedented alongside it.
    const bodyRegionStart = lineEnd(ctx.src, colonEnd)
    if (bodyRegionStart <= colonEnd || bodyRegionStart > ifStmt.end) return null
    const bodyText = ctx.src.slice(bodyRegionStart, ifStmt.end)
    if (!bodyText.split('\n').some((l) => l.trim())) return null

    return [
      { start: ifStmt.test.start, end: ifStmt.test.end, newText: inverted },
      {
        start: bodyRegionStart,
        end: ifStmt.end,
        newText: `${ifIndent}${unit}continue${ctx.eol}${dedent(bodyText, unit)}`
      }
    ]
  }
})
