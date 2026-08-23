/**
 * Rule 16 — **Simplify the comparison** (epic #634 §3.3).
 *
 * ```python
 * if ready == True:            if ready:
 *     arm()                        arm()
 *
 * if sensor.fault != True:     if not sensor.fault:
 *     go()                         go()
 *
 * if bus == None:              if bus is None:
 *     return -1                    return -1
 * ```
 *
 * Two different smells wearing the same shirt. Comparing a flag with `True` or
 * `False` is the beginner tell that a value is already the condition — the
 * comparison adds a word and takes one away, and `flag == True` quietly means
 * something *different* from `flag` for anything that isn't a bool, which is a
 * bug waiting for the day a driver returns `1` instead of `True`.
 *
 * `== None` is worse than noisy: `None` is a singleton, so identity is the
 * question, and a class that defines `__eq__` can make `x == None` say True for
 * an object that is emphatically not `None`. PEP 8 makes `is None` the rule, and
 * this one is the correct idiom **everywhere**, so — unlike the `True`/`False`
 * rewrites — it is not restricted to conditions.
 *
 * The `True`/`False` rewrites only fire where the value is used as a condition
 * (an `if`/`while` test, a comprehension guard, an operand of `and`/`or`/`not`).
 * `ok = flag == True` stores a bool where `ok = flag` stores the flag, so
 * outside a condition the rule declines.
 */
import type { AnyNode, Compare } from '../ast'
import { unwrap, walk } from '../ast'
import { textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { isConditionContext, negate } from './simplify-truthiness'

/** What the rewrite should leave behind. */
type Rewrite = 'value' | 'not' | 'is' | 'is not'

interface ComparisonMatch {
  compare: Compare
  rewrite: Rewrite
}

/** `x == True` → 'value', `x != False` → 'value', `x == None` → 'is', … */
function rewriteFor(op: string, literal: string): Rewrite | null {
  if (literal === 'None') {
    if (op === '==') return 'is'
    if (op === '!=') return 'is not'
    return null
  }
  if (literal !== 'True' && literal !== 'False') return null
  const isTrue = literal === 'True'
  if (op === '==') return isTrue ? 'value' : 'not'
  if (op === '!=') return isTrue ? 'not' : 'value'
  return null
}

/**
 * The source between the two operands — the operator, plus whatever spacing,
 * line continuation or comment the user put around it.
 */
function operatorGap(ctx: RefactorContext, compare: Compare): string {
  return ctx.src.slice(compare.left.end, compare.comparators[0].start)
}

export const simplifyComparisonRule = defineRule<ComparisonMatch>({
  id: 'simplify-comparison',
  title: 'Simplify the comparison',
  message: 'Comparing with `True`, `False` or `None` — say it directly',
  catalogue: 16,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-simplify-comparison',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ComparisonMatch>[] {
    const out: RefactorMatch<ComparisonMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      // A chained `a == b == True` compares three things; unpicking it is a
      // different (and much less obviously safe) rewrite.
      if (node.type !== 'Compare' || node.ops.length !== 1) return
      const right = unwrap(node.comparators[0])
      if (right.type !== 'Constant' || (right.kind !== 'bool' && right.kind !== 'none')) return
      // Only `x == True`, never `True == x`: swapping the operands would swap
      // the order they are evaluated in.
      const rewrite = rewriteFor(node.ops[0], right.raw)
      if (!rewrite) return
      // `is None` is right anywhere; dropping a `== True` is only right where
      // the truthiness is what gets used.
      if (rewrite !== 'is' && rewrite !== 'is not' && !isConditionContext(node)) return
      // A comment between the operands would be inside the range we replace.
      if (operatorGap(ctx, node).includes('#')) return
      out.push({
        ruleId: 'simplify-comparison',
        start: node.start,
        end: node.end,
        title:
          rewrite === 'is' || rewrite === 'is not'
            ? `Use \`${rewrite} None\``
            : 'Simplify the comparison',
        message:
          rewrite === 'is' || rewrite === 'is not'
            ? '`None` is a singleton — compare it with `' + rewrite + '`, not `' + node.ops[0] + '`'
            : 'The value is already the condition — drop the `' + right.raw + '` comparison',
        data: { compare: node, rewrite }
      })
    })
    return out
  },

  apply(match: RefactorMatch<ComparisonMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { compare, rewrite } = match.data
    const left = textOf(ctx, compare.left)
    if (!left.trim()) return null

    if (rewrite === 'is' || rewrite === 'is not') {
      // Replace the operator alone, so spacing and any line continuation the
      // user wrote around the comparison survive untouched.
      const gap = operatorGap(ctx, compare)
      if (gap.includes('#')) return null
      const at = gap.indexOf(compare.ops[0])
      if (at < 0) return null
      return [
        {
          start: compare.left.end + at,
          end: compare.left.end + at + compare.ops[0].length,
          newText: rewrite
        }
      ]
    }

    // `left` came out of a comparison, so it binds tighter than `not` and tighter
    // than `and`/`or` — the only place it needs bracketing is under another
    // `not`, which `negate` handles.
    return [
      {
        start: compare.start,
        end: compare.end,
        newText: rewrite === 'value' ? left : negate(left, compare)
      }
    ]
  }
})
