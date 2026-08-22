/**
 * Rule 23 — **Walk both sequences with zip** (epic #634 §3.4).
 *
 * ```python
 * for i in range(len(readings)):       for reading, gain in zip(readings, gains):
 *     out.append(readings[i] * gains[i])    out.append(reading * gain)
 * ```
 *
 * `range(len(...))` is the C loop a beginner brings with them: an index whose
 * only job is to get back to the items. Every `readings[i]` is a bounds check
 * and a lookup, and the code has to be read twice to see that the two lists are
 * being walked in step. `zip` says that outright, hands the items straight to
 * the body, and drops the index nobody wanted.
 *
 * The rule only fires when **two or more** sequences are indexed by the same
 * variable — one sequence is `enumerate`'s job (rule 22), not `zip`'s — and
 * only when the index is used for *nothing else*: one stray `print(i)` or
 * `readings[i + 1]` and there is no faithful rewrite, so it declines.
 *
 * Two more refusals, both about proving equivalence: the sequence the `len` was
 * taken from must itself be one of the indexed ones (otherwise the loop count
 * and `zip`'s shortest-wins length are unrelated), and nothing in the body may
 * assign through the index — `readings[i] = ...` writes back into the list,
 * which a `zip` variable cannot do.
 *
 * One difference worth naming: where the lists are ragged, the original raises
 * `IndexError` on the short one and `zip` quietly stops at it. That is the
 * conventional reading of this refactoring — walking sequences in step is only
 * meaningful while they are in step — and it is why the "Why?" article says so
 * out loud.
 */
import type { AnyNode, Expr, ForStmt, Name, Subscript } from '../ast'
import { contains, unwrap, walk } from '../ast'
import { isCallTo, isPureExpression, textOf } from '../expr'
import { freshName, isReadAfter, namesRead, namesWritten, scopeOf } from '../scope'
import type { Scope } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** One sequence walked by the loop, with the subscripts that read from it. */
interface Sequence {
  /** The sequence expression's source text, the key everything is grouped by. */
  text: string
  /** The first occurrence, used for the `zip(...)` argument. */
  expr: Expr
  /** Every `seq[i]` to be replaced by the new loop variable. */
  reads: Subscript[]
}

interface ZipMatch {
  loop: ForStmt
  sequences: Sequence[]
}

/** Python keywords a generated name must never collide with. */
const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
])

/** Positional fallbacks when a sequence's name suggests nothing singular. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']

/** `readings` → `reading`, `humidities` → `humidity`, `address` → `address`. */
function singular(name: string): string {
  if (name.length > 3 && name.endsWith('ies')) return `${name.slice(0, -3)}y`
  if (name.endsWith('ss')) return name
  if (name.length > 1 && name.endsWith('s')) return name.slice(0, -1)
  return name
}

/**
 * A readable stem for one item of `expr`, or null when nothing better than a
 * positional name offers itself. `self.motors` → `motor`; a bare `data`, whose
 * singular is the list's own name, falls back rather than becoming `data2`.
 */
function itemNameFor(expr: Expr): string | null {
  const e = unwrap(expr)
  const raw = e.type === 'Name' ? e.id : e.type === 'Attribute' ? e.attr : null
  if (!raw) return null
  const stem = singular(raw)
  if (e.type === 'Name' && stem === e.id) return null
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stem)) return null
  if (KEYWORDS.has(stem)) return null
  return stem
}

/** `range(len(xs))` → the `xs` expression; null for any other iterable. */
function rangeOverLen(iter: Expr): Expr | null {
  const range = unwrap(iter)
  if (range.type !== 'Call') return null
  if (!isCallTo(range, [], 'range')) return null
  if (range.args.length !== 1 || range.keywords.length > 0) return null
  const len = unwrap(range.args[0])
  if (len.type !== 'Call') return null
  if (!isCallTo(len, [], 'len')) return null
  if (len.args.length !== 1 || len.keywords.length > 0) return null
  const seq = len.args[0]
  return seq.type === 'Starred' ? null : seq
}

/** Every expression the statements bind to, so we can spot writes through `i`. */
function targetExpressions(nodes: readonly AnyNode[]): Expr[] {
  const out: Expr[] = []
  for (const root of nodes) {
    walk(root, (n) => {
      switch (n.type) {
        case 'Assign':
          out.push(...n.targets)
          break
        case 'AugAssign':
        case 'AnnAssign':
          out.push(n.target)
          break
        case 'Delete':
          out.push(...n.targets)
          break
        case 'For':
          out.push(n.target)
          break
        case 'With':
          for (const item of n.items) if (item.optionalVars) out.push(item.optionalVars)
          break
        default:
          break
      }
      return undefined
    })
  }
  return out
}

