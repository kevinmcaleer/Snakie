/**
 * Rule 42 — **This table lives in RAM** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                              # after (by hand)
 * SINE_Q8 = [                           def sine_q8(index):
 *     128, 139, 150, 161, 172,              with open("sine.bin", "rb") as f:
 *     …72 entries in all…                       f.seek(index)
 * ]                                             return f.read(1)[0]
 * ```
 *
 * Why it matters: a literal at module level is not free storage the way a
 * constant in C is. The interpreter *builds* it — element by element — the first
 * time the module is imported, and the resulting list, dict or tuple then sits
 * on the heap for the entire life of the program whether anything reads it or
 * not. On a Pico you have around 190 KB of RAM in total, and a list of small
 * integers costs roughly eight bytes per slot before you count the objects
 * inside it. A 512-entry lookup table is therefore a measurable double-digit
 * slice of the heap, gone before `main()` has run a line.
 *
 * There is a second cost people notice sooner: import time. Every element is a
 * separate bytecode operation, so a big table makes the board sit there after
 * reset doing nothing visible, which reads as "my Pico is slow to boot".
 *
 * The ways out, roughly in order of how much they buy:
 *
 * - **A `bytes` literal.** `b"\x80\x8b\x96…"` is *one* object, built in one
 *   step, and indexing it gives you the integer back. For a table of values
 *   under 256 this is usually a straight win and barely changes the code.
 * - **A file read on demand.** Move the table into a `.bin` next to the script
 *   and `seek()` to the entry you want. Costs a few hundred microseconds per
 *   lookup, costs nothing at all in RAM.
 * - **Compute it.** A table of 72 sine values is a `sin()` call and a loop; if
 *   the board can spare the cycles, it cannot spare the bytes.
 *
 * Which of those is right depends entirely on how the table is used, so this
 * rule is `hintOnly` — it flags the table, says how big it is, and leaves the
 * choice to the author. It deliberately does **not** carry a `requires` board
 * gate: the arithmetic is just as true with nothing plugged in, and someone
 * writing code on the train should still be told. When a board *is* connected
 * and reported little free heap, the message says so.
 */
import type { Expr, Name, Stmt } from '../ast'
import { unwrap } from '../ast'
import { textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Elements before a literal is big enough to be worth mentioning. */
const MAX_ELEMENTS = 64

/** Source characters before a literal is worth mentioning regardless of shape. */
const MAX_SOURCE_CHARS = 400

/** Free heap below which a connected board gets a name-check in the message. */
const TIGHT_HEAP_BYTES = 64_000

interface TableMatch {
  /** The name the table is bound to. */
  name: string
  /** 'list', 'dict', 'tuple' or 'set'. */
  kind: string
  /** How many elements the display holds. */
  count: number
}

/** What to call each display type in prose. */
const DISPLAY_KINDS: Record<string, string> = {
  List: 'list',
  Tuple: 'tuple',
  Set: 'set',
  Dict: 'dict'
}

/** The number of elements in a literal display, or null for anything else. */
function displaySize(expr: Expr): number | null {
  switch (expr.type) {
    case 'List':
    case 'Tuple':
    case 'Set':
      return expr.elts.length
    case 'Dict':
      return expr.values.length
    default:
      return null
  }
}

/** The `NAME = <display>` this module-level statement is, or null. */
function tableOf(stmt: Stmt): { target: Name; value: Expr } | null {
  if (stmt.type === 'Assign') {
    // `A = B = [...]` binds one object twice; not the simple shape we report.
    if (stmt.targets.length !== 1) return null
    const target = unwrap(stmt.targets[0])
    if (target.type !== 'Name') return null
    return { target, value: stmt.value }
  }
  if (stmt.type === 'AnnAssign' && stmt.value) {
    const target = unwrap(stmt.target)
    if (target.type !== 'Name') return null
    return { target, value: stmt.value }
  }
  return null
}

export const largeModuleTableRule = defineRule<TableMatch>({
  id: 'large-module-table',
  title: 'This table lives in RAM',
  message: 'A big literal at module level is built at import time and never freed',
  catalogue: 42,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-large-module-table',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<TableMatch>[] {
    const out: RefactorMatch<TableMatch>[] = []

    // Module level only. The same literal inside a function is built when the
    // function runs and collected when it returns — a different problem, if it
    // is one at all.
    for (const stmt of ctx.module.body) {
      const table = tableOf(stmt)
      if (!table) continue
      const display = unwrap(table.value)
      const count = displaySize(display)
      if (count == null) continue

      const source = textOf(ctx, display)
      // Either a lot of elements, or a lot of source: a dict of twelve servo
      // trim tuples is only twelve entries and still half a kilobyte of heap.
      if (count <= MAX_ELEMENTS && source.length <= MAX_SOURCE_CHARS) continue

      const name = table.target.id
      const kind = DISPLAY_KINDS[display.type] ?? 'table'
      let message = `\`${name}\` builds a ${count}-entry ${kind} at import time, and it stays on the heap for the whole run`
      const caps = ctx.capabilities
      if (caps && caps.memFree < TIGHT_HEAP_BYTES) {
        message += ` — the connected board reported only ${Math.round(caps.memFree / 1024)} KB free`
      }

      out.push({
        ruleId: 'large-module-table',
        // Point at the name, not the hundred lines of data behind it.
        start: table.target.start,
        end: table.target.end,
        message,
        data: { name, kind, count }
      })
    }

    return out
  },

  // Hint only. A `bytes` literal, a file read on demand and computing the table
  // are all right answers depending on how it is read — and picking between them
  // is the actual work.
  apply(): TextEdit[] | null {
    return null
  }
})
