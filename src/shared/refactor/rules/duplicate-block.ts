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
import { lineStart } from '../text'
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
 * The run's source text with its own indentation removed and line endings
 * normalised, so the same block matches itself at any nesting level. Returns
 * null when the run is not worth comparing.
 */
function runOf(ctx: RefactorContext, list: Stmt[], from: number, to: number): Run | null {
  const stmts = list.slice(from, to + 1)
  if (stmts.every((s) => UNREMARKABLE.has(s.type))) return null
  if (stmts.every(isDocstring)) return null

  const first = stmts[0]
  const last = stmts[stmts.length - 1]
  const at = lineStart(ctx.src, first.start)
  // A run that shares its first line with something else has no clean shape.
  if (ctx.src.slice(at, first.start).trim() !== '') return null

  const raw = ctx.src.slice(at, last.end)
  const lines = raw.split(/\r?\n/)
  let common = Infinity
  for (const line of lines) {
    if (!line.trim()) continue
    common = Math.min(common, /^[ \t]*/.exec(line)![0].length)
  }
  if (!Number.isFinite(common)) return null

  const body = lines.map((line) => (line.trim() ? line.slice(common).replace(/\s+$/, '') : ''))
  const realLines = body.filter((line) => line !== '').length
  if (realLines < MIN_LINES) return null

  return {
    key: body.join('\n'),
    start: first.start,
    end: last.end,
    lines: realLines,
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
    const groups = new Map<string, Run[]>()

    walk(ctx.module as AnyNode, (node) => {
      for (const list of listsOf(node)) {
        for (let from = 0; from + MIN_STATEMENTS <= list.length; from++) {
          const limit = Math.min(list.length - 1, from + MAX_STATEMENTS - 1)
          for (let to = from + MIN_STATEMENTS - 1; to <= limit; to++) {
            const run = runOf(ctx, list, from, to)
            if (!run) continue
            const found = groups.get(run.key)
            if (found) found.push(run)
            else groups.set(run.key, [run])
          }
        }
      }
    })

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
