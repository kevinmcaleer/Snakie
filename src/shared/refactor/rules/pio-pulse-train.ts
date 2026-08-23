/**
 * Rule 52 — **Let the hardware make the pulses** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before — a servo pulse train, hand-rolled
 * while True:
 *     servo.value(1)
 *     time.sleep_us(1500)
 *     servo.value(0)
 *     time.sleep_us(18500)
 * ```
 *
 * Why it matters: this loop has one job — hold a pin high for a precise time,
 * then low for a precise time — and it is the *worst* possible way to do it,
 * because the CPU has to be present for every microsecond of it. Three
 * consequences follow, and all of them bite:
 *
 * - **The timing is only as good as your loop.** A garbage collection, an
 *   interrupt, or anything else the board decides to do lands in the middle of
 *   your pulse and stretches it. On a servo that is a visible twitch; on a
 *   stepper it is a missed step.
 * - **The CPU can do nothing else.** The whole point of a robot's main loop is
 *   to read sensors and decide things, and this loop is asleep for 20 ms out of
 *   every 20 ms.
 * - **It does not scale.** Two servos this way is twice the problem, and four is
 *   not possible at all.
 *
 * Both fixes are hardware doing the work instead:
 *
 * - **`PWM`** is the right answer for a plain repeating square wave, which is
 *   what a hobby servo wants. Set the frequency to 50 Hz and the duty to the
 *   pulse width, and the peripheral holds it forever with no CPU at all.
 * - **PIO** is the answer when the waveform is not a plain square wave — a
 *   stepper ramp, a one-shot pulse of an exact length, an unusual protocol
 *   frame. A state machine clocks it deterministically, and you can run several
 *   independently.
 *
 * Snakie only points, because which of the two you want depends on the shape of
 * the waveform, and getting that wrong is worse than leaving the loop alone.
 */
import type { AnyNode, ForStmt, Stmt, WhileStmt } from '../ast'
import { walk } from '../ast'
import { callName, dottedName, literalNumber } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface PulseTrainMatch {
  /** How many pin writes the loop body makes. */
  writes: number
  /** Whether the delays look like a plain repeating square wave. */
  squareWave: boolean
}

/** The sub-millisecond sleeps that mean somebody is timing a waveform. */
const MICRO_SLEEPS = new Set(['sleep_us', 'sleep_ms'])

/** Is this statement a write to a pin — `p.value(1)`, `p.on()`, `p.high()`? */
function isPinWrite(stmt: Stmt): boolean {
  if (stmt.type !== 'ExprStmt' || stmt.value.type !== 'Call') return false
  const dotted = dottedName(stmt.value.func)
  if (!dotted || !dotted.includes('.')) return false
  const method = dotted.split('.').pop()!
  if (method === 'value') return stmt.value.args.length === 1
  return method === 'on' || method === 'off' || method === 'high' || method === 'low'
}

/** The microsecond delay a statement waits for, or null. */
function sleepDelayUs(stmt: Stmt): number | null {
  if (stmt.type !== 'ExprStmt' || stmt.value.type !== 'Call') return null
  const name = callName(stmt.value.func)
  if (!name || !MICRO_SLEEPS.has(name)) return null
  if (stmt.value.args.length !== 1) return null
  const value = literalNumber(stmt.value.args[0])
  if (value == null) return null
  return name === 'sleep_ms' ? value * 1000 : value
}

export const pioPulseTrainRule = defineRule<PulseTrainMatch>({
  id: 'pio-pulse-train',
  title: 'Let PWM or PIO make this pulse train',
  message: 'This loop hand-rolls a waveform the hardware could hold for free',
  catalogue: 52,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pio-pulse-train',
  safe: false,
  // PWM or PIO depends on the waveform's shape; picking one would be guessing.
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<PulseTrainMatch>[] {
    const out: RefactorMatch<PulseTrainMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      const loop = node as ForStmt | WhileStmt

      // Look only at the loop's own statements: a nested loop is its own case.
      let writes = 0
      const delays: number[] = []
      for (const stmt of loop.body) {
        if (isPinWrite(stmt)) writes++
        const delay = sleepDelayUs(stmt)
        if (delay != null) delays.push(delay)
      }

      // A pulse TRAIN is at least a high and a low, each with its own delay.
      if (writes < 2 || delays.length < 2) return
      // Anything slower than ~50 ms a phase is a blink, not a waveform — and
      // telling someone their LED blink should be a PIO program is silly.
      if (delays.some((d) => d > 50_000)) return

      // Two writes and two delays that repeat forever is a plain square wave,
      // which is exactly what the PWM peripheral exists for.
      const squareWave = writes === 2 && delays.length === 2
      out.push({
        ruleId: 'pio-pulse-train',
        start: loop.start,
        end: loop.body[0].start,
        message: squareWave
          ? 'This is a square wave held by the CPU — PWM would hold it in hardware, for free'
          : 'This loop clocks a waveform by hand — a PIO state machine would do it deterministically',
        data: { writes, squareWave }
      })
    })
    return out
  },

  apply(): TextEdit[] | null {
    return null
  }
})
