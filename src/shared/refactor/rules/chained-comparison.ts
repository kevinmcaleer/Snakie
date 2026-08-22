/**
 * Rule 69 — **Chain the comparison** (epic #634 §3.3).
 *
 * ```python
 * if MIN_US < pulse and pulse < MAX_US:      if MIN_US < pulse < MAX_US:
 *     servo.duty_ns(pulse)                       servo.duty_ns(pulse)
 * ```
 *
 * Python is one of the few languages where the maths notation works, and a range
 * check written as a range reads as one idea instead of two joined by an `and`.
 * It also removes the classic copy-paste bug in the second half (`pulse < MAX_US`
 * typed as `pluse < MAX_US`, or the wrong variable entirely), because the middle
 * term is now written once.
 *
 * Written once is also exactly why this rule is careful: `a < f() and f() < b`
 * calls `f()` **twice**, and `a < f() < b` calls it **once**. On a board that
 * might be an ADC read, an I²C transaction or a millisecond of timing, so unless
 * the shared middle term is a pure expression — a name, an attribute, arithmetic
 * over those — the rule declines and leaves the `and` alone. The same goes for
 * `a < b and b > c`: chaining it is legal Python but it no longer reads as a
 * range, so we don't offer it.
 */
import type { AnyNode, BoolOp, Compare, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import { isPureExpression, sameText, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Operators that chain into a rising range, and into a falling one. */
const RISING = new Set(['<', '<='])
const FALLING = new Set(['>', '>='])

interface ChainMatch {
  boolOp: BoolOp
  first: Compare
  second: Compare
}

/** A single-operator comparison, looking through any parentheses around it. */
function singleCompare(expr: Expr): Compare | null {
  const e = unwrap(expr)
  if (e.type !== 'Compare' || e.ops.length !== 1) return null
  return e
}

/** Do the two operators point the same way, so the chain reads as a range? */
function sameDirection(a: string, b: string): boolean {
  return (RISING.has(a) && RISING.has(b)) || (FALLING.has(a) && FALLING.has(b))
}

export const chainedComparisonRule = defineRule<ChainMatch>({
  id: 'chained-comparison',
  title: 'Chain the comparison',
  message: 'This is a range check — Python can write it as one chained comparison',
  catalogue: 69,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-chained-comparison',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ChainMatch>[] {
    const out: RefactorMatch<ChainMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'BoolOp' || node.op !== 'and') return
      // `a < b and b < c and c < d` is a three-term chain; folding half of it
      // would leave a mixed form that reads worse than either.
      if (node.values.length !== 2) return
      const first = singleCompare(node.values[0])
      const second = singleCompare(node.values[1])
      if (!first || !second) return
      if (!sameDirection(first.ops[0], second.ops[0])) return
      // The end of the first comparison has to be the start of the second.
      const middle = first.comparators[0]
      if (!sameText(ctx, middle, second.left)) return
      // Chaining evaluates the middle term ONCE where the `and` evaluated it
      // twice. That is only invisible if evaluating it does nothing.
      if (!isPureExpression(middle) || !isPureExpression(second.left)) return
      out.push({
        ruleId: 'chained-comparison',
        start: node.start,
        end: node.end,
        message: `\`${textOf(ctx, middle).trim()}\` is compared twice — chain the two tests`,
        data: { boolOp: node, first, second }
      })
    })
    return out
  },

  apply(match: RefactorMatch<ChainMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { boolOp, first, second } = match.data
    const left = textOf(ctx, first.left).trim()
    const middle = textOf(ctx, first.comparators[0]).trim()
    const right = textOf(ctx, second.comparators[0]).trim()
    // Folding onto one line is only safe when none of the parts is spread over
    // several to begin with.
    if ([left, middle, right].some((t) => /[\r\n]/.test(t) || !t)) return null
    // Every operand came out of a comparison, so each is already tight enough to
    // sit in one — and a comparison binds tighter than the `and` it replaces, so
    // whatever surrounds it needs no new parentheses either.
    return [
      {
        start: boolOp.start,
        end: boolOp.end,
        newText: `${left} ${first.ops[0]} ${middle} ${second.ops[0]} ${right}`
      }
    ]
  }
})
