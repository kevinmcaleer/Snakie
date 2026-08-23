/**
 * Rule 68 — **Use a conditional expression** (epic #634 §3.3).
 *
 * ```python
 * if speed > limit:            target = limit if speed > limit else speed
 *     target = limit
 * else:
 *     target = speed
 * ```
 *
 * Four lines and a branch to say one thing: *this variable gets one of two
 * values*. Written as a conditional expression the assignment is a single
 * statement again, the name is bound exactly once (so there is no path where it
 * is left unset), and the reader sees the choice and its outcome in one glance
 * instead of holding an `if` open in their head.
 *
 * The rule is fussy on purpose. Both branches must assign the **same** single
 * target and nothing else; an augmented (`+=`) or annotated (`x: int =`)
 * assignment is left alone; an `elif` is left alone (folding one would drop the
 * branches around it); a comment anywhere in the `if` is left alone, because
 * collapsing the lines would take the comment with them. And a one-liner that
 * would run past the repo's 100-column line width is not an improvement — a
 * wrapped conditional expression is harder to read than the `if` it replaced —
 * so that declines too.
 */
import type { Assign, Expr, IfStmt } from '../ast'
import type { AnyNode } from '../ast'
import { unwrap, walk } from '../ast'
import { textOf } from '../expr'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The repo's prettier `printWidth`; past this the one-liner has to wrap. */
const MAX_LINE = 100

interface TernaryMatch {
  ifStmt: IfStmt
}

/** Targets we can fold: a plain name, or an attribute/subscript written the same way twice. */
function isSimpleTarget(expr: Expr): boolean {
  const e = unwrap(expr)
  return e.type === 'Name' || e.type === 'Attribute' || e.type === 'Subscript'
}

/**
 * Can this expression sit before the `if` of a conditional expression without
 * being re-bracketed? Everything looser than `or` — a nested conditional, a
 * `lambda`, a bare tuple, a walrus — would re-associate or fail to parse, and we
 * refuse to invent parentheses around code we did not write.
 */
function fitsBeforeIf(expr: Expr): boolean {
  const e = unwrap(expr)
  switch (e.type) {
    case 'IfExp':
    case 'Lambda':
    case 'NamedExpr':
    case 'Starred':
    case 'Yield':
      return false
    case 'Tuple':
      return e.parenthesized
    default:
      return true
  }
}

/** Same question for the value after `else`, which may itself be a conditional. */
function fitsAfterElse(expr: Expr): boolean {
  const e = unwrap(expr)
  switch (e.type) {
    case 'NamedExpr':
    case 'Starred':
    case 'Yield':
      return false
    case 'Tuple':
      return e.parenthesized
    default:
      return true
  }
}

/** The single `x = …` a branch consists of, or null if it is anything else. */
function loneAssignment(stmts: readonly AnyNode[]): Assign | null {
  if (stmts.length !== 1) return null
  const only = stmts[0]
  if (only.type !== 'Assign' || only.targets.length !== 1) return null
  return only
}

/** Does any comment live on the lines this rewrite would collapse? */
function hasComments(ctx: RefactorContext, ifStmt: IfStmt): boolean {
  const from = lineStart(ctx.src, ifStmt.start)
  const to = lineEnd(ctx.src, ifStmt.end)
  return ctx.comments.some((c) => c.start >= from && c.start < to)
}

/**
 * The replacement line, or null when this `if` cannot become one. Shared by
 * `detect` and `apply` so the menu never offers something `apply` will refuse.
 */
function foldedLine(ctx: RefactorContext, ifStmt: IfStmt): string | null {
  // An `elif` is a branch of the `if` above it; replacing its lines would drop
  // that `if`'s other branches on the floor.
  if (ifStmt.isElif) return null
  const then = loneAssignment(ifStmt.body)
  const other = loneAssignment(ifStmt.orelse)
  if (!then || !other) return null

  const target = then.targets[0]
  const otherTarget = other.targets[0]
  if (!isSimpleTarget(target) || !isSimpleTarget(otherTarget)) return null
  const targetText = textOf(ctx, target).trim()
  // Identical source text is the only cheap proof that `rover.duty` and
  // `rover.duty` are the same place to store something.
  if (targetText !== textOf(ctx, otherTarget).trim()) return null

  if (!fitsBeforeIf(then.value) || !fitsBeforeIf(ifStmt.test)) return null
  if (!fitsAfterElse(other.value)) return null

  const thenText = textOf(ctx, then.value).trim()
  const testText = textOf(ctx, ifStmt.test).trim()
  const elseText = textOf(ctx, other.value).trim()
  // A part that spans lines cannot be folded onto one without reflowing it.
  if ([targetText, thenText, testText, elseText].some((t) => /[\r\n]/.test(t) || !t)) return null

  const line = `${indentAt(ctx.src, ifStmt.start)}${targetText} = ${thenText} if ${testText} else ${elseText}`
  if (line.length > MAX_LINE) return null
  if (hasComments(ctx, ifStmt)) return null
  return line
}

export const conditionalExpressionRule = defineRule<TernaryMatch>({
  id: 'conditional-expression',
  title: 'Use a conditional expression',
  message: 'Both branches assign the same name — this is one conditional expression',
  catalogue: 68,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-conditional-expression',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<TernaryMatch>[] {
    const out: RefactorMatch<TernaryMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      if (foldedLine(ctx, node) == null) return
      out.push({
        ruleId: 'conditional-expression',
        start: node.start,
        end: node.end,
        data: { ifStmt: node }
      })
    })
    return out
  },

  apply(match: RefactorMatch<TernaryMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const line = foldedLine(ctx, ifStmt)
    if (line == null) return null

    // Whole lines in, one whole line out — so the statement's own indentation
    // and the newline that ends it are replaced together.
    const start = lineStart(ctx.src, ifStmt.start)
    const end = lineEnd(ctx.src, ifStmt.end)
    const endsWithNewline = ctx.src.slice(start, end).endsWith('\n')
    return [{ start, end, newText: line + (endsWithNewline ? ctx.eol : '') }]
  }
})
