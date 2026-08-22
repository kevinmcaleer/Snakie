/**
 * Rule 73 — **Swap with a tuple assignment** (epic #634 §3.8).
 *
 * ```python
 * tmp = left_speed              left_speed, right_speed = right_speed, left_speed
 * left_speed = right_speed
 * right_speed = tmp
 * ```
 *
 * Python builds the right-hand tuple *before* it binds anything, so the middle
 * variable the three-line version needs simply is not needed. Three statements
 * that only make sense read together become one that says "swap these", and the
 * scratch name — the one you have to check is not used anywhere else, and that
 * goes stale when someone edits two of the three lines — disappears.
 *
 * The rule only fires when it can prove the temporary really is a temporary:
 * written exactly once, read exactly once, and dead afterwards. Both swapped
 * expressions must be pure (a name or a dotted attribute), because the tuple
 * form evaluates each of them one more time than the original — and on a board,
 * an extra evaluation can mean an extra bus transaction. That purity rule is
 * also why `data[i]`/`data[j]` swaps are left alone: `__getitem__` is a call.
 */
import type { AnyNode, Assign, Expr, Stmt } from '../ast'
import { blocksOf, unwrap, walk } from '../ast'
import { isPureExpression, textOf } from '../expr'
import { bodyOf, isReadAfter, referencesTo, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface SwapMatch {
  /** `tmp = a` */
  first: Assign
  /** `a = b` */
  second: Assign
  /** `b = tmp` */
  third: Assign
  /** Source text of the two swapped expressions. */
  a: string
  b: string
}

/** Every statement list in the file, so we can look at consecutive triples. */
function eachBlock(ctx: RefactorContext, fn: (stmts: Stmt[]) => void): void {
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) fn(block)
  })
}

/** A single-target assignment's target and value, or null. */
function simple(stmt: Stmt): { target: Expr; value: Expr } | null {
  if (stmt.type !== 'Assign' || stmt.targets.length !== 1) return null
  return { target: unwrap(stmt.targets[0]), value: unwrap(stmt.value) }
}

/**
 * Can this expression stand on both sides of a tuple swap? A name or a dotted
 * attribute over names — anything that costs nothing to evaluate twice and
 * cannot have side effects. Subscripts and calls are excluded by purity.
 */
function swappable(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Name' && e.type !== 'Attribute') return false
  return isPureExpression(e)
}

/** Does the enclosing scope declare `name` global/nonlocal? Then it is not ours. */
function declaredElsewhere(node: AnyNode, name: string): boolean {
  let found = false
  for (const stmt of bodyOf(scopeOf(node))) {
    walk(stmt, (n) => {
      if ((n.type === 'Global' || n.type === 'Nonlocal') && n.names.includes(name)) found = true
    })
  }
  return found
}

/** The rewrite, shared by `detect` and `apply`. */
function rewrite(ctx: RefactorContext, data: SwapMatch): TextEdit[] | null {
  const { first, third, a, b } = data
  const from = lineStart(ctx.src, first.start)
  const to = lineEnd(ctx.src, third.end)
  // The three statements must own their lines: a `;` neighbour would be lost.
  if (ctx.src.slice(from, first.start).trim() !== '') return null
  if (ctx.src.slice(third.end, to).trim() !== '') return null
  // A comment on any of the three lines has nowhere to go afterwards.
  if (ctx.comments.some((c) => c.start >= from && c.start < to)) return null

  const indent = indentAt(ctx.src, first.start)
  const hadNewline = to > from && ctx.src[to - 1] === '\n'
  return [
    {
      start: from,
      end: to,
      newText: `${indent}${a}, ${b} = ${b}, ${a}` + (hadNewline ? ctx.eol : '')
    }
  ]
}

export const tupleSwapRule = defineRule<SwapMatch>({
  id: 'tuple-swap',
  title: 'Swap with a tuple assignment',
  message: 'These three lines swap two values — Python does that in one',
  catalogue: 73,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-tuple-swap',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<SwapMatch>[] {
    const out: RefactorMatch<SwapMatch>[] = []
    eachBlock(ctx, (block) => {
      for (let i = 0; i + 2 < block.length; i++) {
        const first = simple(block[i])
        const second = simple(block[i + 1])
        const third = simple(block[i + 2])
        if (!first || !second || !third) continue

        // `tmp = a`
        if (first.target.type !== 'Name') continue
        const tmp = first.target.id
        // `b = tmp`
        if (third.value.type !== 'Name' || third.value.id !== tmp) continue

        const a = textOf(ctx, first.value).trim()
        const b = textOf(ctx, second.value).trim()
        // `a = b` must assign to the very thing we stashed, and `b = tmp` to the
        // very thing we read — compared as source text, so `self.x` counts.
        if (textOf(ctx, second.target).trim() !== a) continue
        if (textOf(ctx, third.target).trim() !== b) continue

        if (!swappable(first.value) || !swappable(second.value)) continue
        if (!swappable(second.target) || !swappable(third.target)) continue
        if (a === b) continue
        // Overlapping expressions (`obj` and `obj.x`) alias each other; the two
        // forms are still equivalent, but proving it is not worth the risk.
        if (a.includes(b) || b.includes(a)) continue
        if (a === tmp || b === tmp) continue

        // The temporary must be exactly that: written once (here), read once
        // (here), dead afterwards, and not shared with another scope.
        const scope = scopeOf(block[i])
        const uses = referencesTo(scope, tmp)
        const writes = uses.filter((u) => u.kind === 'write')
        const reads = uses.filter((u) => u.kind === 'read')
        if (writes.length !== 1 || reads.length !== 1) continue
        const stmt1 = block[i] as Assign
        const stmt3 = block[i + 2] as Assign
        if (writes[0].node.start < stmt1.start || writes[0].node.end > stmt1.end) continue
        if (reads[0].node.start < stmt3.start || reads[0].node.end > stmt3.end) continue
        if (isReadAfter(scope, tmp, stmt3.end)) continue
        if (declaredElsewhere(stmt1, tmp)) continue

        const data: SwapMatch = { first: stmt1, second: block[i + 1] as Assign, third: stmt3, a, b }
        if (!rewrite(ctx, data)) continue
        out.push({ ruleId: 'tuple-swap', start: stmt1.start, end: stmt3.end, data })
        // The three lines are consumed; don't start another triple inside them.
        i += 2
      }
    })
    return out
  },

  apply(match: RefactorMatch<SwapMatch>, ctx: RefactorContext): TextEdit[] | null {
    return rewrite(ctx, match.data)
  }
})
