/**
 * Rule 71 — **Use a membership test** (epic #634 §3.3).
 *
 * ```python
 * if command == "stop" or command == "halt":     if command in ("stop", "halt"):
 *     motors.brake()                                 motors.brake()
 *
 * if code != 200 and code != 204:                if code not in (200, 204):
 *     raise OSError(code)                            raise OSError(code)
 * ```
 *
 * The `or` chain makes the reader check that it is the *same* variable in every
 * clause and that the operator never flips half way along — the two mistakes
 * this shape actually produces (`command == "stop" or command == "halt" or
 * "quit"` is always true, and nobody spots it). `in` states the question once:
 * is this value one of these? Adding another accepted value is then a comma, and
 * the list can later move out to a named constant without touching the test.
 *
 * The `!=` / `and` chain is the same smell inverted, and becomes `not in`.
 * Mixing the two (`x == 1 or x != 2`) is left alone — it is far more likely to
 * be a bug than a smell, and guessing which half was meant is not our job. So
 * is a chain whose later candidates do work: `or` never reaches them once an
 * earlier test passes, but a tuple builds every member before testing anything.
 */
import type { AnyNode, BoolOp, Compare } from '../ast'
import { unwrap, walk } from '../ast'
import type { TextEdit } from '../text'
import { isPureExpression, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface MembershipMatch {
  boolOp: BoolOp
}

/** `a or b` collapses `==` into `in`; `a and b` collapses `!=` into `not in`. */
const FORMS = {
  or: { compare: '==', membership: 'in' },
  and: { compare: '!=', membership: 'not in' }
} as const

/** Is any comment inside `[start, end)`? Collapsing the range would eat it. */
function hasCommentIn(ctx: RefactorContext, start: number, end: number): boolean {
  return ctx.comments.some((c) => c.start >= start && c.start < end)
}

/**
 * The chain's comparisons, all using `op`, or null. A chained comparison
 * (`a < b < c`) has more than one operator and is never one of these.
 */
function comparisons(node: BoolOp, op: string): Compare[] | null {
  const out: Compare[] = []
  for (const value of node.values) {
    const cmp = unwrap(value)
    if (cmp.type !== 'Compare') return null
    if (cmp.ops.length !== 1 || cmp.ops[0] !== op) return null
    out.push(cmp)
  }
  return out.length >= 2 ? out : null
}

/** The membership test replacing this chain, or null when it isn't equivalent. */
function membership(ctx: RefactorContext, node: BoolOp): string | null {
  const form = FORMS[node.op]
  const chain = comparisons(node, form.compare)
  if (!chain) return null

  // One subject, spelled identically everywhere, and cheap enough that testing
  // it once instead of N times cannot change what the file does.
  const subject = textOf(ctx, chain[0].left).trim()
  if (!chain.every((c) => textOf(ctx, c.left).trim() === subject)) return null
  if (!isPureExpression(chain[0].left)) return null

  // The chain short-circuits past the later candidates; a tuple evaluates every
  // one of them. Only the first may do work, because it always ran anyway.
  if (!chain.slice(1).every((c) => isPureExpression(c.comparators[0]))) return null
  const values = chain.map((c) => textOf(ctx, c.comparators[0]).trim())

  // `in` binds like the `==` it replaces, so the subject never needs new
  // parentheses; the candidates keep the exact text the user wrote.
  const text = `${subject} ${form.membership} (${values.join(', ')})`
  // A chain split over several lines may carry a comment we would delete, and a
  // multi-line operand would fold into an unreadable one-liner.
  if (/[\r\n]/.test(text)) return null
  if (hasCommentIn(ctx, node.start, node.end)) return null
  return text
}

export const membershipTestRule = defineRule<MembershipMatch>({
  id: 'membership-test',
  title: 'Use a membership test',
  message: 'Comparing the same value again and again — `in` says this in one test',
  catalogue: 71,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-membership-test',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<MembershipMatch>[] {
    const out: RefactorMatch<MembershipMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'BoolOp') return
      // Only offer what `apply` can actually deliver, so the Problems panel
      // never shows a hint with no fix behind it.
      if (membership(ctx, node) == null) return
      out.push({
        ruleId: 'membership-test',
        start: node.start,
        end: node.end,
        data: { boolOp: node }
      })
    })
    return out
  },

  apply(match: RefactorMatch<MembershipMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { boolOp } = match.data
    const text = membership(ctx, boolOp)
    if (text == null) return null
    // A comparison binds tighter than the `and`/`or` chain it replaces, so the
    // result drops straight into the hole the chain left.
    return [{ start: boolOp.start, end: boolOp.end, newText: text }]
  }
})
