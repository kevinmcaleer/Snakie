/**
 * Rule 51 — **PIO measures the pulse without the jitter** (epic #634 §3.7,
 * board-specific).
 *
 * ```python
 * # before — timed by the interpreter        # after — timed by the PIO block
 * while echo.value() == 0:                   sm = rp2.StateMachine(
 *     start = time.ticks_us()                    0, echo_timer, freq=1_000_000,
 * while echo.value() == 1:                       in_base=echo
 *     pass                                   )
 * end = time.ticks_us()                      sm.active(1)
 * cm = time.ticks_diff(end, start) / 58      cm = sm.get() / 58
 * ```
 *
 * Why it matters: the noisy readings everyone blames on the sensor are usually
 * Python's timing jitter, not the sensor at all.
 *
 * An HC-SR04 answers by holding a pin high for as long as the sound took to come
 * back, and you convert that time to a distance by dividing by 58 µs per
 * centimetre. So every microsecond of error in your measurement is about a fifth
 * of a millimetre — and *every* microsecond counts, in both directions. Between
 * your two `ticks_us()` calls the interpreter may service an interrupt, run
 * another thread, or start a garbage collection, and a gc pass on a busy heap is
 * easily hundreds of microseconds. That is centimetres. It arrives at random, on
 * one reading in twenty, which is precisely the pattern that makes people add a
 * median filter, take five readings and average them, or buy a different sensor.
 *
 * None of those fix the cause. The pulse was always the right length; the clock
 * watching it was not.
 *
 * A PIO state machine counts the pulse in its own hardware at a clock you choose
 * and pushes the number into the FIFO. Nothing the CPU does can perturb it, so
 * consecutive readings of a stationary wall differ by a count or two instead of
 * by centimetres — and your main loop is free while it measures, rather than
 * spinning in a `while` doing nothing.
 *
 * `machine.time_pulse_us()` is worth knowing about as a middle step: it is the
 * same measurement written in C, so the interpreter's per-statement jitter goes
 * away and it is a large improvement over a hand-rolled spin loop for one line
 * of change. It still blocks the CPU for the whole pulse, and it can still be
 * interrupted, so this rule mentions it more gently than it mentions the spin
 * loop.
 *
 * Hint only: moving to PIO changes where the number comes from and when it is
 * ready, which is the author's call.
 */
import type { AnyNode, Stmt, WhileStmt } from '../ast'
import { enclosingFunction, unwrap, walk } from '../ast'
import { callName, isCallTo } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/**
 * Calls that mean the loop is waiting politely rather than spinning on a pulse.
 * A debounce loop sleeps; a pulse measurement never can.
 */
const NOT_A_SPIN = new Set([
  'sleep',
  'sleep_ms',
  'sleep_us',
  'print',
  'read',
  'readinto',
  'write',
  'recv',
  'send',
  'collect'
])

/** A spin loop longer than this is doing work, not timing an edge. */
const MAX_SPIN_BODY = 3

interface PulseMatch {
  /** `'spin'` — a hand-rolled `while pin.value()` loop; `'c'` — time_pulse_us. */
  shape: 'spin' | 'c'
}

/** `pin.value()` with no argument — the read a spin loop waits on. */
function isPinRead(node: AnyNode): boolean {
  if (node.type !== 'Call' || node.args.length !== 0) return false
  const func = unwrap(node.func)
  return func.type === 'Attribute' && func.attr === 'value'
}

/** Does this `while` test wait on a pin level? */
function testsAPin(test: AnyNode): boolean {
  let found = false
  walk(test, (node) => {
    if (isPinRead(node)) found = true
    return undefined
  })
  return found
}

/**
 * A body tight enough to be an edge-wait: a couple of statements at most, no
 * nested loop, and nothing that sleeps, prints or does I/O.
 */
function isTightSpin(body: readonly Stmt[]): boolean {
  if (body.length > MAX_SPIN_BODY) return false
  let tight = true
  for (const stmt of body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'For' || node.type === 'While' || node.type === 'FunctionDef') {
        tight = false
        return false
      }
      if (node.type === 'Call') {
        const name = callName(node.func)
        if (name && NOT_A_SPIN.has(name)) tight = false
      }
      return undefined
    })
  }
  return tight
}

/**
 * Is the pulse being timed with `ticks_us()` in the loop's own scope?
 *
 * Only that scope counts. Descending into nested `def`s — and, for a
 * module-level loop, into every function in the file — reads a `ticks_us()` out
 * of code that has nothing to do with this loop: a bare `while
 * button.value(): pass` at the bottom of a file is not an echo measurement just
 * because some unrelated helper happens to read the clock, and telling its
 * author to reach for PIO would be a hint about code that does not exist.
 */
function timedWithTicksUs(ctx: RefactorContext, node: AnyNode): boolean {
  const fn = enclosingFunction(node)
  const root: AnyNode = fn ? (fn as AnyNode) : (ctx.module as AnyNode)
  let found = false
  walk(root, (n) => {
    if (n !== root && (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef')) {
      return false
    }
    if (n.type === 'Call' && callName(n.func) === 'ticks_us') found = true
    return undefined
  })
  return found
}

export const pioPulseMeasureRule = defineRule<PulseMatch>({
  id: 'pio-pulse-measure',
  title: 'PIO measures the pulse without the jitter',
  message: 'Timing a pulse from Python measures the interpreter as well as the echo',
  catalogue: 51,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pio-pulse-measure',
  // Reading the distance out of a FIFO instead of a blocking call changes when
  // the number is available; that is a design change, not a tidy-up.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<PulseMatch>[] {
    const out: RefactorMatch<PulseMatch>[] = []
    const hedged = ctx.capabilities?.inferred === true
    const has = hedged ? 'Your board probably has' : 'Your board has'

    walk(ctx.module as AnyNode, (node) => {
      // The hand-rolled version: spin until the pin changes, note the clock.
      if (node.type === 'While') {
        const loop: WhileStmt = node
        if (!testsAPin(loop.test as AnyNode)) return undefined
        if (!isTightSpin(loop.body)) return undefined
        if (!timedWithTicksUs(ctx, loop as AnyNode)) return undefined
        out.push({
          ruleId: 'pio-pulse-measure',
          start: loop.start,
          end: loop.end,
          message: `This spin loop times the echo with the interpreter running: one garbage collection between the \`ticks_us()\` calls is hundreds of microseconds, which at the speed of sound is centimetres. ${has} a PIO block that counts the pulse in hardware`,
          data: { shape: 'spin' }
        })
        return undefined
      }

      // The C version: much steadier, still blocking.
      if (node.type === 'Call' && isCallTo(node, ['machine', 'umachine'], 'time_pulse_us')) {
        out.push({
          ruleId: 'pio-pulse-measure',
          start: node.start,
          end: node.end,
          message: `\`time_pulse_us()\` times the echo in C, so it is far steadier than a Python loop — but it still blocks the CPU for the whole pulse and it can still be interrupted. ${has} a PIO block that measures it in the background`,
          data: { shape: 'c' }
        })
      }
      return undefined
    })

    return out
  },

  // Hint only. A PIO ranger hands the count over through the FIFO, so the code
  // that asks for a distance has to change shape too — that is the author's
  // decision, not a substitution.
  apply(): TextEdit[] | null {
    return null
  }
})
