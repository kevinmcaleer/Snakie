/**
 * Rule 50 — **A PIO state machine never misses a count** (epic #634 §3.7,
 * board-specific).
 *
 * ```python
 * # before — decoded in Python            # after — decoded in the PIO block
 * def on_edge(pin):                       sm = rp2.StateMachine(
 *     global state, count                     0, quadrature, in_base=Pin(2)
 *     a = enc_a.value()                   )
 *     b = enc_b.value()                   sm.active(1)
 *     state = ((state << 2) | (a << 1) | b) & 0xF
 *     count += TRANSITIONS[state]         count = sm.get()
 *
 * enc_a.irq(handler=on_edge)
 * ```
 *
 * Why it matters: at speed you *will* miss counts, and the failure is silent.
 *
 * A polling loop reads the two channels, then goes away and does something else
 * — reads a sensor, prints a line, waits on a servo. While it is away the
 * encoder can move through two transitions, and two transitions in opposite
 * directions look exactly like no movement at all. An interrupt handler is
 * better but not immune: a small gearmotor at full tilt produces edges faster
 * than MicroPython can enter a Python-level handler, and when the next edge
 * arrives before the last one has been serviced it is simply dropped. Nothing
 * raises. Nothing logs. The count is just quietly a bit low.
 *
 * What you see is a robot that drives 1 m and thinks it drove 0.94 m, and drifts
 * a little more every time — and because the error scales with speed, it looks
 * like a mechanical problem. People re-measure the wheels, re-tune the PID and
 * re-solder the encoder before suspecting the software, because the software
 * "works" at the speeds they test it at.
 *
 * A PIO state machine decodes quadrature in hardware. It watches both channels
 * on every one of its own clock cycles, keeps the count in a scratch register
 * and hands it over through the FIFO when you ask — no CPU involvement, no
 * interrupt latency, and no transition fast enough to slip past it. The RP2040
 * and RP2350 have eight and twelve of these; two of them cover a differential
 * drive and you get your main loop back as well.
 *
 * Hint only: the replacement is a PIO program plus a `StateMachine` per wheel,
 * which is a design decision about pins and clock rates, not a rewrite of the
 * handler you already have.
 *
 * Deliberately narrow. Two pin reads and a counter also describes a pair of
 * independent button counters, which PIO would not improve. This fires only when
 * the two channels are *combined* — shifted together, compared with each other,
 * or used as one index into a transition table — because combining them is what
 * makes it quadrature decoding rather than two unrelated inputs.
 */
import type { AnyNode, Call, Expr, ForStmt, FunctionDef, Stmt, WhileStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

type Loop = ForStmt | WhileStmt

/**
 * Expression shapes that *combine* two values. A tuple or an argument list does
 * not count — `a, b = pin_a.value(), pin_b.value()` puts both channels in one
 * node without doing anything quadrature-ish with them.
 */
const COMBINING = new Set(['BinOp', 'Compare', 'BoolOp', 'IfExp'])

interface EncoderMatch {
  /** How to name the offender in the message. */
  label: string
  /** The two pin objects being read, for the message. */
  channels: string[]
  /** Registered as an interrupt handler rather than polled. */
  viaIrq: boolean
}

/** `pin.value()` with no argument — a read of the line. */
function pinReadReceiver(ctx: RefactorContext, node: AnyNode): string | null {
  if (node.type !== 'Call' || node.args.length !== 0) return null
  const func = unwrap(node.func)
  if (func.type !== 'Attribute' || func.attr !== 'value') return null
  return ctx.src.slice(func.value.start, func.value.end).trim()
}

/** Walk `stmts` without descending into a nested `def`/`lambda`/`class`. */
function walkBody(stmts: readonly Stmt[], fn: (n: AnyNode) => void | false): void {
  for (const stmt of stmts) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
        return false
      }
      return fn(node)
    })
  }
}

