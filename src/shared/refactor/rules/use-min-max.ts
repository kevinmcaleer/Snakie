/**
 * Rule 76 — **Use min or max** (epic #634 §3.8).
 *
 * ```python
 * weakest = sorted(rssi)[0]            weakest = min(rssi)
 * strongest = sorted(rssi)[-1]         strongest = max(rssi)
 * hottest = sorted(temps, reverse=True)[0]   hottest = max(temps)
 * ```
 *
 * Sorting to look at one end is the most expensive way to ask a cheap question.
 * `sorted()` allocates a whole new list the size of the input and then does
 * O(n log n) comparisons to put every element in its place — and then all but
 * one of them is thrown away. `min()` and `max()` walk the iterable once, keep a
 * single reference, and allocate nothing.
 *
 * On a microcontroller that is the difference between a refactor and a fix: a
 * 500-sample buffer sorted on a Pico costs a second copy of the buffer in RAM
 * you may not have, and on a fragmented heap that is where `MemoryError` comes
 * from. `min`/`max` also take an iterator, so the source never has to be a list
 * at all.
 *
 * `key=` is carried across unchanged — `min`/`max` take the same argument — and
 * a literal `reverse=True` simply swaps which end is being asked for. Anything
 * else (`reverse=flag`, `**options`, a slice rather than an item, any index
 * other than the two ends) is left alone, because it is no longer the same
 * question.
 *
 * The one nuance worth knowing: with ties, `sorted(...)[-1]` hands back the
 * *last* of the equal elements and `max` the first. For numbers that is
 * indistinguishable; it is only visible when equal-comparing items are told
 * apart some other way, which is what the "Why?" article spells out.
 */
import type { AnyNode, Call, Expr, Subscript } from '../ast'
import { ancestors, unwrap, walk } from '../ast'
import { isCallTo, literalNumber, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface MinMaxMatch {
  subscript: Subscript
  call: Call
  /** The iterable being sorted. */
  iterable: Expr
  /** The `key=` argument to carry across, when there is one. */
  key?: Expr
  /** Which builtin replaces the whole expression. */
  builtin: 'min' | 'max'
}

/** Is this node bound to, rather than read? `sorted(xs)[0] = 1` is nobody's fix. */
function inTargetPosition(node: AnyNode): boolean {
  let child: AnyNode = node
  for (const parent of ancestors(node)) {
    switch (parent.type) {
      case 'Assign':
      case 'Delete':
        if (parent.targets.includes(child as Expr)) return true
        break
      case 'AugAssign':
      case 'AnnAssign':
        if (parent.target === child) return true
        break
      case 'For':
        if (parent.target === child) return true
        break
      case 'WithItem':
        if (parent.optionalVars === child) return true
        break
      default:
        break
    }
    child = parent
  }
  return false
}

/** `True`/`False` written as a literal, or null for anything we can't read. */
function literalBool(expr: Expr): boolean | null {
  const e = unwrap(expr)
  if (e.type !== 'Constant' || e.kind !== 'bool') return null
  return e.raw === 'True'
}

/** The match for one `sorted(...)[…]`, or null when it is a different question. */
function matchFor(subscript: Subscript): MinMaxMatch | null {
  const call = unwrap(subscript.value)
  if (call.type !== 'Call') return null
  if (!isCallTo(call, [], 'sorted')) return null
  // `sorted` takes exactly one iterable; `*args` hides how many there really are.
  if (call.args.length !== 1) return null
  const iterable = call.args[0]
  if (iterable.type === 'Starred') return null

  // Only `key=` and a literal `reverse=` keep the rewrite equivalent. `**opts`
  // (a keyword with no name) could be either, so it takes the refusal too.
  let key: Expr | undefined
  let reverse = false
  for (const kw of call.keywords) {
    if (kw.arg === 'key') {
      key = kw.value
    } else if (kw.arg === 'reverse') {
      const value = literalBool(kw.value)
      if (value === null) return null
      reverse = value
    } else {
      return null
    }
  }

  // Only the two ends of the sorted list are a min or a max. A `Slice` node
  // (`[:3]`, `[1:-1]`) and any computed index yield null here and are skipped.
  const index = literalNumber(subscript.slice)
  if (index !== 0 && index !== -1) return null

  const lowest = (index === 0) !== reverse
  return { subscript, call, iterable, key, builtin: lowest ? 'min' : 'max' }
}

export const useMinMaxRule = defineRule<MinMaxMatch>({
  id: 'use-min-max',
  title: 'Use min or max',
  message: 'Sorting to take one end builds a whole new list — `min`/`max` walk it once',
  catalogue: 76,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-min-max',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<MinMaxMatch>[] {
    const out: RefactorMatch<MinMaxMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Subscript') return
      const data = matchFor(node)
      if (!data) return
      if (inTargetPosition(node)) return
      out.push({
        ruleId: 'use-min-max',
        start: node.start,
        end: node.end,
        message: `\`sorted(…)\` builds a whole new list to take one end — use \`${data.builtin}\``,
        data
      })
    })
    return out
  },

  apply(match: RefactorMatch<MinMaxMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { subscript, iterable, key, builtin } = match.data
    const args = [textOf(ctx, iterable).trim()]
    if (key) args.push(`key=${textOf(ctx, key).trim()}`)
    return [{ start: subscript.start, end: subscript.end, newText: `${builtin}(${args.join(', ')})` }]
  }
})
