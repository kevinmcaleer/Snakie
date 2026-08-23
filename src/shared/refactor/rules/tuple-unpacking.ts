/**
 * Rule 74 — **Unpack in one assignment** (epic #634 §3.8).
 *
 * ```python
 * roll = orientation[0]         roll, pitch, yaw = orientation
 * pitch = orientation[1]
 * yaw = orientation[2]
 * ```
 *
 * Three lines of index bookkeeping become one line that names the parts. The
 * indices were never the point — they were the cost of getting at the values —
 * and they are exactly the sort of thing that goes wrong silently when someone
 * inserts a field: `[1]` and `[2]` both have to move, and a typo produces a
 * plausible number rather than an error.
 *
 * Unpacking also states the shape of the data: `roll, pitch, yaw = orientation`
 * says "this is a triple", and Python enforces it. That is the one behaviour
 * difference to know about, and it is why the rule checks what it can before
 * offering: indices must start at 0 with no gaps, and if anything nearby proves
 * the sequence is longer — a later `orientation[3]`, or a visible literal of a
 * different length — we decline, because unpacking a 4-tuple into three names
 * raises `ValueError` where indexing quietly worked.
 *
 * The indexed expression must be pure, so a `read_imu()[0]`/`read_imu()[1]`
 * pair is left alone: collapsing it would change three bus reads into one,
 * which is usually what you want but is emphatically not the same program.
 */
import type { AnyNode, Assign, Expr, Stmt } from '../ast'
import { blocksOf, unwrap, walk } from '../ast'
import { isPureExpression, literalNumber, textOf } from '../expr'
import { bodyOf, namesRead, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface UnpackMatch {
  /** The consecutive `x = t[i]` statements, in order. */
  stmts: Assign[]
  /** The names being bound, in order. */
  names: string[]
  /** Source text of the indexed expression. */
  base: string
}

/** Every statement list in the file, so we can look at consecutive runs. */
function eachBlock(ctx: RefactorContext, fn: (stmts: Stmt[]) => void): void {
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) fn(block)
  })
}

