/**
 * Rule 1 — **Convert to guard clause** (epic #634 §3.1, phases R0/R1).
 *
 * The flagship refactoring, and the one the whole engine was built to prove:
 *
 * ```python
 * def read_sensor(bus):          def read_sensor(bus):
 *     if bus is not None:            if bus is None:
 *         raw = bus.read()               return
 *         scaled = raw / 16        raw = bus.read()
 *         return scaled            scaled = raw / 16
 *                                  return scaled
 * ```
 *
 * The teaching payload — Arjan's framing that *the happy path should be the
 * least-indented path* — is the "Why?" article this ships with.
 */
import type { FunctionDef, IfStmt, Stmt } from '../ast'
import { walk } from '../ast'
import type { AnyNode } from '../ast'
import { dedent, indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { invertCondition } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface GuardMatch {
  fn: FunctionDef
  ifStmt: IfStmt
}

/** Is this statement a docstring (a bare string expression)? */
export function isDocstring(stmt: Stmt): boolean {
  return stmt.type === 'ExprStmt' && stmt.value.type === 'Constant' && stmt.value.kind === 'string'
}

/** The function's body with a leading docstring dropped. */
function effectiveBody(fn: FunctionDef): Stmt[] {
  const body = fn.body
  if (body.length > 0 && isDocstring(body[0])) return body.slice(1)
  return body
}

/**
 * Offset just past the `:` that ends a compound statement's header. The parser
 * guarantees one exists after the test expression, and Python does not allow a
 * comment before it, so the first `:` is always the right one.
 */
export function colonAfter(src: string, offset: number): number {
  for (let i = offset; i < src.length; i++) {
    if (src[i] === ':') return i + 1
  }
  return -1
}

export const guardClauseRule = defineRule<GuardMatch>({
  id: 'guard-clause',
  title: 'Convert to guard clause',
  message: 'This `if` wraps the whole function — an early return would flatten it',
  catalogue: 1,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-guard-clause',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<GuardMatch>[] {
    const out: RefactorMatch<GuardMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      const body = effectiveBody(node)
      if (body.length !== 1) return
      const only = body[0]
      if (only.type !== 'If') return
      // An `else` branch means the two paths are peers, not a happy path and a
      // rejected one — that is a different refactoring (rules 3 and 67).
      if (only.orelse.length > 0) return
      // Flattening a one-statement body just moves the indentation around.
      if (only.body.length < 2) return
      // A single-line `if x: do()` has no block to dedent.
      if (ctx.lines.positionAt(only.start).line === ctx.lines.positionAt(only.body[0].start).line) {
        return
      }
      out.push({
        ruleId: 'guard-clause',
        start: only.start,
        end: colonAfter(ctx.src, only.test.end),
        data: { fn: node, ifStmt: only }
      })
    })
    return out
  },

  apply(match: RefactorMatch<GuardMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const colonEnd = colonAfter(ctx.src, ifStmt.test.end)
    if (colonEnd < 0) return null

    const unit = ctx.indentUnit
    const ifIndent = indentAt(ctx.src, ifStmt.start)
    const inverted = invertCondition(ctx, ifStmt.test)

    // The body region starts on the line after the header, so any comment
    // between the two travels with the body and is dedented alongside it.
    const bodyRegionStart = lineEnd(ctx.src, colonEnd)
    if (bodyRegionStart <= colonEnd || bodyRegionStart > ifStmt.end) return null
    const bodyText = ctx.src.slice(bodyRegionStart, ifStmt.end)
    // Every body line must be deeper than the `if` for the dedent to be safe.
    if (!bodyText.split('\n').some((l) => l.trim())) return null

    return [
      { start: ifStmt.test.start, end: ifStmt.test.end, newText: inverted },
      {
        start: bodyRegionStart,
        end: ifStmt.end,
        newText: `${ifIndent}${unit}return${ctx.eol}${dedent(bodyText, unit)}`
      }
    ]
  }
})

/** Exported for the tests that assert the flagship rule's range helpers. */
export const _internals = { effectiveBody, lineStart }
