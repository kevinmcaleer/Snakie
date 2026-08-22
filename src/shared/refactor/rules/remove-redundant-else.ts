/**
 * Rule 3 — **Remove the redundant else** (epic #634 §3.1, phase R1).
 *
 * When the `if` branch always leaves — `return`, `raise`, `break`, `continue` —
 * the `else` is decoration. Nothing after the `if` can run when the test was
 * true, so the else body may simply follow it:
 *
 * ```python
 * def battery_state(mv):          def battery_state(mv):
 *     if mv < 3300:                   if mv < 3300:
 *         return "flat"                   return "flat"
 *     else:                           log("still going")
 *         log("still going")          return "ok"
 *         return "ok"
 * ```
 *
 * The win is the same one guard clauses buy: the branch that keeps going stops
 * being indented for a condition it has already passed. It is also the shape
 * that lets a long `if/elif/else` ladder unroll into a flat sequence of checks.
 *
 * Two things make this unsafe and are refused. An `elif` after the `if` is a
 * chain, not an else — unrolling it is a different rewrite. And when the `if`
 * being flattened is itself an `elif`, every earlier branch of the chain must
 * leave too, or code that used to be skipped would start running; the rule walks
 * the chain and proves that before offering.
 */
import type { IfStmt, Stmt } from '../ast'
import type { AnyNode } from '../ast'
import { TERMINATORS, walk } from '../ast'
import { dedent, indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { colonAfter } from './guard-clause'

interface RedundantElseMatch {
  ifStmt: IfStmt
  /** Offset of the `else` keyword. */
  elseStart: number
}

/** Does this block always leave, so nothing after the `if` can follow it? */
function alwaysLeaves(body: readonly Stmt[]): boolean {
  if (body.length === 0) return false
  return TERMINATORS.has(body[body.length - 1].type)
}

/**
 * For an `elif`, every branch before it must leave as well — otherwise dedenting
 * the else body out of the chain would put it in the path of a branch that falls
 * through. Returns false if the chain cannot be proven safe.
 */
function chainAlwaysLeaves(node: IfStmt): boolean {
  let cur: IfStmt = node
  while (cur.isElif) {
    const parent = cur.parent
    if (!parent || parent.type !== 'If') return false
    if (parent.orelse[0] !== cur) return false
    if (!alwaysLeaves(parent.body)) return false
    cur = parent
  }
  return true
}

export const removeRedundantElseRule = defineRule<RedundantElseMatch>({
  id: 'remove-redundant-else',
  title: 'Remove the redundant else',
  message: 'The `if` branch always leaves, so this `else` only adds indentation',
  catalogue: 3,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-remove-redundant-else',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<RedundantElseMatch>[] {
    const out: RefactorMatch<RedundantElseMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      if (node.orelse.length === 0) return
      // `elif` is a chain, not an else — rule 67 unrolls those.
      if (node.orelse[0].type === 'If' && node.orelse[0].isElif) return
      if (!alwaysLeaves(node.body)) return
      if (!chainAlwaysLeaves(node)) return
      const elseStart = node.orelseStart
      if (elseStart == null) return
      // `else: log()` on one line has no block to dedent.
      if (
        ctx.lines.positionAt(elseStart).line === ctx.lines.positionAt(node.orelse[0].start).line
      ) {
        return
      }
      const colonEnd = colonAfter(ctx.src, elseStart)
      if (colonEnd < 0) return
      out.push({
        ruleId: 'remove-redundant-else',
        start: elseStart,
        end: colonEnd,
        data: { ifStmt: node, elseStart }
      })
    })
    return out
  },

  apply(match: RefactorMatch<RedundantElseMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt, elseStart } = match.data
    const unit = ctx.indentUnit

    const colonEnd = colonAfter(ctx.src, elseStart)
    if (colonEnd < 0) return null

    // The whole `else:` line goes, so nothing but whitespace may share it.
    const headStart = lineStart(ctx.src, elseStart)
    if (ctx.src.slice(headStart, elseStart).trim() !== '') return null
    const headerTail = ctx.src.slice(colonEnd, lineEnd(ctx.src, colonEnd))
    // A trailing comment on `else:` would die with the line — decline instead.
    if (headerTail.trim() !== '') return null

    // One dedent has to land the body exactly on the `if`'s own column. If the
    // block was written deeper than one unit, removing a unit would leave it
    // nested inside the `if` — code that still parses but never runs.
    if (indentAt(ctx.src, ifStmt.orelse[0].start) !== indentAt(ctx.src, elseStart) + unit) {
      return null
    }

    // Everything below the header travels up one level, comments included.
    const bodyRegionStart = lineEnd(ctx.src, colonEnd)
    if (bodyRegionStart <= colonEnd || bodyRegionStart > ifStmt.end) return null
    const bodyText = ctx.src.slice(bodyRegionStart, ifStmt.end)
    if (!bodyText.split('\n').some((l) => l.trim())) return null

    return [{ start: headStart, end: ifStmt.end, newText: dedent(bodyText, unit) }]
  }
})
