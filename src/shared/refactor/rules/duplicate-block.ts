/**
 * Rule 12 — **This block appears more than once** (epic #634 §3.2).
 *
 * ```python
 * def start_left():                def start_right():
 *     pwm_a.freq(50)                   pwm_a.freq(50)
 *     pwm_a.duty_u16(0)                pwm_a.duty_u16(0)
 *     pin_a.value(0)                   pin_a.value(0)
 *     print("left ready")              print("right ready")
 * ```
 *
 * Three identical lines in two places is three chances to fix a bug in one of
 * them and not the other. That is the real cost of copy-and-paste, and it is
 * paid months later: someone changes the PWM frequency, the rover's left wheel
 * behaves and the right one does not, and nothing in the file says why. A block
 * with a name is changed once, and every caller gets the change.
 *
 * Blocks are compared **dedented**, so the same three lines match whether they
 * sit at the top of a function or two levels inside a loop — the shape of the
 * code is what repeats, not its indentation. Comments and blank lines inside a
 * run are part of the comparison: two runs that differ only in their comments
 * are two blocks that have already started to drift apart, and lumping them
 * together would be the sort of confident-but-wrong hint that teaches people to
 * ignore hints.
 *
 * Runs that repeat for a *reason* are skipped: a stack of `import`s, a row of
 * `pass` statements, anything under three real lines. And only the longest run
 * at each place is reported — a six-line repeat should say "six lines", not fire
 * four times for every three-line window inside it.
 *
 * **Hint only.** Turning the block into a function means naming it and deciding
 * what varies between the copies (here, the message), which is exactly the
 * judgement a tool should not make on its own. `apply` returns null.
 */
import type { AnyNode, Stmt } from '../ast'
import { walk } from '../ast'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface DuplicateBlockMatch {
  /** Non-blank lines in the repeated run. */
  lines: number
  /** How many times it appears in the file. */
  count: number
  /** Where the other copies start, for the "Why?" panel. */
  others: number[]
}

/** Fewest real lines worth calling a duplicated block. */
const MIN_LINES = 3

/** Fewest statements in a run. */
const MIN_STATEMENTS = 3

/** Longest run considered, so an enormous module cannot make `detect` crawl. */
const MAX_STATEMENTS = 40

/** Statement types whose repetition says nothing — every module repeats these. */
const UNREMARKABLE = new Set(['Import', 'ImportFrom', 'Pass', 'Global', 'Nonlocal'])

/** One run of consecutive statements, ready to compare with another. */
interface Run {
  key: string
  start: number
  end: number
  /** Non-blank lines the run spans. */
  lines: number
  /** How many statements it covers. */
  statements: number
}

/** Every statement list a node owns. */
function listsOf(node: AnyNode): Stmt[][] {
  switch (node.type) {
    case 'Module':
    case 'FunctionDef':
    case 'ClassDef':
    case 'With':
    case 'ExceptHandler':
      return [node.body]
    case 'For':
    case 'While':
    case 'If':
      return [node.body, node.orelse]
    case 'Try':
      return [node.body, node.orelse, node.finalbody]
    default:
      return []
  }
}

/** Is this a docstring — a bare string used as a statement? */
function isDocstring(stmt: Stmt): boolean {
  return stmt.type === 'ExprStmt' && stmt.value.type === 'Constant' && stmt.value.kind === 'string'
}

/**
 * One statement, reduced to a comparable shape: its own lines with its own
 * indentation stripped, trailing spaces trimmed and line endings normalised, plus
 * whatever sits between it and the next statement.
 *
 * Chunking per *statement* rather than per run is what keeps `detect` cheap. A
 * block of n statements has O(n²) runs in it, and normalising each one from
 * scratch made a 2,000-line module cost a third of a second on every re-lint;
 * with the pieces precomputed, a run is a join of pieces that already exist.
 */
interface Chunk {
  /** Dedented text of this statement's own lines; null when it shares a line. */
  text: string | null
  /** Non-blank lines in `text`. */
  lines: number
  /** Dedented text of the blank/comment lines before the next statement. */
  gap: string
  /** Non-blank lines in `gap`. */
  gapLines: number
  stmt: Stmt
}

/** Strip `prefix` from each line, trim line ends, normalise `\r\n`. */
function normalise(raw: string, prefix: string): { text: string; lines: number } {
  let lines = 0
  const out = raw.split(/\r?\n/).map((line) => {
    if (!line.trim()) return ''
    lines++
    // A line shallower than the statement itself — a docstring's own text, say —
    // is left as it is, so it compares as the literal it is at any nesting level.
    const body = line.startsWith(prefix) ? line.slice(prefix.length) : line
    return body.replace(/\s+$/, '')
  })
  return { text: out.join('\n'), lines }
}

