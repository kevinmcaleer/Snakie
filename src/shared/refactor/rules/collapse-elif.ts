/**
 * Rule 64 — **Collapse to elif** (epic #634 §3.8).
 *
 * ```python
 * if level > 80:            if level > 80:
 *     return GREEN              return GREEN
 * else:                     elif level > 40:
 *     if level > 40:            return AMBER
 *         return AMBER      else:
 *     else:                     return OFF
 *         return OFF
 * ```
 *
 * `else:` followed by nothing but an indented `if` is Python's own `elif`
 * written the long way. Every extra level of it pushes the real work another
 * indent to the right, and a chain of three or four — the shape a beginner
 * reaches for when mapping a battery level or a joystick position onto a
 * handful of cases — ends up half a screen wide. Collapsing them lines the
 * branches up as the peers they are.
 *
 * The rewrite is a single ranged edit: the `else:` line and the inner `if`
 * keyword become one `elif`, and the inner statement's remaining lines lose one
 * indent unit. Comments inside the branch travel with it and are dedented
 * alongside the code; a comment stranded *between* the `else:` and the `if` has
 * nowhere to go once those two lines merge, so we decline instead.
 */
import type { AnyNode, IfStmt } from '../ast'
import { walk } from '../ast'
import { dedent } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface CollapseElifMatch {
  /** The `if` that owns the `else:`. */
  outer: IfStmt
  /** The lone `if` inside that `else:`. */
  inner: IfStmt
  /** Offset of the `else` keyword. */
  elseStart: number
}

/** Does this node span more than one line? */
function spansLines(ctx: RefactorContext, node: { start: number; end: number }): boolean {
  return ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line
}

/**
 * Does the branch contain a triple-quoted string that spans lines?
 *
 * Dedenting the block would strip an indent unit from the *inside* of such a
 * literal, silently changing a message the program prints. Nothing about the
 * offsets tells us which lines belong to the code and which to the text, so we
 * leave the whole branch alone.
 */
function hasMultiLineString(ctx: RefactorContext, root: AnyNode): boolean {
  let found = false
  walk(root, (n) => {
    if (n.type === 'Constant' && n.kind === 'string' && spansLines(ctx, n)) found = true
  })
  return found
}

export const collapseElifRule = defineRule<CollapseElifMatch>({
  id: 'collapse-elif',
  title: 'Collapse to elif',
  message: 'This `else:` holds nothing but an `if` — `elif` says it in one line',
  catalogue: 64,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-collapse-elif',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<CollapseElifMatch>[] {
    const out: RefactorMatch<CollapseElifMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      if (node.orelse.length !== 1) return
      const inner = node.orelse[0]
      if (inner.type !== 'If') return
      // An `elif` is already parsed into `orelse` as a nested `if`; `isElif`
      // tells the two apart, and there is nothing to do for the real one.
      if (inner.isElif) return
      const elseStart = node.orelseStart
      if (elseStart == null || elseStart >= inner.start) return

      // A comment between `else:` and the `if` — including a trailing one on
      // the `else:` line itself — would be deleted with the lines that merge.
      if (ctx.comments.some((c) => c.start >= elseStart && c.start < inner.start)) return

      if (hasMultiLineString(ctx, inner)) return

      out.push({
        ruleId: 'collapse-elif',
        start: elseStart,
        end: inner.test.end,
        data: { outer: node, inner, elseStart }
      })
    })
    return out
  },

  apply(match: RefactorMatch<CollapseElifMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { inner, elseStart } = match.data
    // The inner statement's own text starts AT its `if` keyword, so its first
    // line carries no leading whitespace and `dedent` leaves it be — while
    // every line below it, body and `else:` alike, moves one unit left.
    const innerText = ctx.src.slice(inner.start, inner.end)
    if (!innerText.startsWith('if')) return null
    return [
      {
        start: elseStart,
        end: inner.end,
        newText: `el${dedent(innerText, ctx.indentUnit)}`
      }
    ]
  }
})
