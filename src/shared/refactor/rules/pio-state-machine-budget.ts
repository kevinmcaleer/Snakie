/**
 * Rule 54 — **You are running out of state machines** (epic #634 §3.7,
 * board-specific).
 *
 * ```python
 * # before — six, and counting              # after — one program, four pixels
 * lights = rp2.StateMachine(0, ws2812, …)   lights = rp2.StateMachine(0, ws2812, …)
 * left = rp2.StateMachine(1, quad, …)       left = rp2.StateMachine(1, quad, …)
 * right = rp2.StateMachine(2, quad, …)      right = rp2.StateMachine(2, quad, …)
 * servo_a = rp2.StateMachine(3, pulse, …)   servos = rp2.StateMachine(3, pulse4, …)
 * servo_b = rp2.StateMachine(4, pulse, …)
 * servo_c = rp2.StateMachine(5, pulse, …)   # one program, four pins, one FIFO
 * ```
 *
 * Why it matters: PIO state machines are a fixed, small, countable resource, and
 * the day you run out is the day the robot stops working with a `ValueError`
 * from a line that has been fine for weeks.
 *
 * The RP2040 has **eight**: two PIO blocks with four state machines each. The
 * RP2350 has **twelve**, in three blocks of four. That is the headline number,
 * and it is not the one that usually bites.
 *
 * The one that bites is instruction memory. Each PIO block has room for **32
 * instructions in total, shared by all four of its state machines**. Two copies
 * of the same program are loaded once and shared, but four *different* programs
 * averaging nine instructions each will not fit in one block no matter how many
 * state machines are free — and the failure arrives as "PIO instruction memory
 * is full" when you add the last one. So you can run out of program space with
 * half your state machines idle.
 *
 * Both limits point at the same fix, which is why this fires at **five** rather
 * than at the hard ceiling: while there is still room, restructure. One program
 * driving four servo pins beats four programs driving one each; two wheels
 * sharing one quadrature program cost one program's worth of instruction memory,
 * not two; and anything running at kilohertz rather than megahertz — a servo
 * refresh, a status LED — very often does not need PIO at all when a `Timer` or
 * a `PWM` channel will do.
 *
 * Hint only: which peripheral to fold together is a judgement about your robot.
 * The rule counts, names the board's real budget, and leaves the design to you.
 *
 * Careful about `StateMachine`: plenty of robot code has a hand-written
 * `class StateMachine` for behaviour, and telling someone their behaviour tree
 * has exhausted the PIO block would be nonsense. This counts a construction only
 * when the name provably comes from `rp2`.
 */
import type { AnyNode, Call } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/**
 * Warn here rather than at the hard ceiling. Eight is the RP2040's limit, so a
 * file at five still has room to restructure; a file at eight has none.
 */
const CROWDED = 5

/** Blocks of four, on both chips — the number that governs program memory. */
const STATE_MACHINES_PER_BLOCK = 4

/** Instructions per PIO block, shared by its four state machines. */
const INSTRUCTIONS_PER_BLOCK = 32

interface BudgetMatch {
  /** How many `StateMachine(...)` constructions the file contains. */
  used: number
  /** How many the connected board has, when the probe told us. */
  available: number | null
}

/** Names bound to the `rp2` module: `import rp2`, `import rp2 as pio`. */
function rp2Aliases(ctx: RefactorContext): Set<string> {
  const out = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return undefined
    for (const alias of node.names) {
      if (alias.name === 'rp2') out.add(alias.asname ?? 'rp2')
    }
    return undefined
  })
  return out
}

/** Did the file do `from rp2 import StateMachine` (or `import *`)? */
function importsStateMachineFromRp2(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom' || node.module !== 'rp2') return undefined
    if (node.isStar || node.names.some((a) => a.name === 'StateMachine')) found = true
    return undefined
  })
  return found
}

/**
 * Does this file define its own `StateMachine`? A behaviour FSM is a very common
 * thing to write, and it has nothing to do with PIO — so when the name is the
 * author's, count nothing at all.
 */
function definesOwnStateMachine(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (
      (node.type === 'ClassDef' || node.type === 'FunctionDef') &&
      node.name === 'StateMachine'
    ) {
      found = true
    }
    return undefined
  })
  return found
}

/** Every `rp2.StateMachine(...)` construction, in source order. */
function stateMachineConstructions(ctx: RefactorContext): Call[] {
  if (definesOwnStateMachine(ctx)) return []
  const aliases = rp2Aliases(ctx)
  const bareIsRp2 = importsStateMachineFromRp2(ctx)
  const out: Call[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Call') return undefined
    const dotted = dottedName(unwrap(node.func))
    if (!dotted) return undefined
    if (dotted === 'StateMachine') {
      if (bareIsRp2) out.push(node)
      return undefined
    }
    const dot = dotted.lastIndexOf('.')
    if (dot > 0 && dotted.slice(dot + 1) === 'StateMachine' && aliases.has(dotted.slice(0, dot))) {
      out.push(node)
    }
    return undefined
  })
  return out
}

export const pioStateMachineBudgetRule = defineRule<BudgetMatch>({
  id: 'pio-state-machine-budget',
  title: 'You are running out of state machines',
  message: 'PIO state machines are a small fixed resource, and this file is using most of them',
  catalogue: 54,
  category: 'board',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-pio-state-machine-budget',
  // Folding peripherals into one program is a redesign, not a rewrite.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<BudgetMatch>[] {
    const calls = stateMachineConstructions(ctx)
    if (calls.length < CROWDED) return []

    const caps = ctx.capabilities
    const available = caps?.stateMachines ?? null
    const used = calls.length
    const board = caps?.machine ? `your ${caps.machine}` : 'your board'
    const hedge = caps?.inferred === true ? 'probably ' : ''

    let budget: string
    if (available == null) {
      // No probed number: say what the two chips have and let the reader look.
      budget = `an RP2040 has 8 and an RP2350 has 12`
    } else if (used > available) {
      budget = `${board} ${hedge}has ${available}, so ${used - available} of them cannot be created`
    } else {
      budget = `${board} ${hedge}has ${available}`
    }

    // The one that tips the file over is the most useful thing to point at.
    const anchor = calls[CROWDED - 1]
    return [
      {
        ruleId: 'pio-state-machine-budget',
        start: anchor.start,
        end: anchor.end,
        message: `This file builds ${used} PIO state machines; ${budget}. Each PIO block also shares ${INSTRUCTIONS_PER_BLOCK} instructions between its ${STATE_MACHINES_PER_BLOCK} state machines, so you can run out of program space first — fold peripherals into one shared program while there is still room`,
        data: { used, available }
      }
    ]
  },

  // Hint only. Which two peripherals should share a program depends on what they
  // do and how fast, and getting that wrong stops the robot.
  apply(): TextEdit[] | null {
    return null
  }
})
