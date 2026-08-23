/**
 * Rule 19 — **Build the list with a comprehension** (epic #634 §3.4).
 *
 * ```python
 * readings = []                          readings = [p.read_u16() for p in pins]
 * for p in pins:
 *     readings.append(p.read_u16())
 *
 * fast = []                              fast = [s for s in samples if s > 900]
 * for s in samples:
 *     if s > 900:
 *         fast.append(s)
 * ```
 *
 * An empty list followed by a loop that only appends is one idea written as
 * three statements: *this list is that sequence, transformed*. The comprehension
 * says it in one line, and the reader no longer has to hold "is anything else
 * happening to `readings` in there?" in their head while they scan the loop.
 *
 * **The on-device caveat, which is why this rule is fussier than a desktop
 * linter would be:** a comprehension allocates the whole list up front, so on a
 * microcontroller with tens of kilobytes of heap it can be *worse* than
 * appending — a big enough allocation fails outright where a slowly-growing list
 * would have survived, and it cannot be swapped for a generator later without
 * rewriting the line. That is why we never offer it for `range(N)` with a large
 * literal bound: at that size the loop is the kinder shape, and the honest
 * advice is a generator expression, not a list.
 *
 * The rule also declines when the loop variable is read after the loop —
 * a `for` leaks its target, a comprehension does not.
 */
import type { AnyNode, Assign, Call, Expr, ForStmt, Stmt } from '../ast'
import { blocksOf, unwrap, walk } from '../ast'
import { isCallTo, literalNumber, textOf } from '../expr'
import { isReadAfter, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ComprehensionMatch {
  assign: Assign
  loop: ForStmt
  /** The expression handed to `append`, which becomes the comprehension's element. */
  elt: Expr
  /** The condition of the wrapping `if`, when the append is guarded. */
  guard?: Expr
}

/** Longest line we are willing to produce; past this the loop reads better. */
const MAX_LINE = 100

/**
 * Literal `range()` bound past which a comprehension's single big allocation is
 * a worse trade than appending (see the note at the top of the file).
 */
const MAX_RANGE = 1000

/** Every statement list in the file, so we can look at consecutive pairs. */
function eachBlock(ctx: RefactorContext, fn: (stmts: Stmt[]) => void): void {
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) fn(block)
  })
}

/** `name.append(x)` as a statement, with exactly one ordinary argument. */
function appendCall(stmt: Stmt, name: string): Call | null {
  if (stmt.type !== 'ExprStmt') return null
  const call = unwrap(stmt.value)
  if (call.type !== 'Call') return null
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const arg = call.args[0]
  // `append(*rest)` and `append(x for x in xs)` are not elements.
  if (arg.type === 'Starred' || arg.type === 'GeneratorExp' || arg.type === 'Yield') return null
  const fn = unwrap(call.func)
  if (fn.type !== 'Attribute' || fn.attr !== 'append') return null
  const base = unwrap(fn.value)
  return base.type === 'Name' && base.id === name ? call : null
}

/** The loop body as an element (+ optional guard), or null if it is anything else. */
function bodyShape(loop: ForStmt, name: string): { elt: Expr; guard?: Expr } | null {
  if (loop.body.length !== 1) return null
  const only = loop.body[0]
  const direct = appendCall(only, name)
  if (direct) return { elt: direct.args[0] }
  // `if cond: result.append(x)` — the one wrapper a comprehension can absorb.
  if (only.type !== 'If') return null
  if (only.orelse.length > 0 || only.body.length !== 1) return null
  const inner = appendCall(only.body[0], name)
  return inner ? { elt: inner.args[0], guard: only.test } : null
}

/**
 * Expressions that are legal statements-worth of Python but need parentheses to
 * sit in a comprehension's `in`/`if` slot. Rather than add parens we decline —
 * the resulting line would be unreadable anyway.
 */
function needsParensInComprehension(expr: Expr): boolean {
  const e = unwrap(expr)
  return e.type === 'IfExp' || e.type === 'Lambda' || (e.type === 'Tuple' && !e.parenthesized)
}

/** Is the iterable a `range()` big enough that one allocation is the wrong trade? */
function isHugeRange(iter: Expr): boolean {
  const e = unwrap(iter)
  if (e.type !== 'Call' || !isCallTo(e, ['builtins'], 'range')) return false
  if (e.args.length === 1) {
    const stop = literalNumber(e.args[0])
    return stop != null && stop > MAX_RANGE
  }
  if (e.args.length >= 2) {
    const from = literalNumber(e.args[0])
    const to = literalNumber(e.args[1])
    return from != null && to != null && to - from > MAX_RANGE
  }
  return false
}

