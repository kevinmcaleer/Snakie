/**
 * Rule 84 — **Do not spin waiting for the flag** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                        # after (one of several right answers)
 * while not ready:                while not ready:
 *     pass                            time.sleep_ms(1)
 * ```
 *
 * Why it matters: `while not ready: pass` is a *busy-wait*. It does not wait —
 * it runs, flat out, executing the loop millions of times a second and doing
 * nothing with any of them. The costs are all real and all invisible until they
 * bite:
 *
 * - **Power.** The CPU never idles, so a battery-powered robot that should sit
 *   quietly between readings instead runs at full draw. On a coin cell this is
 *   the difference between weeks and hours.
 * - **Heat and headroom.** Everything else on the board is now competing with a
 *   loop that has nothing to do.
 * - **The network stack.** On an ESP32 or a Pico W, WiFi and Bluetooth are
 *   serviced from the same core as your Python. A tight spin loop starves them,
 *   which shows up as dropped connections you will blame on the router.
 *
 * There are three good answers and Snakie will not pick for you, because the
 * right one depends on what you are waiting *for*:
 *
 * - **Sleep in the loop** — `time.sleep_ms(1)` inside the body. One line, and it
 *   hands the CPU back between checks. Almost always enough.
 * - **Wait on an interrupt** — if the thing you are waiting for is a pin, an
 *   `.irq()` handler means you do not poll at all.
 * - **`await` an `asyncio.Event`** — in async code this is the idiomatic answer,
 *   and it lets every other task run while you wait.
 *
 * The empty-bodied form is also a genuine hang risk in its own right: if the
 * flag is only ever set by an interrupt that cannot fire while the loop holds
 * the CPU, the loop never exits at all.
 */
import type { AnyNode, WhileStmt } from '../ast'
import { walk } from '../ast'
import { textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface BusyWaitMatch {
  loop: WhileStmt
}

/** Is this loop body doing nothing at all? */
function isEmptyBody(loop: WhileStmt): boolean {
  if (loop.body.length !== 1) return false
  const only = loop.body[0]
  return only.type === 'Pass' || only.type === 'Continue'
}

export const busyWaitRule = defineRule<BusyWaitMatch>({
  id: 'busy-wait',
  title: 'Do not spin waiting for the flag',
  message: 'This loop burns 100% CPU doing nothing — sleep in it, or wait on an interrupt',
  catalogue: 84,
  category: 'micropython',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-busy-wait',
  safe: false,
  // Sleep, IRQ or asyncio.Event are all right answers depending on what you are
  // waiting for; picking one for the user would be guessing at their design.
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<BusyWaitMatch>[] {
    const out: RefactorMatch<BusyWaitMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'While') return
      if (!isEmptyBody(node)) return
      // `while True: pass` is a deliberate park-here-forever (a common last line
      // of a demo), not an accidental spin on a condition.
      const test = node.test
      if (test.type === 'Constant' && test.kind === 'bool' && test.raw === 'True') return
      out.push({
        ruleId: 'busy-wait',
        start: node.start,
        end: node.test.end,
        message:
          `\`while ${textOf(ctx, node.test)}\` spins at 100% CPU — ` +
          'sleep inside it, or wait on an interrupt instead',
        data: { loop: node }
      })
    })
    return out
  },

  apply(): TextEdit[] | null {
    return null
  }
})
