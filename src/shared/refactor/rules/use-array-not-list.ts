/**
 * Rule 59 — **Use `array.array` for a numeric buffer** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                              # after (by hand)
 * GAMMA = [0, 1, 2, 4, 7, 11,           from array import array
 *          17, 25, 36, 50, 68]
 * history = [0] * 64                    GAMMA = array("B", [0, 1, 2, 4, 7, 11,
 *                                                          17, 25, 36, 50, 68])
 *                                       history = array("h", [0] * 64)
 * ```
 *
 * Why it matters: a Python **list of 100 ints is not 100 ints**. It is 100
 * pointers — four bytes each — *plus* 100 separate integer objects on the heap
 * for them to point at, each with its own type header. On a 32-bit MicroPython
 * port that is comfortably 1.2 KB for a hundred small numbers, scattered across
 * the heap so the garbage collector has to walk all of it.
 *
 * `array.array('h', …)` is 100 signed 16-bit values in one contiguous block:
 * **200 bytes, full stop.** No pointers, no boxing, no per-item headers, nothing
 * for the collector to trace inside it. On a Pico with 264 KB of RAM that
 * difference is not a micro-optimisation — for a lookup table, a sample buffer
 * or a gait sequence it is what decides whether your program starts at all.
 *
 * The typecodes worth knowing:
 *
 * | Code | Holds | Bytes each |
 * |---|---|---|
 * | `'b'` / `'B'` | signed / unsigned byte, −128…127 or 0…255 | 1 |
 * | `'h'` / `'H'` | signed / unsigned 16-bit, ±32767 or 0…65535 | 2 |
 * | `'i'` / `'I'` | signed / unsigned 32-bit | 4 |
 * | `'f'` | single-precision float | 4 |
 *
 * Pick the smallest one your values actually fit in — a servo pulse in
 * microseconds is `'H'`, a signed encoder delta is `'h'`, a gamma table is `'B'`.
 * An `array` indexes, slices and iterates exactly like the list it replaces, and
 * every driver that takes a buffer takes one.
 *
 * This is a hint and stays a hint, because choosing the typecode is your call:
 * only you know whether the next value written into that table might be negative,
 * or bigger than 65535, or a float. Guess wrong on your behalf and the rewrite
 * turns a working program into an `OverflowError` at 3am. So the rule points at
 * the table, says how many numbers are in it, and leaves the choice with you.
 *
 * Gated on a board being connected at all: it is advice about the RAM on the chip
 * in front of you, and Snakie says nothing about a board it cannot see.
 */
import type { AnyNode, Assign, Expr, ListExpr, Name } from '../ast'
import { unwrap, walk } from '../ast'
import { literalNumber } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/**
 * How many numbers a table has to hold before the pointer overhead is worth
 * mentioning. Eight is where the saving passes the size of the `array` object
 * itself on a 32-bit port.
 */
const MIN_ELEMENTS = 8

interface ArrayMatch {
  /** The list expression that allocates. */
  value: Expr
  /** The name it is bound to, for the message. */
  name: string
  /** How many numbers it holds. */
  count: number
}

/** Is every element of this display a plain numeric literal? */
function allNumeric(list: ListExpr): boolean {
  if (list.elts.length === 0) return false
  return list.elts.every((elt) => literalNumber(elt) != null)
}

/**
 * How many numbers this expression allocates, or null if it is not a numeric
 * table at all.
 *
 * Two shapes count: a display written out in full (`[0, 1, 2, …]`) and the
 * repeat idiom (`[0] * 64`, `[0, 0] * 32`), which is how everyone pre-allocates
 * a sample buffer. Both are lists of nothing but numbers, which is exactly what
 * an `array` does better.
 */
function numericTableSize(expr: Expr): number | null {
  const e = unwrap(expr)

  if (e.type === 'List') return allNumeric(e) ? e.elts.length : null

  if (e.type === 'BinOp' && e.op === '*') {
    const left = unwrap(e.left)
    const right = unwrap(e.right)
    const list = left.type === 'List' ? left : right.type === 'List' ? right : null
    const countExpr = list === left ? right : left
    if (!list || !allNumeric(list)) return null
    const repeats = literalNumber(countExpr)
    if (repeats == null || !Number.isInteger(repeats) || repeats < 1) return null
    return list.elts.length * repeats
  }

  return null
}

/** The first plain `Name` an assignment binds, or null. */
function firstNameTarget(stmt: Assign): Name | null {
  for (const t of stmt.targets) {
    const e = unwrap(t)
    if (e.type === 'Name') return e
  }
  return null
}

export const useArrayNotListRule = defineRule<ArrayMatch>({
  id: 'use-array-not-list',
  title: 'Use array.array for a numeric buffer',
  message: 'A list of numbers costs a pointer plus a boxed object each — an array.array does not',
  catalogue: 59,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-array-not-list',
  // An array fixes the type of everything you ever put in it. That is a
  // decision, not a tidy-up.
  safe: false,
  hintOnly: true,
  // On-device advice about the RAM on the chip in front of you: no board, no hint.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<ArrayMatch>[] {
    const out: RefactorMatch<ArrayMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Assign') return undefined
      const target = firstNameTarget(node)
      if (!target) return undefined

      // Only the whole right-hand side counts. `array.array('h', [0] * 64)` has
      // the same list inside it and has already taken the advice.
      const count = numericTableSize(node.value)
      if (count == null || count < MIN_ELEMENTS) return undefined

      out.push({
        ruleId: 'use-array-not-list',
        start: node.value.start,
        end: node.value.end,
        message: `\`${target.id}\` is a list of ${count} numbers — that is ${count} pointers plus ${count} boxed integers; \`array.array\` stores the values themselves`,
        data: { value: node.value, name: target.id, count }
      })
      return undefined
    })

    return out
  },

  // Hint only. The typecode — how big the values get, whether they go negative,
  // whether they are floats — is knowledge about the data that only its author
  // has, and guessing it wrong turns a working table into an OverflowError.
  apply(): TextEdit[] | null {
    return null
  }
})
