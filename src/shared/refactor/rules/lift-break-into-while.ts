/**
 * Rule 65 — **Lift the break into the loop condition** (epic #634 §3.8).
 *
 * ```python
 * while True:                          while sonar.distance_cm() >= 15:
 *     if sonar.distance_cm() < 15:         rover.forward(40)
 *         break                            time.sleep_ms(50)
 *     rover.forward(40)
 *     time.sleep_ms(50)
 * ```
 *
 * `while True:` tells the reader nothing, so they have to scan the body for the
 * `break` that actually ends it. When that `break` is the very first thing in
 * the loop it *is* the loop condition, just written a line too late — hoisting
 * it into the `while` puts the reason the loop stops where a reader looks for
 * it, and drops two lines and an indent level on the way.
 *
 * The condition is tested at the top of the cycle either way, so a condition
 * that touches hardware (`sonar.distance_cm()`) is evaluated exactly as often
 * as before. What we do decline is a `while … else:` — its `else` is dead code
 * under `while True:` and would spring to life once the loop can end normally —
 * and any loop containing a `continue`, where proving the two forms take the
 * same path back to the top is more than this rule is willing to claim.
 */
import type { AnyNode, IfStmt, WhileStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { invertCondition } from '../expr'
import { fullLineRange, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface LiftBreakMatch {
  loop: WhileStmt
  /** The leading `if <cond>: break`. */
  guard: IfStmt
}

/**
 * Does a `continue` belonging to THIS loop appear in its body? A `continue`
 * inside a nested `for`/`while` binds to that loop instead, and one inside a
 * nested `def` cannot bind here at all, so both are skipped.
 */
function hasOwnContinue(loop: WhileStmt): boolean {
  let found = false
  for (const stmt of loop.body) {
    walk(stmt, (n) => {
      if (n.type === 'For' || n.type === 'While') return false
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      if (n.type === 'Continue') found = true
      return undefined
    })
  }
  return found
}

export const liftBreakIntoWhileRule = defineRule<LiftBreakMatch>({
  id: 'lift-break-into-while',
  title: 'Lift the break into the loop condition',
  message: 'This `while True:` breaks on its first line — that test is the loop condition',
  catalogue: 65,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-lift-break-into-while',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<LiftBreakMatch>[] {
    const out: RefactorMatch<LiftBreakMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'While') return
      const test = unwrap(node.test)
      if (test.type !== 'Constant' || test.kind !== 'bool' || test.raw !== 'True') return
      // `while True: … else:` never reaches its `else`; giving the loop a real
      // condition would let it run, which is a behaviour change, not a tidy-up.
      if (node.orelse.length > 0) return
      // Nothing after the guard means the loop body would be emptied.
      if (node.body.length < 2) return

      const guard = node.body[0]
      if (guard.type !== 'If') return
      if (guard.isElif || guard.orelse.length > 0) return
      if (guard.body.length !== 1 || guard.body[0].type !== 'Break') return

      if (hasOwnContinue(node)) return

      // The guard's lines are deleted outright, so a comment on either of them
      // would go with them — and one sitting between the `while` header and the
      // guard is describing a `break` that is about to stop existing.
      const headerEnd = lineEnd(ctx.src, node.test.end)
      const from = lineStart(ctx.src, guard.start)
      const to = lineEnd(ctx.src, guard.end)
      if (ctx.comments.some((c) => c.start >= headerEnd && c.start < to)) return

      // A wrapped condition would be re-joined onto the `while` line without
      // its brackets, which need not even parse. Leave those alone.
      if (ctx.lines.positionAt(guard.test.start).line !== ctx.lines.positionAt(guard.test.end).line) {
        return
      }
      // The guard must own its lines outright for a whole-line delete to be
      // safe: `while True:` and the `if` are never on the same line, but the
      // statement after the guard must not share the `break`'s line either.
      if (from <= node.test.end || to > node.body[1].start) return

      out.push({
        ruleId: 'lift-break-into-while',
        start: node.start,
        end: guard.end,
        data: { loop: node, guard }
      })
    })
    return out
  },

  apply(match: RefactorMatch<LiftBreakMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, guard } = match.data
    const condition = invertCondition(ctx, guard.test)
    if (!condition.trim() || /[\r\n]/.test(condition)) return null
    const region = fullLineRange(ctx.src, guard)
    // The remaining body keeps its indentation — it was already one level
    // inside the loop and it still is.
    return [
      { start: loop.test.start, end: loop.test.end, newText: condition },
      { start: region.start, end: region.end, newText: '' }
    ]
  }
})
