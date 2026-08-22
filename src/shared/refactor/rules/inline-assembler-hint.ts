/**
 * Rule 46 — **Inline assembler is the next step** (epic #634 §3.7, board-specific).
 *
 * ```python
 * @micropython.viper
 * def crc16(seed: int, data: int) -> int:
 *     crc = seed ^ (data << 8)
 *     for _ in range(8):
 *         if crc & 0x8000:
 *             crc = ((crc << 1) ^ 0x1021) & 0xFFFF
 *         else:
 *             crc = (crc << 1) & 0xFFFF
 *     return crc
 * ```
 *
 * Why it matters: this function has already been through the whole optimisation
 * ladder. It is a leaf — it calls nothing else in the file — it is integer work,
 * and it is already carrying `@micropython.viper`, which is the fastest thing
 * MicroPython can generate from Python source. If it is *still* the bottleneck,
 * there is exactly one rung left: write the loop in the chip's own instructions
 * with an inline-assembler decorator.
 *
 * Snakie will not write that for you, and this rule never rewrites anything. It
 * exists to tell you the rung is there, and what standing on it costs:
 *
 * - **At most four arguments**, and every one of them a machine word. There is
 *   no argument tuple, no keywords, no defaults.
 * - **The result comes back in the first register of the calling convention**
 *   (`r0` on Arm Thumb). One value, one machine word, no return of an object.
 * - **No Python objects at all.** Not a list, not a string, not an exception.
 *   You get registers, the memory you were handed a pointer to, and the
 *   instruction set. A stray object reference is not slow, it is a crash.
 * - **You are writing for one chip.** The function stops being portable in a way
 *   nothing else in this catalogue does: move the same file to a different board
 *   and it will not even import.
 *
 * That last point is why the hint names the assembler **your board reported**,
 * never one guessed from the chip's name. An RP2350 boots as either an Arm
 * Cortex-M33 or a RISC-V Hazard3 depending on how it was flashed, and the same
 * silicon therefore wants `asm_thumb` or `asm_rv32` on different days. Snakie
 * asks the firmware, and if the firmware does not offer an inline assembler at
 * all this rule says nothing.
 *
 * To learn the syntax, look up "inline assembler" in the MicroPython
 * documentation — it lives in the language-reference section, one page per
 * architecture, listing the exact subset of instructions the compiler accepts.
 * Read the page for the architecture named in the hint, not the Thumb one by
 * default.
 */
import type { AnyNode, FunctionDef, Stmt } from '../ast'
import { walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { BoardCapabilities, RefactorContext, RefactorMatch } from '../types'
import { hasArithmeticLoop, hasViperDecorator } from './convert-to-viper'

interface AssemblerMatch {
  fn: FunctionDef
  /** The decorator the board's own assembler wants, e.g. '@micropython.asm_thumb'. */
  decorator: string
}

/** The decorator that goes with each assembler a board can report. */
const ASM_DECORATORS: Record<NonNullable<BoardCapabilities['asm']>, string> = {
  thumb: '@micropython.asm_thumb',
  xtensa: '@micropython.asm_xtensa',
  rv32: '@micropython.asm_rv32'
}

/** Every `def` in the file, by name — the set a leaf function must not call. */
function userFunctionNames(ctx: RefactorContext): Set<string> {
  const out = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'FunctionDef') out.add(node.name)
    return undefined
  })
  return out
}

/**
 * Does this function call nothing written in this file?
 *
 * A call target we cannot resolve — `handlers[0]()`, `getattr(o, n)()` — counts
 * as *not* a leaf. Hand-writing assembly for a function that turns out to call
 * back into Python is wasted work, so an unknown target declines.
 */
function isLeaf(fn: FunctionDef, userFunctions: Set<string>): boolean {
  let leaf = true
  const visitor = (node: AnyNode): void | false => {
    if (!leaf) return false
    if (node.type !== 'Call') return undefined
    const dotted = dottedName(node.func)
    if (dotted == null) {
      leaf = false
      return false
    }
    // `self.step()` and a bare `step()` both reach the same `def`.
    const last = dotted.split('.').pop()!
    if (userFunctions.has(last)) leaf = false
    return undefined
  }
  for (const stmt of fn.body as Stmt[]) walk(stmt as AnyNode, visitor)
  return leaf
}

export const inlineAssemblerHintRule = defineRule<AssemblerMatch>({
  id: 'inline-assembler-hint',
  title: 'Inline assembler is the next step',
  message: 'This viper leaf is as fast as Python source gets — the next rung is inline assembly',
  catalogue: 46,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-inline-assembler-hint',
  // Gives up portability entirely. Never batched, never applied automatically.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.asm !== null,

  detect(ctx: RefactorContext): RefactorMatch<AssemblerMatch>[] {
    const caps = ctx.capabilities
    // Never inferred from the machine string: an RP2350 runs Arm or RISC-V
    // depending on the firmware, so if the board did not say, we do not guess.
    if (!caps || caps.asm == null) return []
    const decorator = ASM_DECORATORS[caps.asm]
    const hedge = caps.inferred === true

    const userFunctions = userFunctionNames(ctx)
    const out: RefactorMatch<AssemblerMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return undefined
      if (!hasViperDecorator(node)) return undefined
      if (!hasArithmeticLoop(node)) return undefined
      if (!isLeaf(node, userFunctions)) return undefined

      out.push({
        ruleId: 'inline-assembler-hint',
        start: node.defStart,
        end: node.nameStart + node.name.length,
        message: hedge
          ? `\`${node.name}()\` is a viper leaf with a tight loop — your board probably supports ${decorator}, which is the last rung and the end of portability`
          : `\`${node.name}()\` is a viper leaf with a tight loop — your board reports ${decorator}, which is the last rung and the end of portability`,
        data: { fn: node, decorator }
      })
      return undefined
    })
    return out
  },

  // Hint only, and permanently so. Snakie does not generate assembly: choosing
  // the registers, the instruction subset and the loop structure is the work,
  // and a machine-written guess at it would be unreviewable.
  apply(): TextEdit[] | null {
    return null
  }
})
