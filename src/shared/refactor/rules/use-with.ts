/**
 * Rule 29 — **Open the file with a `with`-block** (epic #634 §3.5).
 *
 * ```python
 * f = open("log.csv", "w")        with open("log.csv", "w") as f:
 * f.write(header)             →       f.write(header)
 * f.write(row)                        f.write(row)
 * f.close()
 * ```
 *
 * A hand-written `open`/`close` pair only closes the file when everything in
 * between goes right. On a microcontroller that matters more than on a laptop:
 * an unflushed handle after a soft reset is how a logging sketch ends up with an
 * empty CSV, and the board has no operating system waiting to tidy up after it.
 * `with` closes the handle on the way out of the block whatever happens — the
 * exception path included.
 *
 * The `try:` / `finally: f.close()` spelling is handled too, since that is what
 * a careful beginner writes once they hit the problem for the first time:
 *
 * ```python
 * f = open(path)                  with open(path) as f:
 * try:                        →       data = f.read()
 *     data = f.read()
 * finally:
 *     f.close()
 * ```
 *
 * **What this rule deliberately will not touch.** If a `return`, `raise`,
 * `break` or `continue` sits between the plain `open` and the plain `close`, the
 * close is *already* being skipped on that path — which is precisely the bug
 * `with` fixes. Converting it would change what the program does rather than
 * just how it reads, so we decline and leave it to the human. (The `try`/
 * `finally` shape has no such problem: `finally` already runs on every path, so
 * an early `return` inside it is converted happily.)
 */