/** How many times `name` appears as a bare name anywhere inside `node`. */
function nameCount(node: AnyNode, name: string): number {
  let n = 0
  walk(node, (child) => {
    if (child.type === 'Name' && child.id === name) n++
  })
  return n
}

/** Every name a `for` target binds, including the parts of a tuple target. */
function targetNames(target: Expr): string[] {
  const out: string[] = []
  walk(target as AnyNode, (n) => {
    if (n.type === 'Name') out.push(n.id)
  })
  return out
}

/**
 * The whole rewrite, computed once and used by both `detect` (to decide whether
 * the smell is worth reporting) and `apply` — so we never offer a fix that would
 * then decline.
 */
function rewrite(ctx: RefactorContext, data: ComprehensionMatch): TextEdit[] | null {
  const { assign, loop, elt, guard } = data
  const target = unwrap(assign.targets[0])

  const from = lineStart(ctx.src, assign.start)
  const to = lineEnd(ctx.src, loop.end)
  // Both statements must own their lines outright: a `;` neighbour would be
  // swallowed by a whole-line replacement.
  if (ctx.src.slice(from, assign.start).trim() !== '') return null
  if (ctx.src.slice(loop.end, to).trim() !== '') return null
  // A comment anywhere in the two statements has nowhere to go in a one-liner,
  // and quietly deleting someone's note is not a refactoring.
  if (ctx.comments.some((c) => c.start >= from && c.start < to)) return null

  const pieces = [
    textOf(ctx, target),
    textOf(ctx, elt),
    textOf(ctx, loop.target),
    textOf(ctx, loop.iter),
    guard ? textOf(ctx, guard) : ''
  ]
  // A piece spanning lines would fold a multi-line expression into one line.
  if (pieces.some((p) => /[\r\n]/.test(p))) return null

  const [name, eltText, loopTarget, iterText, guardText] = pieces
  const indent = indentAt(ctx.src, assign.start)
  const tail = guard ? ` if ${guardText}` : ''
  const line = `${indent}${name} = [${eltText} for ${loopTarget} in ${iterText}${tail}]`
  if (line.length > MAX_LINE) return null

  const hadNewline = to > from && ctx.src[to - 1] === '\n'
  return [{ start: from, end: to, newText: line + (hadNewline ? ctx.eol : '') }]
}

export const useComprehensionRule = defineRule<ComprehensionMatch>({
  id: 'use-comprehension',
  title: 'Build the list with a comprehension',
  message: 'This loop only appends — a list comprehension says it in one line',
  catalogue: 19,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-comprehension',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ComprehensionMatch>[] {
    const out: RefactorMatch<ComprehensionMatch>[] = []
    eachBlock(ctx, (block) => {
      for (let i = 0; i + 1 < block.length; i++) {
        const assign = block[i]
        const loop = block[i + 1]
        if (assign.type !== 'Assign' || loop.type !== 'For') continue
        // `result = []`, one target, a genuinely empty list.
        if (assign.targets.length !== 1) continue
        const target = unwrap(assign.targets[0])
        if (target.type !== 'Name') continue
        const value = unwrap(assign.value)
        if (value.type !== 'List' || value.elts.length > 0) continue
        // `async for` belongs in an async comprehension, which is a different
        // (and much easier to get wrong) rewrite.
        if (loop.isAsync) continue
        // A loop `else` runs when the loop completes — a comprehension has
        // nowhere to put it.
        if (loop.orelse.length > 0) continue

        const shape = bodyShape(loop, target.id)
        if (!shape) continue
        // The list must be write-only inside the loop: the single mention of it
        // is the `append` receiver, so nothing reads back what we have built.
        if (nameCount(loop as AnyNode, target.id) !== 1) continue
        if (isHugeRange(loop.iter)) continue
        if (needsParensInComprehension(loop.iter)) continue
        if (shape.guard && needsParensInComprehension(shape.guard)) continue

        // A `for` leaks its target to the code after it; a comprehension keeps
        // it private. If anything downstream reads it, the rewrite is not equal.
        const scope = scopeOf(loop)
        if (targetNames(loop.target).some((n) => isReadAfter(scope, n, loop.end))) continue

        const data: ComprehensionMatch = { assign, loop, elt: shape.elt, guard: shape.guard }
        if (!rewrite(ctx, data)) continue
        out.push({
          ruleId: 'use-comprehension',
          start: assign.start,
          end: loop.end,
          data
        })
      }
    })
    return out
  },

  apply(match: RefactorMatch<ComprehensionMatch>, ctx: RefactorContext): TextEdit[] | null {
    return rewrite(ctx, match.data)
  }
})
