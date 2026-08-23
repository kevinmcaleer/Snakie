/**
 * Rule 72 — **Use dict.get with a default** (epic #634 §3.3).
 *
 * ```python
 * if name in config:              value = config.get(name, 0)
 *     value = config[name]
 * else:
 *     value = 0
 * ```
 *
 * Four lines and two lookups say what the dictionary already does in one:
 * `get` *is* "the value if the key is there, otherwise this". The long form also
 * hides a real hazard — the key is looked up twice, so the two halves can drift
 * apart in editing (`config[name]` quietly becoming `config[key]`), and on a
 * microcontroller you have paid for the hash twice for no reason.
 *
 * The rewrite is offered only when the three parts line up exactly: the same
 * name is assigned in both branches, the subscript reads the same mapping the
 * `in` tested, and with the same key. The mapping, the key and the fallback must
 * all be pure — the mapping and key because they go from being evaluated twice
 * to once, and the fallback because `get` evaluates its default *eagerly*, so a
 * call there would start running on the hit path too.
 */
import type { AnyNode, Expr, IfStmt, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { fullLineRange, indentAt, lineStart } from '../text'
import type { TextEdit } from '../text'
import { isPureExpression, textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface DictGetMatch {
  ifStmt: IfStmt
}

/** Longest line we will fold four readable lines into. */
const MAX_LINE = 100

/** Is any comment inside `[start, end)`? Collapsing the range would eat it. */
function hasCommentIn(ctx: RefactorContext, start: number, end: number): boolean {
  return ctx.comments.some((c) => c.start >= start && c.start < end)
}

/** `name = <value>` and nothing more elaborate, or null. */
function simpleAssign(stmt: Stmt): { name: string; value: Expr } | null {
  if (stmt.type !== 'Assign' || stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  if (target.type !== 'Name') return null
  return { name: target.id, value: stmt.value }
}

/**
 * Can `.get` be written straight after this expression's source text? Only for
 * something that already binds tighter than attribute access — `a + b` would
 * turn into `a + b.get(…)`, which reads the wrong object.
 */
function takesAttributeSuffix(expr: Expr): boolean {
  const e = unwrap(expr)
  return e.type === 'Name' || e.type === 'Attribute'
}

/** Can this expression be dropped into an argument list as written? */
function usableAsArgument(expr: Expr): boolean {
  const e = unwrap(expr)
  // A bare tuple would arrive as extra positional arguments.
  if (e.type === 'Tuple' && !e.parenthesized) return false
  return e.type !== 'Starred'
}

/** The single `x = d.get(k, default)` line replacing this `if`, or null. */
function replacement(ctx: RefactorContext, ifStmt: IfStmt): string | null {
  // An `elif` shares its parent's header line; collapsing it would strand the
  // branch above.
  if (ifStmt.isElif) return null
  if (ifStmt.body.length !== 1 || ifStmt.orelse.length !== 1) return null

  const test = unwrap(ifStmt.test)
  if (test.type !== 'Compare' || test.ops.length !== 1) return null
  const op = test.ops[0]
  if (op !== 'in' && op !== 'not in') return null

  // `if k in d:` puts the lookup first; `if k not in d:` puts the default first.
  const hit = simpleAssign(op === 'in' ? ifStmt.body[0] : ifStmt.orelse[0])
  const miss = simpleAssign(op === 'in' ? ifStmt.orelse[0] : ifStmt.body[0])
  if (!hit || !miss || hit.name !== miss.name) return null

  const key = test.left
  const mapping = test.comparators[0]
  if (!isPureExpression(key) || !isPureExpression(mapping)) return null
  if (!takesAttributeSuffix(mapping) || !usableAsArgument(key)) return null

  // The hit branch must read exactly the mapping and key the test asked about.
  const lookup = unwrap(hit.value)
  if (lookup.type !== 'Subscript') return null
  if (unwrap(lookup.slice).type === 'Slice') return null
  const mappingText = textOf(ctx, mapping).trim()
  const keyText = textOf(ctx, key).trim()
  if (textOf(ctx, lookup.value).trim() !== mappingText) return null
  if (textOf(ctx, lookup.slice).trim() !== keyText) return null

  // `get` evaluates its default whether or not the key is present, so anything
  // that does work — a call, a subscript, a walrus — has to stay in its `else`.
  if (!isPureExpression(miss.value) || !usableAsArgument(miss.value)) return null
  const fallbackText = textOf(ctx, miss.value).trim()

  const indent = indentAt(ctx.src, ifStmt.start)
  // Only rewrite an `if` that starts its own line: the edit replaces whole lines.
  if (lineStart(ctx.src, ifStmt.start) + indent.length !== ifStmt.start) return null

  const line = `${indent}${hit.name} = ${mappingText}.get(${keyText}, ${fallbackText})`
  if (/[\r\n]/.test(line)) return null
  // Trading four clear lines for one long one is not a tidy-up.
  if (line.length > MAX_LINE) return null
  const range = fullLineRange(ctx.src, ifStmt)
  if (hasCommentIn(ctx, range.start, range.end)) return null
  return line
}

export const dictGetDefaultRule = defineRule<DictGetMatch>({
  id: 'dict-get-default',
  title: 'Use dict.get with a default',
  message: 'This `if`/`else` is what `dict.get(key, default)` already does',
  catalogue: 72,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-dict-get-default',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<DictGetMatch>[] {
    const out: RefactorMatch<DictGetMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      // Only offer what `apply` can actually deliver, so the Problems panel
      // never shows a hint with no fix behind it.
      if (replacement(ctx, node) == null) return
      out.push({
        ruleId: 'dict-get-default',
        start: node.start,
        end: node.end,
        data: { ifStmt: node }
      })
    })
    return out
  },

  apply(match: RefactorMatch<DictGetMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const line = replacement(ctx, ifStmt)
    if (line == null) return null
    const range = fullLineRange(ctx.src, ifStmt)
    // Keep the file's own ending — unless the `if` was the last line and had none.
    const endsWithNewline = range.end > 0 && ctx.src[range.end - 1] === '\n'
    return [
      { start: range.start, end: range.end, newText: line + (endsWithNewline ? ctx.eol : '') }
    ]
  }
})