import type { AnyNode, Assign, Call, Stmt, TryStmt } from '../ast'
import { blocksOf, unwrap, walk } from '../ast'
import { textOf } from '../expr'
import { isReadAfter, namesWritten, scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { indent, lineEnd, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface WithMatch {
  /** The `f = open(...)` statement. */
  openStmt: Assign
  /** The `open(...)` call, unwrapped of any redundant parentheses. */
  openCall: Call
  /** The name the handle is bound to. */
  handle: string
  /** Plain shape: the `f.close()` statement that ends the region. */
  closeStmt?: Stmt
  /** `try` / `finally` shape: the `try` statement that follows the open. */
  tryStmt?: TryStmt
}

/** `f = open(...)`, with a single plain-name target, or null. */
function openAssign(stmt: Stmt): { openStmt: Assign; openCall: Call; handle: string } | null {
  if (stmt.type !== 'Assign' || stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  if (target.type !== 'Name') return null
  const value = unwrap(stmt.value)
  if (value.type !== 'Call') return null
  // Only the builtin `open`. A `uart.open()` or a user's own wrapper may not be
  // a context manager at all, and `with` on a non-manager is a TypeError.
  if (value.func.type !== 'Name' || value.func.id !== 'open') return null
  return { openStmt: stmt, openCall: value, handle: target.id }
}

/** Is this statement exactly `<handle>.close()`? */
function isCloseOf(stmt: Stmt, handle: string): boolean {
  if (stmt.type !== 'ExprStmt') return false
  const call = unwrap(stmt.value)
  if (call.type !== 'Call' || call.args.length > 0 || call.keywords.length > 0) return false
  const fn = unwrap(call.func)
  if (fn.type !== 'Attribute' || fn.attr !== 'close') return false
  const obj = unwrap(fn.value)
  return obj.type === 'Name' && obj.id === handle
}

/** Nothing but whitespace between the start of the line and the node. */
function startsItsLine(src: string, node: { start: number }): boolean {
  return /^[ \t]*$/.test(src.slice(lineStart(src, node.start), node.start))
}

/** The rest of the node's line is blank (a `;` would mean two statements share it). */
function tailIsBlank(src: string, node: { end: number }): boolean {
  return /^[ \t]*\r?\n?$/.test(src.slice(node.end, lineEnd(src, node.end)))
}

/** The rest of the node's line is blank or a single trailing comment. */
function tailIsBlankOrComment(src: string, node: { end: number }): boolean {
  return /^[ \t]*(#[^\n\r]*)?\r?\n?$/.test(src.slice(node.end, lineEnd(src, node.end)))
}

/**
 * True when any statement holds a multi-line string literal. Those lines are
 * *data*, so indenting the block would silently rewrite the string's contents.
 */
function hasMultilineString(nodes: readonly AnyNode[]): boolean {
  let found = false
  for (const n of nodes) {
    walk(n, (x) => {
      if (x.type === 'Constant' && x.kind === 'string' && /[\r\n]/.test(x.raw)) found = true
    })
  }
  return found
}

/**
 * True when a jump inside these statements would skip past the `close()` that
 * follows them — the very bug `with` exists to prevent, and therefore something
 * we must not "tidy" behind the user's back.
 */
function skipsThePairedClose(nodes: readonly Stmt[]): boolean {
  let found = false
  for (const root of nodes) {
    walk(root, (n) => {
      // A nested def has its own control flow; it cannot jump out of ours.
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      if (n.type === 'Return' || n.type === 'Yield' || n.type === 'Raise') {
        found = true
        return false
      }
      if (n.type === 'Break' || n.type === 'Continue') {
        // Only a jump whose loop lies OUTSIDE the region escapes it.
        let inside = false
        let cur: AnyNode | undefined = n.parent
        while (cur) {
          if (cur.type === 'For' || cur.type === 'While') {
            inside = nodes.some((r) => r.start <= cur!.start && cur!.end <= r.end)
            break
          }
          if (cur.type === 'FunctionDef' || cur.type === 'Lambda') break
          cur = cur.parent
        }
        if (!inside) found = true
      }
      return undefined
    })
  }
  return found
}

/** The `try:` / `finally: f.close()` shape, if this `try` is exactly that. */
function tryFinallyClose(
  ctx: RefactorContext,
  stmt: Stmt,
  handle: string,
  openEnd: number
): TryStmt | null {
  if (stmt.type !== 'Try') return null
  // `except` clauses mean the rewrite would also have to keep a `try`; that is a
  // bigger change than this rule promises.
  if (stmt.handlers.length > 0 || stmt.orelse.length > 0) return null
  if (stmt.finalbody.length !== 1 || !isCloseOf(stmt.finalbody[0], handle)) return null
  if (stmt.body.length === 0) return null
  if (!startsItsLine(ctx.src, stmt)) return null
  // The `try:` header line is deleted, so anything parked between it and the
  // open — a blank line, a comment — would be left stranded at the `with`'s own
  // indentation inside its block. Legal Python, but not something to hand back
  // to a beginner; require the two to be on consecutive lines instead.
  if (lineEnd(ctx.src, openEnd) !== lineStart(ctx.src, stmt.start)) return null
  // The header must be a bare `try:` on its own line — we delete that whole line.
  const header = ctx.src.slice(lineStart(ctx.src, stmt.start), lineEnd(ctx.src, stmt.start))
  if (!/^[ \t]*try[ \t]*:[ \t]*\r?\n?$/.test(header)) return null
  // …and the tail must be exactly `finally:` + the close, so deleting it loses
  // nothing the user wrote.
  const last = stmt.body[stmt.body.length - 1]
  const tail = ctx.src.slice(lineEnd(ctx.src, last.end), lineEnd(ctx.src, stmt.end))
  const closeLine = `${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\.[ \\t]*close[ \\t]*\\([ \\t]*\\)`
  if (!new RegExp(`^[ \\t]*finally[ \\t]*:[ \\t]*\\r?\\n[ \\t]*${closeLine}[ \\t]*\\r?\\n?$`).test(tail)) {
    return null
  }
  if (namesWritten(stmt.body).has(handle)) return null
  return stmt
}

/** Every statement list in the file, so an open and its close must be peers. */
function statementBlocks(ctx: RefactorContext): Stmt[][] {
  const out: Stmt[][] = []
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) out.push(block)
  })
  return out
}

export const useWithRule = defineRule<WithMatch>({
  id: 'use-with',
  title: 'Open the file with a with-block',
  message: 'This file is closed by hand — a `with` block closes it even when something goes wrong',
  catalogue: 29,
  category: 'functions',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-use-with',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<WithMatch>[] {
    const out: RefactorMatch<WithMatch>[] = []

    for (const block of statementBlocks(ctx)) {
      for (let i = 0; i < block.length; i++) {
        const opened = openAssign(block[i])
        if (!opened) continue
        const { openStmt, handle } = opened
        if (!startsItsLine(ctx.src, openStmt)) continue
        if (!tailIsBlankOrComment(ctx.src, openStmt)) continue

        const scope = scopeOf(openStmt)

        // Shape B: `try:` … `finally: f.close()` immediately after the open.
        const next = block[i + 1]
        const tryStmt = next ? tryFinallyClose(ctx, next, handle, openStmt.end) : null
        if (tryStmt) {
          if (isReadAfter(scope, handle, tryStmt.end)) continue
          out.push({
            ruleId: 'use-with',
            start: openStmt.start,
            end: tryStmt.end,
            data: { ...opened, tryStmt }
          })
          continue
        }

        // Shape A: statements, then a bare `f.close()` in the same block.
        for (let j = i + 1; j < block.length; j++) {
          const stmt = block[j]
          if (isCloseOf(stmt, handle)) {
            const body = block.slice(i + 1, j)
            // An empty body would leave `with …:` with nothing under it.
            if (body.length === 0) break
            if (!startsItsLine(ctx.src, stmt) || !tailIsBlank(ctx.src, stmt)) break
            if (hasMultilineString(body)) break
            if (skipsThePairedClose(body)) break
            if (isReadAfter(scope, handle, stmt.end)) break
            out.push({
              ruleId: 'use-with',
              start: openStmt.start,
              end: stmt.end,
              data: { ...opened, closeStmt: stmt }
            })
            break
          }
          // Anything that rebinds the handle ends the region we can reason about.
          if (namesWritten([stmt]).has(handle)) break
        }
      }
    }

    return out
  },

  apply(match: RefactorMatch<WithMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { openStmt, openCall, handle, closeStmt, tryStmt } = match.data
    const header = `with ${textOf(ctx, openCall)} as ${handle}:`

    if (tryStmt) {
      // The `try` body already sits one unit deeper than the `try` header, which
      // is exactly where the `with` body belongs — so nothing is re-indented.
      const last = tryStmt.body[tryStmt.body.length - 1]
      const finallyStart = lineEnd(ctx.src, last.end)
      const finallyEnd = lineEnd(ctx.src, tryStmt.end)
      if (finallyStart >= finallyEnd) return null
      return [
        { start: openStmt.start, end: openStmt.end, newText: header },
        { start: lineStart(ctx.src, tryStmt.start), end: lineEnd(ctx.src, tryStmt.start), newText: '' },
        { start: finallyStart, end: finallyEnd, newText: '' }
      ]
    }

    if (!closeStmt) return null
    const bodyStart = lineEnd(ctx.src, openStmt.end)
    const bodyEnd = lineStart(ctx.src, closeStmt.start)
    if (bodyStart >= bodyEnd) return null
    const bodyText = ctx.src.slice(bodyStart, bodyEnd)
    return [
      { start: openStmt.start, end: openStmt.end, newText: header },
      { start: bodyStart, end: bodyEnd, newText: indent(bodyText, ctx.indentUnit) },
      { start: bodyEnd, end: lineEnd(ctx.src, closeStmt.end), newText: '' }
    ]
  }
})

/** Exported for the tests that probe the shape detectors directly. */
export const _internals: { openAssign: typeof openAssign; isCloseOf: typeof isCloseOf } = {
  openAssign,
  isCloseOf
}