/** `name = base[index]` with a plain name and an integer literal index. */
function indexedAssign(
  ctx: RefactorContext,
  stmt: Stmt
): { name: string; base: Expr; baseText: string; index: number } | null {
  if (stmt.type !== 'Assign' || stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  if (target.type !== 'Name') return null
  const value = unwrap(stmt.value)
  if (value.type !== 'Subscript') return null
  const index = literalNumber(value.slice)
  if (index == null || !Number.isInteger(index)) return null
  return {
    name: target.id,
    base: value.value,
    baseText: textOf(ctx, value.value).trim(),
    index
  }
}

/**
 * The largest literal index anyone else in the scope takes from the same
 * expression. A `pose[3]` elsewhere proves the sequence is longer than the run
 * we are looking at, and unpacking would raise `ValueError`.
 */
function highestIndexElsewhere(
  ctx: RefactorContext,
  node: AnyNode,
  baseText: string,
  within: { start: number; end: number }
): number {
  let highest = -1
  for (const stmt of bodyOf(scopeOf(node))) {
    walk(stmt, (n) => {
      if (n.type !== 'Subscript') return
      if (n.start >= within.start && n.end <= within.end) return
      if (textOf(ctx, n.value).trim() !== baseText) return
      const i = literalNumber(n.slice)
      if (i != null && Number.isInteger(i) && i > highest) highest = i
    })
  }
  return highest
}

/** What a visible literal binding tells us about the indexed expression. */
type Binding = { kind: 'sequence'; length: number } | { kind: 'unsuitable' } | null

/**
 * The last literal assigned to `baseText` before the run, in the same block.
 * A list or tuple pins the length; a dict or set means unpacking would hand
 * back keys rather than the values the indices were reading, so we decline.
 */
function visibleBinding(
  ctx: RefactorContext,
  block: readonly Stmt[],
  upTo: number,
  baseText: string
): Binding {
  let seen: Binding = null
  for (let i = 0; i < upTo; i++) {
    const stmt = block[i]
    if (stmt.type !== 'Assign' || stmt.targets.length !== 1) continue
    if (textOf(ctx, stmt.targets[0]).trim() !== baseText) continue
    const value = unwrap(stmt.value)
    if (value.type === 'List' || value.type === 'Tuple') {
      seen = value.elts.some((e) => e.type === 'Starred')
        ? { kind: 'unsuitable' }
        : { kind: 'sequence', length: value.elts.length }
    } else if (
      value.type === 'Dict' ||
      value.type === 'Set' ||
      value.type === 'DictComp' ||
      value.type === 'SetComp'
    ) {
      seen = { kind: 'unsuitable' }
    } else {
      seen = null
    }
  }
  return seen
}

/** The rewrite, shared by `detect` and `apply`. */
function rewrite(ctx: RefactorContext, data: UnpackMatch): TextEdit[] | null {
  const { stmts, names, base } = data
  const first = stmts[0]
  const last = stmts[stmts.length - 1]
  const from = lineStart(ctx.src, first.start)
  const to = lineEnd(ctx.src, last.end)
  // Every statement must own its line: a `;` neighbour would be swallowed.
  if (ctx.src.slice(from, first.start).trim() !== '') return null
  if (ctx.src.slice(last.end, to).trim() !== '') return null
  // A comment on any of the collapsed lines would be deleted.
  if (ctx.comments.some((c) => c.start >= from && c.start < to)) return null
  if (/[\r\n]/.test(base)) return null

  const indent = indentAt(ctx.src, first.start)
  const hadNewline = to > from && ctx.src[to - 1] === '\n'
  return [
    {
      start: from,
      end: to,
      newText: `${indent}${names.join(', ')} = ${base}` + (hadNewline ? ctx.eol : '')
    }
  ]
}

export const tupleUnpackingRule = defineRule<UnpackMatch>({
  id: 'tuple-unpacking',
  title: 'Unpack in one assignment',
  message: 'These lines take consecutive items apart — unpack them in one go',
  catalogue: 74,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-tuple-unpacking',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<UnpackMatch>[] {
    const out: RefactorMatch<UnpackMatch>[] = []
    eachBlock(ctx, (block) => {
      for (let i = 0; i < block.length; i++) {
        const head = indexedAssign(ctx, block[i])
        if (!head || head.index !== 0) continue
        if (!isPureExpression(head.base)) continue

        // Take the longest run of 0, 1, 2, … over the very same expression.
        const stmts: Assign[] = [block[i] as Assign]
        const names: string[] = [head.name]
        let j = i + 1
        for (; j < block.length; j++) {
          const next = indexedAssign(ctx, block[j])
          if (!next) break
          if (next.index !== stmts.length || next.baseText !== head.baseText) break
          stmts.push(block[j] as Assign)
          names.push(next.name)
        }
        if (stmts.length < 2) continue

        // Rebinding a name that the expression itself mentions would change what
        // the later indices read: `t = t[0]` then `t[1]` is a different `t`.
        const inBase = namesRead([head.base])
        if (names.some((n) => inBase.has(n))) continue
        if (new Set(names).size !== names.length) continue

        const span = { start: stmts[0].start, end: stmts[stmts.length - 1].end }
        // Anything that proves the sequence is longer than the run means the
        // unpack would raise ValueError where the indexing worked.
        if (highestIndexElsewhere(ctx, block[i], head.baseText, span) >= stmts.length) {
          i = j - 1
          continue
        }
        const binding = visibleBinding(ctx, block, i, head.baseText)
        if (binding && (binding.kind === 'unsuitable' || binding.length !== stmts.length)) {
          i = j - 1
          continue
        }

        const data: UnpackMatch = { stmts, names, base: head.baseText }
        if (rewrite(ctx, data)) {
          out.push({
            ruleId: 'tuple-unpacking',
            start: span.start,
            end: span.end,
            data
          })
        }
        // Whatever happened, the run is dealt with — don't restart inside it.
        i = j - 1
      }
    })
    return out
  },

  apply(match: RefactorMatch<UnpackMatch>, ctx: RefactorContext): TextEdit[] | null {
    return rewrite(ctx, match.data)
  }
})