/** `base`, then `base2`… — free in the scope AND not already handed out. */
function allocate(scope: Scope, base: string, taken: Set<string>): string {
  for (let i = 1; i < 50; i++) {
    const candidate = freshName(scope, i === 1 ? base : `${base}${i}`)
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  return base
}

/** The sequences this loop walks in step, or null when it is not that loop. */
function sequencesFor(ctx: RefactorContext, loop: ForStmt): Sequence[] | null {
  if (loop.isAsync) return null
  const target = unwrap(loop.target)
  if (target.type !== 'Name') return null
  const index = target.id

  const primary = rangeOverLen(loop.iter)
  if (!primary) return null
  if (!isPureExpression(primary)) return null

  const body: AnyNode[] = [...loop.body, ...loop.orelse]
  if (body.length === 0) return null

  // The index may not be rebound anywhere inside — a nested `for i in …` or a
  // stray `i += 1` means the subscripts no longer track the loop.
  if (namesWritten(body).has(index)) return null

  // …nor survive the loop: `zip` leaves no index behind for anyone to read.
  if (isReadAfter(scopeOf(loop), index, loop.end)) return null

  // Collect `<seq>[i]` and, separately, every mention of `i` at all. The two
  // counts must agree, which is what "the index is used for nothing else" means.
  const subscripts: Subscript[] = []
  const sliceNames = new Set<Name>()
  const mentions: Name[] = []
  for (const stmt of body) {
    walk(stmt, (n) => {
      if (n.type === 'Name' && n.id === index) mentions.push(n)
      if (n.type === 'Subscript') {
        const slice = unwrap(n.slice)
        if (slice.type === 'Name' && slice.id === index) {
          subscripts.push(n)
          sliceNames.add(slice)
        }
      }
      return undefined
    })
  }
  if (subscripts.length === 0) return null
  if (mentions.some((m) => !sliceNames.has(m))) return null

  // Nothing may be written through the index, directly or as part of a larger
  // target like `motors[i].speed = 0`.
  const targets = targetExpressions(body)
  if (subscripts.some((s) => targets.some((t) => contains(t, s)))) return null

  // Group by the sequence's source text, keeping first-seen order.
  const byText = new Map<string, Sequence>()
  for (const sub of subscripts) {
    if (!isPureExpression(sub.value)) return null
    const text = textOf(ctx, sub.value).trim()
    const seen = byText.get(text)
    if (seen) seen.reads.push(sub)
    else byText.set(text, { text, expr: sub.value, reads: [sub] })
  }

  // `zip` stops with the shortest argument, so the sequence whose length drove
  // the loop has to be in the zip — and first, where its length still leads.
  const primaryText = textOf(ctx, primary).trim()
  const primarySeq = byText.get(primaryText)
  if (!primarySeq) return null
  const sequences = [primarySeq, ...[...byText.values()].filter((s) => s !== primarySeq)]
  if (sequences.length < 2) return null

  // A sequence the body reassigns is not the same sequence on the next pass.
  const written = namesWritten([loop])
  for (const seq of sequences) {
    for (const read of namesRead([seq.expr])) {
      if (written.has(read)) return null
    }
  }
  return sequences
}

export const useZipRule = defineRule<ZipMatch>({
  id: 'use-zip',
  title: 'Walk both sequences with zip',
  message: 'This loop indexes two sequences in step — `zip` hands you the items directly',
  catalogue: 23,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-zip',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ZipMatch>[] {
    const out: RefactorMatch<ZipMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For') return
      const sequences = sequencesFor(ctx, node)
      if (!sequences) return
      out.push({
        ruleId: 'use-zip',
        start: node.target.start,
        end: node.iter.end,
        message: `\`${sequences.map((s) => s.text).join('` and `')}\` are walked in step — use \`zip\``,
        data: { loop: node, sequences }
      })
    })
    return out
  },

  apply(match: RefactorMatch<ZipMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, sequences } = match.data
    const scope = scopeOf(loop)
    const taken = new Set<string>()
    const names: string[] = []
    for (let i = 0; i < sequences.length; i++) {
      const base = itemNameFor(sequences[i].expr) ?? ORDINALS[i] ?? `item${i + 1}`
      names.push(allocate(scope, base, taken))
    }

    // Read the sequences back out of the source rather than trusting a cached
    // string — the edits must always be spliced from the file in hand.
    const args = sequences.map((s) => textOf(ctx, s.expr).trim())
    const header = `${names.join(', ')} in zip(${args.join(', ')})`
    const edits: TextEdit[] = [
      { start: loop.target.start, end: loop.iter.end, newText: header }
    ]
    for (let i = 0; i < sequences.length; i++) {
      for (const sub of sequences[i].reads) {
        edits.push({ start: sub.start, end: sub.end, newText: names[i] })
      }
    }
    return edits
  }
})
