/**
 * Rule 22 — **Collect the pieces and join them** (epic #634 §3.4).
 *
 * ```python
 * line = ""                     parts = []
 * for reading in readings:      for reading in readings:
 *     line += "%d," % reading       parts.append("%d," % reading)
 *                               line = "".join(parts)
 * ```
 *
 * This one is a `warning`, not a style hint, because on a microcontroller it is
 * a real performance bug. Python strings are immutable, so `line += piece`
 * allocates a brand-new string and copies everything accumulated so far —
 * building an *n*-piece string costs O(n²) copying. On CPython you may never
 * notice; on a Pico with a few tens of kilobytes of heap you notice twice: the
 * loop slows down as it goes, and every discarded intermediate leaves a hole
 * that fragments the heap until an allocation that *should* fit fails.
 *
 * Appending to a list and joining once at the end does a single allocation of
 * the final size. Same output, one copy.
 *
 * The rule declines when the accumulator is read inside the loop, when the loop
 * has an `else`, and when the loop sits in a `try` body — there, an exception
 * mid-loop leaves the original holding a partial string and the rewrite holding
 * an empty one, which is a difference a handler could see.
 */
import type { AnyNode, Assign, AugAssign, ForStmt, Stmt } from '../ast'
import { ancestors, blocksOf, unwrap, walk } from '../ast'
import { textOf } from '../expr'
import { freshName, isScope, scopeOf } from '../scope'
import { indentAt, lineEnd } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface JoinMatch {
  assign: Assign
  loop: ForStmt
  aug: AugAssign
  /** The accumulator's name. */
  name: string
  /** The empty string exactly as the user wrote it — `""` or `''`. */
  quote: string
}

/** Every statement list in the file, so we can look at consecutive pairs. */
function eachBlock(ctx: RefactorContext, fn: (stmts: Stmt[]) => void): void {
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) fn(block)
  })
}

/** How many times `name` appears as a bare name anywhere inside `node`. */
function nameCount(node: AnyNode, name: string): number {
  let n = 0
  walk(node, (child) => {
    if (child.type === 'Name' && child.id === name) n++
  })
  return n
}

/**
 * Is `node` inside the `try:` block of a `try` in the same function? An
 * exception escaping the loop is the one case where "" and a partial string are
 * distinguishable, so we leave those alone.
 */
function insideTryBody(node: AnyNode): boolean {
  let child: AnyNode = node
  for (const a of ancestors(node)) {
    if (isScope(a)) return false
    if (a.type === 'Try' && a.body.some((s) => s === child)) return true
    child = a
  }
  return false
}

/**
 * Where to put the `join` line: after the loop, but past any comment lines that
 * are indented as part of the loop body — they belong to the loop, not to us.
 */
function insertionPoint(ctx: RefactorContext, loop: ForStmt): number {
  const depth = indentAt(ctx.src, loop.start).length
  let at = lineEnd(ctx.src, loop.end)
  for (;;) {
    if (at >= ctx.src.length) return at
    const end = lineEnd(ctx.src, at)
    const line = ctx.src.slice(at, end)
    const lead = line.length - line.trimStart().length
    if (!line.trimStart().startsWith('#') || lead <= depth) return at
    at = end
  }
}

/**
 * The whole rewrite, shared by `detect` and `apply` so we never report a smell
 * whose fix would then decline.
 */
function rewrite(ctx: RefactorContext, data: JoinMatch): TextEdit[] | null {
  const { assign, loop, aug, name, quote } = data

  // `s += a, b` builds a tuple, and `append(a, b)` is two arguments — not the
  // same statement at all.
  const value = unwrap(aug.value)
  if (value.type === 'Tuple' && !value.parenthesized) return null
  if (value.type === 'Starred' || value.type === 'Yield') return null

  const parts = freshName(scopeOf(assign), 'parts')
  const indent = indentAt(ctx.src, loop.start)
  const at = insertionPoint(ctx, loop)
  const line = `${indent}${name} = ${quote}.join(${parts})`
  // At end of file with no trailing newline, start the new line ourselves.
  const needsLeadingEol = at >= ctx.src.length && !ctx.src.endsWith('\n') && ctx.src.length > 0
  const newText = needsLeadingEol ? `${ctx.eol}${line}` : `${line}${ctx.eol}`

  return [
    { start: assign.start, end: assign.end, newText: `${parts} = []` },
    { start: aug.start, end: aug.end, newText: `${parts}.append(${textOf(ctx, aug.value)})` },
    { start: at, end: at, newText }
  ]
}

export const joinStringsRule = defineRule<JoinMatch>({
  id: 'join-strings',
  title: 'Collect the pieces and join them',
  message: 'Building a string with `+=` in a loop is O(n²) and fragments the heap',
  catalogue: 22,
  category: 'loops',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-join-strings',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<JoinMatch>[] {
    const out: RefactorMatch<JoinMatch>[] = []
    eachBlock(ctx, (block) => {
      for (let i = 0; i + 1 < block.length; i++) {
        const assign = block[i]
        const loop = block[i + 1]
        if (assign.type !== 'Assign' || loop.type !== 'For') continue
        if (assign.targets.length !== 1) continue
        const target = unwrap(assign.targets[0])
        if (target.type !== 'Name') continue

        // `s = ""` — a plain empty string, no `b`/`f`/`r` prefix, no triple quotes.
        const value = unwrap(assign.value)
        if (value.type !== 'Constant' || value.kind !== 'string') continue
        if (value.prefix) continue
        if (value.raw !== '""' && value.raw !== "''") continue

        if (loop.isAsync || loop.orelse.length > 0) continue
        if (loop.body.length !== 1) continue
        const aug = loop.body[0]
        if (aug.type !== 'AugAssign' || aug.op !== '+') continue
        const augTarget = unwrap(aug.target)
        if (augTarget.type !== 'Name' || augTarget.id !== target.id) continue

        // The accumulator must appear exactly once in the loop — as the thing
        // being added to. `s += s` or `if s: …` means the loop reads back what
        // it has built, which a list of pieces cannot reproduce.
        if (nameCount(loop as AnyNode, target.id) !== 1) continue
        if (insideTryBody(loop as AnyNode)) continue

        const data: JoinMatch = {
          assign,
          loop,
          aug,
          name: target.id,
          quote: value.raw
        }
        if (!rewrite(ctx, data)) continue
        out.push({
          ruleId: 'join-strings',
          start: assign.start,
          end: loop.end,
          data
        })
      }
    })
    return out
  },

  apply(match: RefactorMatch<JoinMatch>, ctx: RefactorContext): TextEdit[] | null {
    return rewrite(ctx, match.data)
  }
})