/**
 * Names that hold a channel reading: `a = enc_a.value()` binds `a` to `enc_a`.
 * Tuple form (`a, b = enc_a.value(), enc_b.value()`) is handled too, because
 * that is how most encoder handlers are actually written.
 */
function channelNames(ctx: RefactorContext, stmts: readonly Stmt[]): Map<string, string> {
  const out = new Map<string, string>()
  const bind = (target: Expr, value: Expr): void => {
    const t = unwrap(target)
    if (t.type !== 'Name') return
    const receiver = pinReadReceiver(ctx, unwrap(value) as AnyNode)
    if (receiver) out.set(t.id, receiver)
  }
  walkBody(stmts, (node) => {
    if (node.type !== 'Assign' || node.targets.length !== 1) return undefined
    const target = unwrap(node.targets[0])
    const value = unwrap(node.value)
    if (target.type === 'Tuple' && value.type === 'Tuple' && target.elts.length === value.elts.length) {
      for (let i = 0; i < target.elts.length; i++) bind(target.elts[i], value.elts[i])
    } else {
      bind(target, node.value)
    }
    return undefined
  })
  return out
}

/** Every distinct pin object read with `.value()` inside these statements. */
function channelsRead(ctx: RefactorContext, stmts: readonly Stmt[]): string[] {
  const out = new Set<string>()
  walkBody(stmts, (node) => {
    const receiver = pinReadReceiver(ctx, node)
    if (receiver) out.add(receiver)
    return undefined
  })
  return [...out]
}

/** Which channels does this one expression pull in, directly or by name? */
function channelsIn(ctx: RefactorContext, root: AnyNode, named: Map<string, string>): Set<string> {
  const out = new Set<string>()
  walk(root, (node) => {
    const receiver = pinReadReceiver(ctx, node)
    if (receiver) out.add(receiver)
    if (node.type === 'Name') {
      const from = named.get(node.id)
      if (from) out.add(from)
    }
    return undefined
  })
  return out
}

/** Are the two channels combined into a single value anywhere in here? */
function combinesChannels(
  ctx: RefactorContext,
  stmts: readonly Stmt[],
  named: Map<string, string>
): boolean {
  let found = false
  walkBody(stmts, (node) => {
    if (found) return false
    if (!COMBINING.has(node.type)) return undefined
    if (channelsIn(ctx, node, named).size >= 2) found = true
    return undefined
  })
  return found
}

/** Does anything in here move a counter — `+=`, `-=`, or a table lookup? */
function updatesACounter(
  ctx: RefactorContext,
  stmts: readonly Stmt[],
  named: Map<string, string>
): boolean {
  let found = false
  walkBody(stmts, (node) => {
    if (found) return false
    if (node.type === 'AugAssign' && (node.op === '+' || node.op === '-')) {
      const target = unwrap(node.target)
      if (target.type === 'Name' || target.type === 'Attribute') found = true
      return undefined
    }
    if (node.type === 'Assign' && node.targets.length === 1) {
      const target = unwrap(node.targets[0])
      const value = unwrap(node.value)
      // `count = count + 1`
      if (value.type === 'BinOp' && (value.op === '+' || value.op === '-')) {
        const left = ctx.src.slice(value.left.start, value.left.end).trim()
        if (left === ctx.src.slice(target.start, target.end).trim()) found = true
      }
      // `delta = TRANSITIONS[state]` — the transition table, indexed by the
      // combined channel reading.
      if (value.type === 'Subscript' && channelsIn(ctx, value.slice as AnyNode, named).size > 0) {
        found = true
      }
    }
    return undefined
  })
  return found
}

/** Is this function handed to some `.irq(...)` as the handler? */
function registeredAsIrqHandler(ctx: RefactorContext, name: string): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Call') return undefined
    const func = unwrap(node.func)
    if (func.type !== 'Attribute' || func.attr !== 'irq') return undefined
    const handler = handlerArg(node)
    if (!handler) return undefined
    const dotted = dottedName(handler)
    if (dotted === name || dotted === `self.${name}`) found = true
    return undefined
  })
  return found
}

