/**
 * Rule 55 — **This PIO program will not fit** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before — 43 instructions, one per phase # after — the table lives in RAM
 * @rp2.asm_pio(set_init=(PIO.OUT_LOW,) * 4) @rp2.asm_pio(out_init=(PIO.OUT_LOW,) * 4)
 * def half_step():                          def half_step():
 *     label("forward")                          wrap_target()
 *     set(pins, 0b0001)                         pull(block)
 *     nop()[31]                                 out(pins, 4)
 *     set(pins, 0b0011)                         wrap()
 *     nop()[31]
 *     …38 more…                             # the eight phases are a bytes()
 *                                           # object the CPU feeds to the FIFO
 * ```
 *
 * Why it matters: this one is not a style opinion — it genuinely will not load.
 *
 * A PIO block has exactly **32 instruction slots**, and they are shared by all
 * four state machines in that block. Your program is assembled and copied into
 * those slots when you construct the `StateMachine`, so a 43-instruction program
 * cannot be loaded at all, and a 20-instruction one leaves only 12 slots for
 * every other program in the same block. The error, when it comes, is a
 * run-time `OSError`/`ValueError` from the constructor rather than anything the
 * assembler said while you were writing — which is why a rule that counts as you
 * type earns its keep.
 *
 * Getting under the limit is nearly always about moving data out of the program.
 * A PIO program is a *shape*, not a script: the eight phases of a half-step
 * sequence, the pulse widths, the bit patterns are data, and data belongs in the
 * FIFO where `pull()`/`out()` can stream it. Two directions written out longhand
 * become one loop reading a direction flag off the FIFO. Repeated `nop()[31]`
 * padding becomes one delay driven by a value the CPU pushes. And `label()`,
 * `wrap()` and `wrap_target()` are free — they are assembler directives that
 * mark positions, not instructions — so relabelling costs you nothing.
 *
 * Hint only, and reported as an **error** rather than a hint: there is no
 * mechanical rewrite that shortens an assembly program without changing what it
 * does, but there is also no version of this that works.
 *
 * Gated on `caps.pio`: on a board with no PIO block the program is not going to
 * be loaded either way, and Snakie says nothing when no board is connected.
 */
import type { AnyNode, Expr, FunctionDef, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { callName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Instruction slots in one PIO block, shared by its four state machines. */
const INSTRUCTION_SLOTS = 32

/**
 * Assembler directives, not instructions. `label()` marks a position, and
 * `wrap()`/`wrap_target()` set the loop bounds — none of the three occupies a
 * slot, so counting them would cry wolf on a program that fits perfectly well.
 */
const DIRECTIVES = new Set(['label', 'wrap', 'wrap_target'])

interface TooLongMatch {
  /** Instructions counted in the program body. */
  instructions: number
  /** The `@asm_pio` function's name, for the message. */
  name: string
}

/** Is this function decorated `@rp2.asm_pio(...)` (or a bare `@asm_pio`)? */
function isPioProgram(fn: FunctionDef): boolean {
  return fn.decorators.some((decorator) => {
    const d = unwrap(decorator)
    const target = d.type === 'Call' ? d.func : d
    return callName(target) === 'asm_pio'
  })
}

/**
 * The instruction a statement assembles to, or null.
 *
 * PIO instructions wear two kinds of suffix: `[n]` for the delay cycles and
 * `.side(n)` for the side-set, both of which ride along inside the same 16-bit
 * word. `out(x, 1).side(0)[T3 - 1]` is one instruction, so both are peeled off
 * before the name is read.
 */
function instructionName(value: Expr): string | null {
  let e = unwrap(value)
  for (;;) {
    if (e.type === 'Subscript') {
      e = unwrap(e.value)
      continue
    }
    if (e.type === 'Call') {
      const func = unwrap(e.func)
      if (func.type === 'Attribute' && (func.attr === 'side' || func.attr === 'delay')) {
        e = unwrap(func.value)
        continue
      }
    }
    break
  }
  return e.type === 'Call' ? callName(e.func) : null
}

/**
 * Count the instructions in a program body. Assignments (`T1 = 2`) are
 * assemble-time constants and the docstring is a string, so only expression
 * statements are considered — and of those, the three directives are free.
 */
function countInstructions(body: readonly Stmt[]): number {
  let count = 0
  for (const stmt of body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
        return false
      }
      if (node.type !== 'ExprStmt') return undefined
      const name = instructionName(node.value)
      if (name && !DIRECTIVES.has(name)) count++
      return undefined
    })
  }
  return count
}

export const pioProgramTooLongRule = defineRule<TooLongMatch>({
  id: 'pio-program-too-long',
  title: 'This PIO program will not fit',
  message: 'A PIO block holds 32 instructions, and this program is longer than that',
  catalogue: 55,
  category: 'board',
  kind: 'refactor',
  severity: 'error',
  helpArticle: 'refactor-pio-program-too-long',
  // Shortening an assembly program means changing what it does; nothing here is
  // a behaviour-preserving tidy-up.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<TooLongMatch>[] {
    const out: RefactorMatch<TooLongMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return undefined
      if (!isPioProgram(node)) return undefined
      const instructions = countInstructions(node.body)
      if (instructions <= INSTRUCTION_SLOTS) return undefined

      out.push({
        ruleId: 'pio-program-too-long',
        start: node.defStart,
        end: node.nameStart + node.name.length,
        message: `\`${node.name}()\` assembles to ${instructions} instructions and a PIO block holds ${INSTRUCTION_SLOTS} — it is ${instructions - INSTRUCTION_SLOTS} too long to load. Move the repeated patterns out of the program and stream them through the FIFO with \`pull()\`/\`out()\``,
        data: { instructions, name: node.name }
      })
      return undefined
    })

    return out
  },

  // Hint only. Fitting an assembly program into 32 slots means deciding which
  // part of it is really data — nobody can do that mechanically.
  apply(): TextEdit[] | null {
    return null
  }
})
