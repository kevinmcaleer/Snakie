/**
 * Rule 7 — **Apply De Morgan's law** (epic #634 §3.1).
 *
 * ```python
 * # before
 * if not (speed == 0 and distance_cm > DEAD_ZONE_CM):
 *     stop()
 *
 * # after
 * if speed != 0 or distance_cm <= DEAD_ZONE_CM:
 *     stop()
 * ```
 *
 * A negated group makes the reader hold the whole bracket in their head and
 * then flip it. Pushing the `not` inwards — `not (a and b)` is `not a or not b`
 * — lets them read the condition left to right, and it is the step that turns
 * a tangled `if` into one a guard clause (rule 1) can invert cleanly.
 *
 * We only offer it where the result is genuinely tidier: every operand has to
 * invert into something a person would have written by hand (`>` → `<=`,
 * `is` → `is not`, `not x` → `x`). A half-inverted
 * `not armed or not (sensor.ready and calibrated)` is harder to read than the
 * bracket it replaced, so that case is left alone. Chained comparisons
 * (`0 < value < 100`) never qualify — their negation is emphatically not
 * `0 >= value >= 100`.
 */
import type { AnyNode, BoolOp, Expr, UnaryOp } from '../ast'
import { unwrap, walk } from '../ast'
import { invertCondition, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface DeMorganMatch {
  /** The `not (…)` being rewritten. */
  negation: UnaryOp
  /** The `and`/`or` inside it. */
  inner: BoolOp
}

/** Comparison operators that have an exact single-operator negation. */
const NEGATABLE = new Set(['==', '!=', '<', '>', '<=', '>=', 'in', 'not in', 'is', 'is not'])

/**
 * Would this operand invert into something better than another `not (…)`?
 *
 * Mirrors the private predicate `invertCondition` uses, deliberately: if the
 * two ever disagree the worst case is that `invertCondition` hands back the
 * text we already have, the edit changes nothing, and the engine drops the
 * offer. Disagreement can only cost a missed detection, never a bad rewrite.
 */
function invertsCleanly(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'UnaryOp' && e.op === 'not') return true
  if (e.type === 'Compare') return e.ops.length === 1 && NEGATABLE.has(e.ops[0])
  if (e.type === 'Constant' && e.kind === 'bool') return true
  return false
}

/** Does evaluating this expression always produce a `bool`? (See rule 6.) */
function isBooleanValued(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'Compare') return true
  if (e.type === 'UnaryOp' && e.op === 'not') return true
  if (e.type === 'Constant' && e.kind === 'bool') return true
  if (e.type === 'BoolOp') return e.values.every(isBooleanValued)
  return false
}

/**
 * Is this operand's inverted form still a `bool`?
 *
 * `not (a == 1 and not verbose)` is a bool; the De Morgan form
 * `a != 1 or verbose` hands back `verbose` itself when the first half is false.
 * In a condition nobody can tell, but `flag = not (…)` would start storing an
 * int, so outside a condition we insist every operand stays boolean.
 */
function invertedOperandIsBoolean(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'UnaryOp' && e.op === 'not') return isBooleanValued(e.operand)
  return true
}

/**
 * Expression positions where a bare `a or b` may stand in for what used to be a
 * single `not (…)` operand without the surrounding syntax re-associating it.
 * Anything not listed — most importantly another `and`/`or`, where dropping the
 * brackets would silently change the grouping — is declined.
 */
const SAFE_PARENTS = new Set([
  'If',
  'While',
  'Assert',
  'Return',
  'ExprStmt',
  'Assign',
  'AnnAssign',
  'Group',
  'Keyword',
  'Call',
  'Comprehension',
  'IfExp',
  'Lambda',
  'NamedExpr',
  'List',
  'Set',
  'Dict',
  'Tuple'
])

/**
 * Is only the *truth* of this expression observable — an `if`/`while` test, an
 * `assert`, a comprehension filter? There a truthy operand and `True` are
 * indistinguishable, so the boolean-preservation check above can be relaxed.
 */
function isConditionPosition(node: AnyNode): boolean {
  let cur: AnyNode = node
  let parent = cur.parent
  // Parentheses are transparent: `if (not (a and b)):` is still a condition.
  while (parent && parent.type === 'Group') {
    cur = parent
    parent = cur.parent
  }
  if (!parent) return false
  switch (parent.type) {
    case 'If':
    case 'While':
    case 'Assert':
    case 'IfExp':
      return parent.test === (cur as Expr)
    case 'Comprehension':
      return parent.ifs.includes(cur as Expr)
    default:
      return false
  }
}

export const deMorganRule = defineRule<DeMorganMatch>({
  id: 'de-morgan',
  title: "Apply De Morgan's law",
  message: 'This negated group reads better with the `not` pushed inwards',
  catalogue: 7,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-de-morgan',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<DeMorganMatch>[] {
    const out: RefactorMatch<DeMorganMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'UnaryOp' || node.op !== 'not') return
      const inner = unwrap(node.operand)
      if (inner.type !== 'BoolOp') return

      // The rewrite joins the operands' source text with a new ` or `/` and `,
      // which would fold a wrapped condition onto one line — and a `#` comment
      // inside the brackets cannot survive that. A single-line negation cannot
      // contain a comment at all, so this one check covers both.
      if (ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line) return

      if (!inner.values.every(invertsCleanly)) return
      if (!isConditionPosition(node) && !inner.values.every(invertedOperandIsBoolean)) return

      // Dropping the brackets is only safe where the looser-binding result
      // cannot be re-associated by what encloses it.
      const parent = node.parent
      if (!parent || !SAFE_PARENTS.has(parent.type)) return

      out.push({
        ruleId: 'de-morgan',
        start: node.start,
        end: node.end,
        data: { negation: node, inner }
      })
    })
    return out
  },

  apply(match: RefactorMatch<DeMorganMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { negation, inner } = match.data
    // `invertCondition` of the inner `and`/`or` IS the De Morgan form of the
    // whole `not (…)` — the negation of `a and b` is `not a or not b`.
    const rewritten = invertCondition(ctx, inner)
    if (!rewritten.trim() || /[\r\n]/.test(rewritten)) return null
    // If it declined to distribute (an operand we thought was clean was not),
    // it hands back a `not (…)` again — nothing gained, so drop the offer.
    if (rewritten.trim() === textOf(ctx, negation).trim()) return null
    if (rewritten.trimStart().startsWith('not ')) return null
    return [{ start: negation.start, end: negation.end, newText: rewritten }]
  }
})
