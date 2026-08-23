/**
 * Rule 6 — **Return the expression directly** (epic #634 §3.1).
 *
 * ```python
 * def is_charged(mv):            def is_charged(mv):
 *     if mv >= FULL_MV:              return mv >= FULL_MV
 *         return True
 *     else:
 *         return False
 * ```
 *
 * Five lines to say "if the answer is yes, return yes". The comparison is
 * already a `bool`, so handing it straight back says the same thing with a lot
 * less to read — and it is the shape that makes the next step obvious, whether
 * that is naming the condition or reusing it in a guard clause.
 *
 * The branches the other way round — `return False` then `return True` — become
 * `return` of the *inverted* condition, written the way a person would write it
 * (`>` becomes `<=`, `is` becomes `is not`) rather than as a bolted-on `not`.
 *
 * The rule fires ONLY when the condition is already boolean-valued: a
 * comparison, a `not`, or `and`/`or` over those. `if motor: return True` is not
 * the same as `return motor` — the first hands back `True`, the second hands
 * back the motor object, and a caller that prints the result or compares it
 * with `is True` would see the difference. That is a behaviour change, so we
 * decline it.
 */
import type { AnyNode, Expr, IfStmt, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { invertCondition, textOf } from '../expr'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ReturnExprMatch {
  ifStmt: IfStmt
  /** True when the `if` branch returns `True`, so the test is returned as-is. */
  positive: boolean
}

/** The literal a `return True` / `return False` hands back, or null. */
function returnedBool(stmt: Stmt | undefined): boolean | null {
  if (!stmt || stmt.type !== 'Return' || !stmt.value) return null
  const value = unwrap(stmt.value)
  if (value.type !== 'Constant' || value.kind !== 'bool') return null
  return value.raw === 'True'
}

/**
 * Does evaluating this expression always produce a `bool`?
 *
 * `and`/`or` hand back one of their operands rather than a bool, so `a and b`
 * qualifies only when both halves do. Anything else — a name, a call, a
 * subscript — is deliberately not recognised: it may well be truthy, but truthy
 * is not `True`.
 */
function isBooleanValued(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'Compare') return true
  if (e.type === 'UnaryOp' && e.op === 'not') return true
  if (e.type === 'BoolOp') return e.values.every(isBooleanValued)
  return false
}

/**
 * Is the text {@link invertCondition} would produce for `expr` still a `bool`?
 *
 * The awkward case is `not x`, which inverts to a bare `x` — a bool only when
 * `x` was one already. A comparison inverts to a comparison, and a `BoolOp`
 * either inverts operand-wise (De Morgan) or falls back to `not (…)`; both of
 * those stay boolean as long as every operand does.
 */
function invertsToBoolean(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'Compare') return true
  if (e.type === 'BoolOp') return e.values.every(invertsToBoolean)
  if (e.type === 'UnaryOp' && e.op === 'not') return isBooleanValued(e.operand)
  return false
}

/** Line number of an offset, for the "is this all on one line?" checks. */
function lineOf(ctx: RefactorContext, offset: number): number {
  return ctx.lines.positionAt(offset).line
}

export const returnTheExpressionRule = defineRule<ReturnExprMatch>({
  id: 'return-the-expression',
  title: 'Return the expression directly',
  message: 'This `if`/`else` returns `True`/`False` — return the condition itself',
  catalogue: 6,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-return-the-expression',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ReturnExprMatch>[] {
    const out: RefactorMatch<ReturnExprMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      // An `elif` shares the chain's `else` with the branches above it, so
      // collapsing it here would strand them. Different rewrite, different rule.
      if (node.isElif) return
      if (node.body.length !== 1 || node.orelse.length !== 1) return

      const thenValue = returnedBool(node.body[0])
      const elseValue = returnedBool(node.orelse[0])
      if (thenValue == null || elseValue == null) return
      // Both branches returning the same literal is a different smell entirely.
      if (thenValue === elseValue) return

      // Returning the condition preserves the returned VALUE only when the
      // condition is already a bool (see isBooleanValued).
      const preservesType = thenValue
        ? isBooleanValued(node.test)
        : invertsToBoolean(node.test)
      if (!preservesType) return

      // A condition split over several lines would be spliced into one
      // `return`, and an inverted one would be re-joined without its line
      // breaks. Not worth the risk of an unparseable result.
      if (lineOf(ctx, node.test.start) !== lineOf(ctx, node.test.end)) return

      // The whole statement disappears, and any comment inside it with it.
      const from = lineStart(ctx.src, node.start)
      const to = lineEnd(ctx.src, node.end)
      if (ctx.comments.some((c) => c.start >= from && c.start < to)) return

      out.push({
        ruleId: 'return-the-expression',
        start: node.start,
        end: node.end,
        data: { ifStmt: node, positive: thenValue }
      })
    })
    return out
  },

  apply(match: RefactorMatch<ReturnExprMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt, positive } = match.data
    const value = positive ? textOf(ctx, ifStmt.test) : invertCondition(ctx, ifStmt.test)
    if (!value.trim() || /[\r\n]/.test(value)) return null
    // The statement's start offset sits after the line's indentation, so
    // replacing the whole statement lands `return` at exactly the right column.
    return [{ start: ifStmt.start, end: ifStmt.end, newText: `return ${value}` }]
  }
})
