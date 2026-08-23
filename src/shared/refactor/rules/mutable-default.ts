/**
 * Rule 24 — **Fix the mutable default argument** (epic #634 §3.5).
 *
 * ```python
 * def log(reading, samples=[]):   def log(reading, samples=None):
 *     samples.append(reading)         if samples is None:
 *     return samples                      samples = []
 *                                     samples.append(reading)
 *                                     return samples
 * ```
 *
 * Python evaluates a default expression **once**, when the `def` statement runs —
 * not on every call. That `[]` is therefore a single list shared by every caller
 * who leaves the argument out, so yesterday's readings are still in it today.
 * It is the classic Python trap, it shows up as "why is my log growing on its
 * own?", and on a board that runs for weeks it eventually eats the heap.
 *
 * The fix is the idiom every Python codebase uses: default to `None` and build a
 * fresh container inside the function, where the expression runs per call.
 *
 * Only the *empty* forms (`[]`, `{}`, `list()`, `dict()`, `set()`) are offered.
 * A non-empty default like `[0] * 8` may well be a deliberate shared table, and
 * turning it into a per-call allocation would change how much RAM the function
 * costs — not something to do behind the author's back.
 */
import type { Expr, FunctionDef, Param, Stmt } from '../ast'
import type { AnyNode } from '../ast'
import { unwrap, walk } from '../ast'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { dottedName, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { isDocstring } from './guard-clause'

interface MutableDefaultMatch {
  fn: FunctionDef
  /** Every parameter of `fn` whose default is a freshly-built empty container. */
  params: Param[]
}

/** Is this default a container built fresh — and therefore shared — at `def` time? */
function isEmptyContainer(expr: Expr | undefined): boolean {
  if (!expr) return false
  const e = unwrap(expr)
  if (e.type === 'List') return e.elts.length === 0
  if (e.type === 'Set') return e.elts.length === 0
  if (e.type === 'Dict') return e.keys.length === 0 && e.values.length === 0
  if (e.type === 'Call' && e.args.length === 0 && e.keywords.length === 0) {
    const name = dottedName(e.func)
    return name === 'list' || name === 'dict' || name === 'set'
  }
  return false
}

/** The function's body with a leading docstring dropped. */
function effectiveBody(fn: FunctionDef): Stmt[] {
  if (fn.body.length > 0 && isDocstring(fn.body[0])) return fn.body.slice(1)
  return fn.body
}

/**
 * Move an insertion point back over the comment lines directly above it, so a
 * comment that introduces the first statement keeps sitting with that statement
 * instead of being adopted by the guard we are about to insert. Stops at the
 * first line that is not comment-only, which is always the `def` header or the
 * docstring, never something further up the file.
 */
function backUpOverComments(src: string, at: number, limit: number): number {
  let pos = at
  while (pos > limit) {
    const prevStart = lineStart(src, pos - 1)
    if (prevStart <= limit) return pos
    const line = src.slice(prevStart, pos)
    if (!line.trim().startsWith('#')) return pos
    pos = prevStart
  }
  return pos
}

/**
 * A body that only says `pass` or `...` — a stub or a protocol shim. The bug
 * cannot bite code that never touches the argument, and a guard clause in an
 * empty function is just noise.
 */
function isStubBody(body: readonly Stmt[]): boolean {
  return body.every(
    (s) =>
      s.type === 'Pass' ||
      (s.type === 'ExprStmt' && s.value.type === 'Constant' && s.value.kind === 'ellipsis')
  )
}

export const mutableDefaultRule = defineRule<MutableDefaultMatch>({
  id: 'mutable-default',
  title: 'Fix the mutable default argument',
  message: 'This default is built once and shared by every call — default to `None` instead',
  catalogue: 24,
  category: 'functions',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-mutable-default',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<MutableDefaultMatch>[] {
    const out: RefactorMatch<MutableDefaultMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      // One match per function, fixing all of its mutable defaults together:
      // two matches on one `def` would want to insert their guards at the same
      // offset, and the engine has no way to order those.
      const params = node.params.filter((p) => {
        if (p.kind !== 'normal' || !p.default || !isEmptyContainer(p.default)) return false
        // A default written across lines would arrive in the body still
        // carrying the signature's line breaks; leave those be.
        return !/[\r\n]/.test(textOf(ctx, p.default))
      })
      if (params.length === 0) return

      const body = effectiveBody(node)
      if (body.length === 0 || isStubBody(body)) return

      // The body must be a real indented block: `def f(x=[]): return x` has
      // nowhere to put the guard without reflowing a line we did not write.
      const first = body[0]
      if (lineStart(ctx.src, first.start) <= node.start) return
      if (indentAt(ctx.src, first.start).length <= indentAt(ctx.src, node.start).length) return

      out.push({
        ruleId: 'mutable-default',
        start: params[0].start,
        end: params[params.length - 1].end,
        title:
          params.length > 1
            ? `Fix ${params.length} mutable default arguments`
            : 'Fix the mutable default argument',
        data: { fn: node, params }
      })
    })
    return out
  },

  apply(match: RefactorMatch<MutableDefaultMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { fn, params } = match.data
    const body = effectiveBody(fn)
    if (body.length === 0) return null
    const first = body[0]

    // The guard goes at the top of the body, but after a docstring — a docstring
    // that is no longer the first statement stops being a docstring.
    const doc = fn.body.length > 0 && isDocstring(fn.body[0]) ? fn.body[0] : null
    const anchor = doc
      ? lineEnd(ctx.src, doc.end)
      : backUpOverComments(ctx.src, lineStart(ctx.src, first.start), lineStart(ctx.src, fn.start))
    if (anchor > first.start) return null
    // The guard must land below the whole signature, defaults included.
    const lastDefault = params[params.length - 1].default
    if (!lastDefault || anchor <= lastDefault.end) return null

    const bodyIndent = indentAt(ctx.src, first.start)
    const unit = ctx.indentUnit
    const edits: TextEdit[] = []
    let guards = ''
    for (const p of params) {
      if (!p.default) return null
      // Keep the container the author wrote (`list()` stays `list()`) by
      // slicing it out of the source rather than inventing a replacement.
      const built = textOf(ctx, p.default)
      guards += `${bodyIndent}if ${p.name} is None:${ctx.eol}`
      guards += `${bodyIndent}${unit}${p.name} = ${built}${ctx.eol}`
      edits.push({ start: p.default.start, end: p.default.end, newText: 'None' })
    }
    edits.push({ start: anchor, end: anchor, newText: guards })
    return edits
  }
})
