/**
 * Rule 89 — **Do not allocate in the timer callback** (epic #634 §3.6).
 *
 * ```python
 * def sample(timer):                   samples = bytearray(64)
 *     log.append([                     index = 0
 *         time.ticks_ms(),             def sample(timer):
 *         battery.read_u16()               global index
 *     ])                                   samples[index] = battery.read_u16() >> 8
 *                                          index = (index + 1) % len(samples)
 * Timer(period=10, callback=sample)    Timer(period=10, callback=sample)
 * ```
 *
 * A `machine.Timer` callback is a hard interrupt on several ports (the RP2040
 * and the ESP32 among them), so it obeys exactly the same rule as a pin ISR: no
 * allocation. Building a list every 10 ms is asking the allocator for memory
 * from interrupt context, and when the heap is momentarily busy MicroPython
 * answers `MemoryError: memory allocation failed` — usually hours into a run,
 * never on the bench.
 *
 * It is the sneakier of the two, because the callback rarely *looks* like an
 * interrupt handler. It is an ordinary-looking `def` sitting next to ordinary
 * code, and the only clue is the `callback=` it was handed to.
 *
 * Hint only for the same reason as rule 36: pre-allocating the buffers and
 * moving the formatting to `micropython.schedule()` is a design decision about
 * your data, not a mechanical rewrite.
 *
 * The scanner and handler resolver are shared with rule 36 (`isr-allocation`) —
 * one hazard, two doors — so this file only owns the "which calls register a
 * timer callback?" question.
 */
import type { AnyNode, Call, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { findAllocation, keywordArg, resolveHandler } from './isr-allocation'

/** Is this expression a `Timer(...)` / `machine.Timer(...)` construction? */
function isTimerConstruction(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Call') return false
  const dotted = dottedName(unwrap(e.func))
  return dotted != null && dotted.split('.').pop() === 'Timer'
}

/** Is `target` (source text, e.g. `sampler` or `self.tick`) assigned a Timer anywhere? */
function assignedATimer(ctx: RefactorContext, target: string): boolean {
  const hits: number[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Assign' || !isTimerConstruction(n.value)) return
    for (const t of n.targets) {
      if (textOf(ctx, t).trim() === target) hits.push(t.start)
    }
  })
  return hits.length > 0
}

/**
 * Is this call one that arms a timer? Either the constructor —
 * `Timer(period=…, callback=…)` — or `.init(...)` on something we can *prove*
 * is a timer: an inline `Timer(-1).init(…)`, or a name that was assigned a
 * `Timer(...)` somewhere in this file.
 *
 * Proving the receiver matters. Plenty of drivers have an `.init()`, and a rule
 * that flagged `display.init(callback=redraw)` as an interrupt hazard would be
 * teaching something that is simply not true of that code.
 */
function isTimerArming(ctx: RefactorContext, call: Call): boolean {
  if (isTimerConstruction(call)) return true
  const func = unwrap(call.func)
  if (func.type !== 'Attribute' || func.attr !== 'init') return false
  const receiver = unwrap(func.value)
  if (isTimerConstruction(receiver)) return true
  if (receiver.type === 'Name' || receiver.type === 'Attribute') {
    return assignedATimer(ctx, textOf(ctx, receiver).trim())
  }
  return false
}

/**
 * Every timer callback registered in the file.
 *
 * Only the `callback=` keyword counts. MicroPython's `Timer()` takes the timer
 * *id* positionally, so a positional argument is not a handler — reading one as
 * a handler is how a rule starts flagging `Timer(-1)`.
 */
function timerRegistrations(ctx: RefactorContext): { call: Call; handler: Expr }[] {
  const out: { call: Call; handler: Expr }[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Call' || !isTimerArming(ctx, n)) return
    const handler = keywordArg(n, 'callback')
    if (handler) out.push({ call: n, handler })
  })
  return out
}

interface TimerMatch {
  label: string
  what: string
}

export const timerCallbackAllocationRule = defineRule<TimerMatch>({
  id: 'timer-callback-allocation',
  title: 'Do not allocate in the timer callback',
  message: 'This timer callback allocates — on a hard-IRQ port that means MemoryError',
  catalogue: 89,
  category: 'micropython',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-timer-callback-allocation',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<TimerMatch>[] {
    const out: RefactorMatch<TimerMatch>[] = []
    const seen = new Set<number>()

    for (const { call, handler } of timerRegistrations(ctx)) {
      const resolved = resolveHandler(ctx, handler, call)
      if (!resolved) continue
      // One callback armed on two timers is one problem, not two.
      if (seen.has(resolved.key)) continue
      seen.add(resolved.key)

      const alloc = findAllocation(resolved.body)
      if (!alloc) continue

      out.push({
        ruleId: 'timer-callback-allocation',
        start: alloc.node.start,
        end: alloc.node.end,
        message: `${resolved.label} is a timer callback — ${alloc.what} can fail with MemoryError in interrupt context`,
        data: { label: resolved.label, what: alloc.what }
      })
    }

    return out
  },

  // Hint only — see rule 36. The fix is a restructuring, and which numbers you
  // keep and when you print them is the author's decision.
  apply(): TextEdit[] | null {
    return null
  }
})
