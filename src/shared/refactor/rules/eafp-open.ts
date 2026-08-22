/**
 * Rule 31 — **Try it and handle the failure** (epic #634 §3.5).
 *
 * ```python
 * if os.path.exists(path):        try:
 *     with open(path) as f:           with open(path) as f:
 *         return f.read()                 return f.read()
 *                                 except OSError:
 *                                     pass
 * ```
 *
 * "Easier to Ask Forgiveness than Permission" is not just Python taste — the
 * check is a lie. `exists()` answers a question about a moment that has already
 * passed by the time `open()` runs: another program (or the USB host copying
 * files onto your board) can delete it in between, the SD card can be pulled,
 * the flash can be full. The `open()` has to be able to fail anyway, so the
 * `if` buys nothing and doubles the filesystem work.
 *
 * On a microcontroller there is a second reason: MicroPython's `os` module is
 * a cut-down build and `os.path` often is not there at all, so the "safe"
 * version is the one that raises `AttributeError` on the board while the
 * try/except runs everywhere.
 *
 * `safe: false`: the rewrite changes which errors surface. Before, a missing
 * file skipped the block silently; afterwards an unreadable-but-present file
 * is caught too, and anything else in the block that raises `OSError` now lands
 * in the same handler. That trade is the user's to accept.
 *
 * An `if`/`else` is declined outright — the `else` branch is the "file was
 * missing" path, and whether it belongs in the `except` or after the whole
 * `try` is a judgement about intent that only the author can make.
 */
import type { Expr, IfStmt, Stmt } from '../ast'
import type { AnyNode } from '../ast'
import { unwrap, walk } from '../ast'
import { indentAt, lineEnd } from '../text'
import type { TextEdit } from '../text'
import { dottedName, isPureExpression, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { colonAfter } from './guard-clause'

interface EafpMatch {
  ifStmt: IfStmt
}

/** The ways a beginner spells "does this file exist?". */
const EXISTS_CALLS = new Set(['os.path.exists', 'uos.path.exists', 'path.exists', 'exists'])

/** `os`-level functions that take the path and raise `OSError` without it. */
const OS_FILE_CALLS = new Set([
  'remove',
  'unlink',
  'rename',
  'stat',
  'listdir',
  'ilistdir',
  'rmdir',
  'chdir'
])

/** The path argument of an `exists()` test, or null when this isn't one. */
function existsArg(test: Expr): Expr | null {
  const e = unwrap(test)
  if (e.type !== 'Call') return null
  if (e.args.length !== 1 || e.keywords.length > 0) return null
  const dotted = dottedName(e.func)
  if (!dotted || !EXISTS_CALLS.has(dotted)) return null
  return e.args[0]
}

/**
 * Does the block actually go on to use that same path? Without this the rule
 * would fire on `if os.path.exists(p): print("found")`, where the check IS the
 * point and there is no operation to let fail instead.
 */
function opensPath(ctx: RefactorContext, body: readonly Stmt[], pathText: string): boolean {
  let found = false
  for (const stmt of body) {
    walk(stmt, (n) => {
      if (found || n.type !== 'Call' || n.args.length === 0) return
      const dotted = dottedName(n.func)
      if (!dotted) return
      if (textOf(ctx, n.args[0]).trim() !== pathText) return
      if (dotted === 'open') {
        found = true
        return
      }
      const parts = dotted.split('.')
      if (parts.length === 2 && (parts[0] === 'os' || parts[0] === 'uos')) {
        if (OS_FILE_CALLS.has(parts[1])) found = true
      }
    })
  }
  return found
}

/**
 * Step an insertion point past comment lines indented deeper than the `if`, so
 * a comment that trails the block stays inside the `try` it belongs to rather
 * than being pushed under our new `except`.
 */
function skipDeeperComments(src: string, at: number, indent: string): number {
  let pos = at
  while (pos < src.length) {
    const nl = src.indexOf('\n', pos)
    const stop = nl < 0 ? src.length : nl
    const line = src.slice(pos, stop)
    const ws = /^[ \t]*/.exec(line)![0]
    if (!line.slice(ws.length).startsWith('#') || ws.length <= indent.length) return pos
    pos = nl < 0 ? src.length : nl + 1
  }
  return pos
}

export const eafpOpenRule = defineRule<EafpMatch>({
  id: 'eafp-open',
  title: 'Try it and handle the failure',
  message: 'The file can vanish between the check and the open — open it and catch `OSError`',
  catalogue: 31,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-eafp-open',
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<EafpMatch>[] {
    const candidates: IfStmt[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      // `elif os.path.exists(p):` cannot become a `try` without unpicking the
      // whole chain, and an `else` is a decision we refuse to guess at.
      if (node.isElif || node.orelse.length > 0) return
      if (node.body.length === 0) return
      const path = existsArg(node.test)
      if (!path) return
      // The test disappears, so its argument must be something whose evaluation
      // we can drop: a name or an attribute, never a call.
      if (!isPureExpression(path)) return
      // `if os.path.exists(p): use(p)` on one line has no block to move.
      if (ctx.lines.positionAt(node.start).line === ctx.lines.positionAt(node.body[0].start).line) {
        return
      }
      if (!opensPath(ctx, node.body, textOf(ctx, path).trim())) return
      // The header's `:` is what the rewrite replaces; no colon, no offer.
      if (colonAfter(ctx.src, node.test.end) < 0) return
      candidates.push(node)
    })
    // Nested checks would want to insert two `except` blocks at the same offset.
    // Offer the outer one; the fixpoint pass picks the inner one up next round.
    return candidates
      .filter((c) => !candidates.some((o) => o !== c && o.start <= c.start && c.end <= o.end))
      .map((ifStmt) => ({
        ruleId: 'eafp-open',
        start: ifStmt.start,
        end: colonAfter(ctx.src, ifStmt.test.end),
        data: { ifStmt }
      }))
  },

  apply(match: RefactorMatch<EafpMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const colonEnd = colonAfter(ctx.src, ifStmt.test.end)
    if (colonEnd < 0 || colonEnd > ifStmt.body[0].start) return null

    const indent = indentAt(ctx.src, ifStmt.start)
    const at = skipDeeperComments(ctx.src, lineEnd(ctx.src, ifStmt.end), indent)
    if (at <= colonEnd) return null

    // A file that ends without a newline needs one before the handler; one that
    // ends with a newline needs ours to keep the following line intact.
    const needsLeadingEol = at > 0 && ctx.src[at - 1] !== '\n'
    const lead = needsLeadingEol ? ctx.eol : ''
    const trail = needsLeadingEol ? '' : ctx.eol
    const handler = `${lead}${indent}except OSError:${ctx.eol}${indent}${ctx.indentUnit}pass${trail}`

    return [
      { start: ifStmt.start, end: colonEnd, newText: 'try:' },
      { start: at, end: at, newText: handler }
    ]
  }
})
