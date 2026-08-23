/**
 * Rule 70 — **Combine the isinstance checks** (epic #634 §3.3).
 *
 * ```python
 * if isinstance(reading, int) or isinstance(reading, float):
 *     return reading * SCALE
 *
 * # becomes
 * if isinstance(reading, (int, float)):
 *     return reading * SCALE
 * ```
 *
 * `isinstance` already takes a *tuple* of types and means "any of these", so the
 * chained `or` is spelling out by hand something the builtin does in one call.
 * The tuple form reads as the question actually being asked — "is this one of
 * the number types?" — puts the subject on screen once instead of once per
 * branch, and evaluates it once instead of N times. Adding a third accepted type
 * then becomes a one-word edit rather than another `or isinstance(…)` clause,
 * which is exactly where the copy-paste version grows a typo.
 *
 * The rewrite only fires when every operand asks about the *same* subject, in
 * identical source text, and that subject is pure — combining the calls collapses
 * N evaluations into one, so anything that could touch hardware is left alone.
 * The same goes for the types after the first: `or` short-circuits past them,
 * a tuple does not, so only side-effect-free ones may be folded in.
 */
import type { AnyNode, BoolOp, Call, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import type { TextEdit } from '../text'
import { isCallTo, isPureExpression, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface IsinstanceMatch {
  boolOp: BoolOp
}

/** Module spellings of the builtin we accept alongside a bare `isinstance`. */
const ISINSTANCE_MODULES = ['builtins'] as const

/** Is any comment inside `[start, end)`? Collapsing the range would eat it. */
function hasCommentIn(ctx: RefactorContext, start: number, end: number): boolean {
  return ctx.comments.some((c) => c.start >= start && c.start < end)
}

/**
 * The `isinstance(subject, …)` calls this `or` chain is made of, or null when
 * any operand is something else (a `None` check, a method call, a nested
 * `and` …). Keyword arguments and `*args` are refused rather than reasoned about.
 */
function isinstanceCalls(node: BoolOp): Call[] | null {
  const calls: Call[] = []
  for (const value of node.values) {
    const call = unwrap(value)
    if (call.type !== 'Call') return null
    if (!isCallTo(call, ISINSTANCE_MODULES, 'isinstance')) return null
    if (call.keywords.length > 0 || call.args.length !== 2) return null
    if (call.args.some((a) => unwrap(a).type === 'Starred')) return null
    calls.push(call)
  }
  return calls.length >= 2 ? calls : null
}

/**
 * The types one call accepts. A call that already passes a tuple contributes
 * its members, so `isinstance(x, (int, float)) or isinstance(x, str)` flattens
 * to one three-member tuple instead of nesting one inside another.
 */
function typesOf(call: Call): Expr[] | null {
  const arg = unwrap(call.args[1])
  if (arg.type === 'Tuple' && arg.parenthesized) {
    if (arg.elts.length === 0) return null
    if (arg.elts.some((e) => unwrap(e).type === 'Starred')) return null
    return arg.elts
  }
  return [arg]
}

/** The combined call, or null when the chain cannot be proved equivalent. */
function combined(ctx: RefactorContext, node: BoolOp): string | null {
  if (node.op !== 'or') return null
  const calls = isinstanceCalls(node)
  if (!calls) return null

  // One subject, spelled identically everywhere, and cheap enough that
  // evaluating it once instead of N times cannot change what the file does.
  const subject = textOf(ctx, calls[0].args[0]).trim()
  if (!calls.every((c) => textOf(ctx, c.args[0]).trim() === subject)) return null
  if (!isPureExpression(calls[0].args[0])) return null

  // `isinstance` vs `builtins.isinstance` — keep whichever spelling was used,
  // but refuse a chain that mixes the two rather than picking one for the user.
  const fn = textOf(ctx, calls[0].func).trim()
  if (!calls.every((c) => textOf(ctx, c.func).trim() === fn)) return null

  const types: string[] = []
  for (let i = 0; i < calls.length; i++) {
    const exprs = typesOf(calls[i])
    if (!exprs) return null
    // `or` only reaches the later operands when the earlier checks fail, but a
    // tuple evaluates every member — so anything past the first has to be free
    // of side effects or the rewrite would start running it every time.
    if (i > 0 && !exprs.every(isPureExpression)) return null
    types.push(...exprs.map((e) => textOf(ctx, e).trim()))
  }
  if (types.length < 2) return null

  const text = `${fn}(${subject}, (${types.join(', ')}))`
  // A chain split over several lines may carry a comment we would delete, and a
  // multi-line argument would fold into an unreadable one-liner.
  if (/[\r\n]/.test(text)) return null
  if (hasCommentIn(ctx, node.start, node.end)) return null
  return text
}

export const isinstanceTupleRule = defineRule<IsinstanceMatch>({
  id: 'isinstance-tuple',
  title: 'Combine the isinstance checks',
  message: '`isinstance` accepts a tuple of types — these `or`s can be one call',
  catalogue: 70,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-isinstance-tuple',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<IsinstanceMatch>[] {
    const out: RefactorMatch<IsinstanceMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'BoolOp') return
      // Only offer what `apply` can actually deliver, so the Problems panel
      // never shows a hint with no fix behind it.
      if (combined(ctx, node) == null) return
      out.push({
        ruleId: 'isinstance-tuple',
        start: node.start,
        end: node.end,
        data: { boolOp: node }
      })
    })
    return out
  },

  apply(match: RefactorMatch<IsinstanceMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { boolOp } = match.data
    const text = combined(ctx, boolOp)
    if (text == null) return null
    // A call binds tighter than every operator the `or` chain could have sat
    // under, so the replacement never needs parentheses of its own.
    return [{ start: boolOp.start, end: boolOp.end, newText: text }]
  }
})