/** MicroPython's `irq()` takes the handler first, or as `handler=`. */
function handlerArg(call: Call): Expr | null {
  const kw = call.keywords.find((k) => k.arg === 'handler')
  if (kw) return kw.value
  const first = call.args[0]
  if (!first || first.type === 'Starred') return null
  return first
}

/** Does this function poll — i.e. is there a loop in its own body? */
function containsLoop(stmts: readonly Stmt[]): boolean {
  let found = false
  walkBody(stmts, (node) => {
    if (node.type === 'For' || node.type === 'While') found = true
    return undefined
  })
  return found
}

/** Outermost loops that are not inside any function — a module-level poll. */
function moduleLevelLoops(ctx: RefactorContext): Loop[] {
  const out: Loop[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
      return false
    }
    if (node.type === 'For' || node.type === 'While') {
      out.push(node)
      return false
    }
    return undefined
  })
  return out
}

/** One place worth judging: a function body, or a module-level polling loop. */
interface Unit {
  stmts: readonly Stmt[]
  start: number
  end: number
  label: string
  viaIrq: boolean
  polls: boolean
}

function unitsOf(ctx: RefactorContext): Unit[] {
  const out: Unit[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'FunctionDef') return undefined
    const fn: FunctionDef = node
    const viaIrq = registeredAsIrqHandler(ctx, fn.name)
    out.push({
      stmts: fn.body,
      start: fn.defStart,
      end: fn.nameStart + fn.name.length,
      label: `${fn.name}()`,
      viaIrq,
      polls: containsLoop(fn.body)
    })
    return undefined
  })
  for (const loop of moduleLevelLoops(ctx)) {
    out.push({
      stmts: loop.body,
      start: loop.start,
      end: loop.end,
      label: 'this polling loop',
      viaIrq: false,
      polls: true
    })
  }
  return out
}

export const pioEncoderRule = defineRule<EncoderMatch>({
  id: 'pio-encoder',
  title: 'A PIO state machine never misses a count',
  message: 'Quadrature decoded in software drops counts at speed — PIO decodes it in hardware',
  catalogue: 50,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pio-encoder',
  // Replacing the handler with a PIO program changes where the count lives and
  // how it is read; that is a design change, not a tidy-up.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<EncoderMatch>[] {
    const out: RefactorMatch<EncoderMatch>[] = []

    for (const unit of unitsOf(ctx)) {
      // Only code that actually runs on every edge: an interrupt handler, or a
      // loop that keeps looking. A helper called once is nobody's decoder.
      if (!unit.viaIrq && !unit.polls) continue

      const channels = channelsRead(ctx, unit.stmts)
      if (channels.length < 2) continue

      const named = channelNames(ctx, unit.stmts)
      // Two channels combined into one value is what makes this quadrature and
      // not two unrelated switches.
      if (!combinesChannels(ctx, unit.stmts, named)) continue
      if (!updatesACounter(ctx, unit.stmts, named)) continue

      const how = unit.viaIrq
        ? 'runs on every encoder edge, and an edge that arrives before Python has finished the last one is dropped without a word'
        : 'polls both channels, so any transition that happens between two passes is lost'
      out.push({
        ruleId: 'pio-encoder',
        start: unit.start,
        end: unit.end,
        message: `${unit.label} decodes ${channels[0]}/${channels[1]} in software — it ${how}. A PIO state machine decodes quadrature in hardware and cannot miss a transition`,
        data: { label: unit.label, channels, viaIrq: unit.viaIrq }
      })
    }

    return out.sort((a, b) => a.start - b.start)
  },

  // Hint only. The replacement is a PIO program and a `StateMachine` per wheel:
  // which pins, which clock, where the count is read. That is the author's
  // design decision, and getting it wrong stops the robot.
  apply(): TextEdit[] | null {
    return null
  }
})
