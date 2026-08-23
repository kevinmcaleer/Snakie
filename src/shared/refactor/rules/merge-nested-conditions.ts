/**
 * Rule 2 — **Merge nested conditions** (epic #634 §3.1, phase R1).
 *
 * An `if` whose entire body is another `if` is one condition wearing two coats:
 *
 * ```python
 * if self.enabled:                 if self.enabled and link.rssi > -70:
 *     if link.rssi > -70:              publish(link.reading())
 *         publish(link.reading())
 * ```
 *
 * `and` short-circuits, so the merged form evaluates exactly what the nested
 * form did, in the same order, and stops at the same point — `link.rssi` is
 * still never touched when `self.enabled` is false. What changes is the reading:
 * one level of indentation disappears, and the two things that must both be true
 * are stated together instead of a screen apart.
 *
 * Care is taken in three places. An `or` on either side is parenthesised, so
 * `if a or b:` inside `if c:` becomes `if c and (a or b):` and not the very
 * different `if c and a or b:`. A comment written between the two headers is
 * kept — it travels down into the merged body rather than being deleted with the
 * inner header line. And a trailing comment ON the inner header (`if b:  # why`)
 * has nowhere to go, so the rule declines rather than lose it.
 */
import type { Expr, IfStmt } from '../ast'
import type { AnyNode } from '../ast'
import { walk } from '../ast'
import { dedent, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { needsParensInBoolOp, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { colonAfter } from './guard-clause'

interface MergeMatch {
  outer: IfStmt
  inner: IfStmt
}

/**
 * Does this test need parentheses to become an operand of the merged `and`?
 *
 * `or` binds looser than `and`, so it must be wrapped; a lambda, a ternary, a
 * walrus and a bare tuple all need wrapping for the same precedence reason. An
 * expression the user already parenthesised carries its own brackets in its
 * source text, so it needs nothing from us.
 */
function needsWrapping(expr: Expr): boolean {
  if (expr.type === 'Group') return false
  if (expr.type === 'BoolOp' && expr.op === 'or') return true
  if (expr.type === 'NamedExpr' || expr.type === 'Yield') return true
  return needsParensInBoolOp(expr)
}

/** A test's source text, parenthesised if `and` would otherwise mis-bind it. */
function operandText(ctx: RefactorContext, expr: Expr): string {
  const text = textOf(ctx, expr)
  return needsWrapping(expr) ? `(${text})` : text
}

/** Is every line of `text` blank or a comment? */
function onlyBlankOrComment(text: string): boolean {
  return text.split('\n').every((line) => {
    const trimmed = line.trim()
    return trimmed === '' || trimmed.startsWith('#')
  })
}

export const mergeNestedConditionsRule = defineRule<MergeMatch>({
  id: 'merge-nested-conditions',
  title: 'Merge nested conditions',
  message: 'This `if` only wraps another `if` — the two conditions can be joined with `and`',
  catalogue: 2,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-merge-nested-conditions',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<MergeMatch>[] {
    const out: RefactorMatch<MergeMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      // An `else` on either half is a third path; merging would swallow it.
      if (node.orelse.length > 0) return
      if (node.body.length !== 1) return
      const inner = node.body[0]
      if (inner.type !== 'If') return
      if (inner.orelse.length > 0) return
      if (inner.body.length === 0) return
      // `if a:` / `if b: do()` — the inner one-liner has no block to dedent.
      if (
        ctx.lines.positionAt(inner.start).line === ctx.lines.positionAt(inner.body[0].start).line
      ) {
        return
      }
      const colonEnd = colonAfter(ctx.src, inner.test.end)
      if (colonEnd < 0) return
      out.push({
        ruleId: 'merge-nested-conditions',
        start: node.start,
        end: colonEnd,
        data: { outer: node, inner }
      })
    })
    return out
  },

  apply(match: RefactorMatch<MergeMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { outer, inner } = match.data
    const unit = ctx.indentUnit

    const outerColonEnd = colonAfter(ctx.src, outer.test.end)
    const innerColonEnd = colonAfter(ctx.src, inner.test.end)
    if (outerColonEnd < 0 || innerColonEnd < 0) return null

    // The outer body region: everything from the line after `if a:` down to the
    // end of the inner `if`. It is replaced wholesale by the merged body.
    const bodyRegionStart = lineEnd(ctx.src, outerColonEnd)
    const innerLineStart = lineStart(ctx.src, inner.start)
    if (bodyRegionStart > innerLineStart) return null

    // Anything between the two headers can only be blank lines and comments —
    // the parser proved the inner `if` is the outer body's one statement — but
    // check, because that text is carried across verbatim.
    const gap = ctx.src.slice(bodyRegionStart, innerLineStart)
    if (!onlyBlankOrComment(gap)) return null

    // A trailing comment on the inner header would be destroyed with the line.
    const innerHeaderTail = ctx.src.slice(innerColonEnd, lineEnd(ctx.src, innerColonEnd))
    if (innerHeaderTail.trim() !== '') return null

    const innerBodyStart = lineEnd(ctx.src, innerColonEnd)
    if (innerBodyStart <= innerColonEnd || innerBodyStart > inner.end) return null
    const innerBody = ctx.src.slice(innerBodyStart, inner.end)
    if (!innerBody.split('\n').some((l) => l.trim())) return null

    const merged = `${operandText(ctx, outer.test)} and ${operandText(ctx, inner.test)}`

    return [
      { start: outer.test.start, end: outer.test.end, newText: merged },
      // The gap keeps the indentation it already has — it sat one level in from
      // the outer `if`, which is exactly where the merged body now sits.
      { start: bodyRegionStart, end: inner.end, newText: `${gap}${dedent(innerBody, unit)}` }
    ]
  }
})