/** Reduce one statement list to its chunks, in order. */
function chunksOf(ctx: RefactorContext, list: Stmt[]): Chunk[] {
  return list.map((stmt, i) => {
    const at = lineStart(ctx.src, stmt.start)
    // A statement sharing its line with another (`a = 1; b = 2`) has no shape of
    // its own to compare, so no run may start at or run through it.
    if (ctx.src.slice(at, stmt.start).trim() !== '') {
      return { text: null, lines: 0, gap: '', gapLines: 0, stmt }
    }
    const prefix = indentAt(ctx.src, stmt.start)
    const own = normalise(ctx.src.slice(at, lineEnd(ctx.src, stmt.end)), prefix)
    const next = list[i + 1]
    const between = next ? ctx.src.slice(lineEnd(ctx.src, stmt.end), lineStart(ctx.src, next.start)) : ''
    const gap = normalise(between, prefix)
    return { text: own.text, lines: own.lines, gap: gap.text, gapLines: gap.lines, stmt }
  })
}

/** The run `[from..to]`, or null when it is not worth comparing. */
function runOf(chunks: Chunk[], from: number, to: number): Run | null {
  let key = ''
  let lines = 0
  for (let i = from; i <= to; i++) {
    const chunk = chunks[i]
    if (chunk.text == null) return null
    // The gap after the last statement belongs to whatever follows, not to us.
    if (i > from) key += chunks[i - 1].gap
    key += chunk.text
    lines += chunk.lines + (i < to ? chunk.gapLines : 0)
  }
  if (lines < MIN_LINES) return null

  const stmts = chunks.slice(from, to + 1).map((c) => c.stmt)
  if (stmts.every((s) => UNREMARKABLE.has(s.type))) return null
  if (stmts.every(isDocstring)) return null

  return {
    key,
    start: stmts[0].start,
    end: stmts[stmts.length - 1].end,
    lines,
    statements: stmts.length
  }
}

/** Copies that do not overlap each other, earliest first. */
function spread(runs: Run[]): Run[] {
  const sorted = [...runs].sort((a, b) => a.start - b.start)
  const out: Run[] = []
  for (const run of sorted) {
    const last = out[out.length - 1]
    if (last && run.start < last.end) continue
    out.push(run)
  }
  return out
}

export const duplicateBlockRule = defineRule<DuplicateBlockMatch>({
  id: 'duplicate-block',
  title: 'This block appears more than once',
  message: 'These lines appear more than once — extracting them would fix them in one place',
  catalogue: 12,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-duplicate-block',
  // Nothing to batch: there is no rewrite.
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<DuplicateBlockMatch>[] {
    // Pass one: reduce every statement in the file to its comparable shape, and
    // count how often each one appears on its own.
    const blocks: Chunk[][] = []
    const seen = new Map<string, number>()
    walk(ctx.module as AnyNode, (node) => {
      for (const list of listsOf(node)) {
        if (list.length < MIN_STATEMENTS) continue
        const chunks = chunksOf(ctx, list)
        blocks.push(chunks)
        for (const chunk of chunks) {
          if (chunk.text == null) continue
          seen.set(chunk.text, (seen.get(chunk.text) ?? 0) + 1)
        }
      }
    })

    // Pass two: a repeated run has to *start* with a repeated statement, so only
    // those few positions are worth growing a run from. Without this filter the
    // O(n²) window scan walks every statement in the file.
    const groups = new Map<string, Run[]>()
    for (const chunks of blocks) {
      for (let from = 0; from + MIN_STATEMENTS <= chunks.length; from++) {
        const head = chunks[from].text
        if (head == null || (seen.get(head) ?? 0) < 2) continue
        const limit = Math.min(chunks.length - 1, from + MAX_STATEMENTS - 1)
        for (let to = from + MIN_STATEMENTS - 1; to <= limit; to++) {
          if (chunks[to].text == null) break
          const run = runOf(chunks, from, to)
          if (!run) continue
          const found = groups.get(run.key)
          if (found) found.push(run)
          else groups.set(run.key, [run])
        }
      }
    }

    const repeated = [...groups.values()]
      .map(spread)
      .filter((runs) => runs.length >= 2)
      // Longest first, so a six-line repeat claims its ground before the
      // three-line windows inside it get a chance to.
      .sort(
        (a, b) =>
          b[0].statements - a[0].statements ||
          b[0].key.length - a[0].key.length ||
          a[0].start - b[0].start
      )

    const claimed: { start: number; end: number }[] = []
    const out: RefactorMatch<DuplicateBlockMatch>[] = []
    for (const runs of repeated) {
      if (runs.some((r) => claimed.some((c) => r.start < c.end && c.start < r.end))) continue
      for (const r of runs) claimed.push({ start: r.start, end: r.end })

      // One hint, at the first copy, naming how many there are. A hint at every
      // copy would triple the noise for a single problem.
      const first = runs[0]
      out.push({
        ruleId: 'duplicate-block',
        start: first.start,
        end: first.end,
        message: `these ${first.lines} lines appear ${runs.length} times — extracting them would fix them in one place`,
        data: {
          lines: first.lines,
          count: runs.length,
          others: runs.slice(1).map((r) => r.start)
        }
      })
    }

    return out.sort((a, b) => a.start - b.start)
  },

  /**
   * Naming the block and deciding what differs between the copies is the
   * author's call (§2.6.6) — the rule points at the repetition and stops there.
   */
  apply(): TextEdit[] | null {
    return null
  }
})
