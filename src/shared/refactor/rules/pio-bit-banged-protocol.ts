/**
 * Rule 53 — **Check for a hardware peripheral before bit-banging** (epic #634 §3.7).
 *
 * ```python
 * # before — shifting a byte out MSB-first, by hand
 * for i in range(8):
 *     data.value((byte >> (7 - i)) & 1)
 *     clock.value(1)
 *     clock.value(0)
 * ```
 *
 * Why it matters: this is SPI. Somebody has written, in Python, the thing the
 * chip already has a dedicated peripheral for — and the Python version is
 * perhaps a hundred times slower, holds the CPU for the whole transfer, and has
 * timing that wanders whenever the garbage collector runs.
 *
 * So the first question is not "how do I make this faster?", it is **"is this
 * already in hardware?"** Very often it is:
 *
 * - **`machine.SPI`** for a clock-and-data shift like the one above. It is
 *   available on specific pins — check your board's pinout, because the
 *   peripheral is wired to particular GPIOs and moving to them is usually a
 *   two-wire change on the breadboard for an enormous win.
 * - **`machine.I2C`** if there is an addressed device and an acknowledge bit.
 * - **`machine.UART`** if it is start-bit, eight data bits, stop-bit.
 *
 * Only if the protocol genuinely is not one of those — an unusual frame, a
 * non-standard clock polarity, a one-wire sensor like the DHT22 or DS18B20 — is
 * PIO the answer. A state machine will clock it exactly, at zero CPU cost, and
 * it is the reason the RP2040 has PIO at all.
 *
 * Snakie deliberately points rather than rewrites. Moving to a hardware
 * peripheral means moving wires, and a refactoring tool that silently rewrote
 * your driver to use pins nothing is plugged into would be worse than useless.
 */
import type { AnyNode, ForStmt, Stmt, WhileStmt } from '../ast'
import { walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface BitBangMatch {
  /** The pin object being toggled twice a pass — the clock. */
  clock: string
}

/** `p.value(x)` / `p.on()` / `p.off()` — the receiver's source text, or null. */
function pinWriteTarget(stmt: Stmt): string | null {
  if (stmt.type !== 'ExprStmt' || stmt.value.type !== 'Call') return null
  const dotted = dottedName(stmt.value.func)
  if (!dotted || !dotted.includes('.')) return null
  const parts = dotted.split('.')
  const method = parts.pop()!
  const receiver = parts.join('.')
  if (method === 'value' && stmt.value.args.length === 1) return receiver
  if (method === 'on' || method === 'off' || method === 'high' || method === 'low') return receiver
  return null
}

/** Does this statement shift a value — the giveaway of a serialised byte? */
function containsShift(stmt: Stmt): boolean {
  let found = false
  walk(stmt as AnyNode, (node) => {
    if (node.type === 'BinOp' && (node.op === '>>' || node.op === '<<')) found = true
  })
  return found
}

export const pioBitBangedProtocolRule = defineRule<BitBangMatch>({
  id: 'pio-bit-banged-protocol',
  title: 'Check for a hardware SPI or I²C before bit-banging this',
  message: 'This looks like SPI written by hand — the chip probably has it in silicon',
  catalogue: 53,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pio-bit-banged-protocol',
  safe: false,
  // Moving to a hardware peripheral means moving wires. Never automatic.
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<BitBangMatch>[] {
    const out: RefactorMatch<BitBangMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      const loop = node as ForStmt | WhileStmt

      // Count writes per pin object, and look for a shift feeding one of them.
      const writes = new Map<string, number>()
      let shifted = false
      for (const stmt of loop.body) {
        const target = pinWriteTarget(stmt)
        if (target) writes.set(target, (writes.get(target) ?? 0) + 1)
        if (containsShift(stmt)) shifted = true
      }
      if (!shifted) return

      // The clock is the pin written twice a pass — up then down.
      const clock = [...writes.entries()].find(([, n]) => n >= 2)?.[0]
      if (!clock) return
      // …and there must be a *separate* data pin, or it is not a shift-out.
      if (writes.size < 2) return

      out.push({
        ruleId: 'pio-bit-banged-protocol',
        start: loop.start,
        end: loop.body[0].start,
        message:
          `\`${clock}\` is toggled twice a bit with a shifted data pin — that is SPI. ` +
          'Check whether machine.SPI reaches those pins before reaching for PIO',
        data: { clock }
      })
    })
    return out
  },

  apply(): TextEdit[] | null {
    return null
  }
})
