/**
 * Rule 35 — **Create the hardware object once, outside the loop**
 * (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                            # after
 * def blink(count):                   def blink(count):
 *     for _ in range(count):              led = Pin(25, Pin.OUT)
 *         led = Pin(25, Pin.OUT)          for _ in range(count):
 *         led.value(1)                        led.value(1)
 *         sleep_ms(50)                        sleep_ms(50)
 * ```
 *
 * Why it matters: a `Pin`, `PWM` or `I2C` object is not a value, it is a driver.
 * Rebuilding one every time round the loop allocates a fresh object on a heap
 * that has no room to spare, hands the collector work it did not need, and on
 * several ports re-runs the peripheral's *initialisation* — re-arming the pad,
 * resetting the PWM counter, dropping the line low for an instant. That is why
 * this one is a **warning** rather than a hint: people meet it as "my PWM
 * flickers" or "the bus randomly NAKs", and never think to look at the
 * constructor.
 *
 * The rewrite is loop-invariant code motion, so it only fires when it can be
 * proved safe: the construction must be an unconditional statement of the loop
 * body, bound to a name the loop does not rebind, its arguments must not read
 * anything the loop writes, the name must not be read after the loop, and a
 * `while` must not test the name it builds. Anything less and we decline rather
 * than guess (§2.6.5) — a wrong rewrite here does not raise, it just makes the
 * hardware misbehave, which is the worst kind of wrong.
 */
import type { AnyNode, Call, Expr, ForStmt, Stmt, WhileStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, isPureExpression } from '../expr'
import { isReadAfter, nameUses, namesRead, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface HoistMatch {
  loop: ForStmt | WhileStmt
  stmt: Stmt
  name: string
  className: string
}

/** The `machine` classes that own a peripheral rather than describing a value. */
const HARDWARE_CLASSES = new Set(['Pin', 'PWM', 'I2C', 'SPI', 'UART', 'ADC', 'Timer', 'Signal'])

/** Modules those classes are reached through when imported as a module. */
const HARDWARE_MODULES = new Set(['machine'])

/** The call, when this expression constructs one of the hardware classes. */
function hardwareCall(expr: Expr): Call | null {
  const e = unwrap(expr)
  if (e.type !== 'Call') return null
  const dotted = dottedName(e.func)
  if (!dotted) return null
  const parts = dotted.split('.')
  if (parts.length === 1) return HARDWARE_CLASSES.has(parts[0]) ? e : null
  if (parts.length === 2 && HARDWARE_MODULES.has(parts[0]) && HARDWARE_CLASSES.has(parts[1])) {
    return e
  }
  return null
}

/**
 * May this argument be evaluated once instead of once per iteration?
 *
 * Pure expressions obviously may. So may a nested hardware constructor, because
 * `PWM(Pin(15))` is the idiom the whole rule is about — but nothing else: a
 * plain call could be reading a sensor, and moving it would quietly change how
 * often the hardware is touched.
 */
function isHoistableArg(expr: Expr): boolean {
  if (isPureExpression(expr)) return true
  const call = hardwareCall(expr)
  if (!call) return false
  return call.args.every(isHoistableArg) && call.keywords.every((k) => isHoistableArg(k.value))
}

/** Does this subtree contain a jump that could skip the rest of the body? */
function hasJump(node: AnyNode): boolean {
  let found = false
  walk(node, (n) => {
    if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
    if (n.type === 'Break' || n.type === 'Continue' || n.type === 'Return' || n.type === 'Raise') {
      found = true
      return false
    }
    return undefined
  })
  return found
}

/** The expression a loop evaluates in its header (the iterable or the test). */
function headerExpr(loop: ForStmt | WhileStmt): Expr {
  return loop.type === 'For' ? loop.iter : loop.test
}

/**
 * Everything after the statement on its own line: whitespace, an optional
 * trailing comment, and the newline. Null when the line holds anything else
 * (a second statement after a `;`), which we will not try to move.
 */
function lineTail(ctx: RefactorContext, stmt: Stmt): string | null {
  const end = lineEnd(ctx.src, stmt.end)
  const tail = ctx.src.slice(stmt.end, end)
  return /^[ \t]*(#[^\r\n]*)?\r?\n?$/.test(tail) ? tail : null
}

export const hoistHardwareConstructionRule = defineRule<HoistMatch>({
  id: 'hoist-hardware-construction',
  title: 'Create the hardware object once, outside the loop',
  message: 'This driver object is rebuilt every iteration — create it once, before the loop',
  catalogue: 35,
  category: 'micropython',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-hoist-hardware-construction',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<HoistMatch>[] {
    const out: RefactorMatch<HoistMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      const loop = node
      // Removing the only statement of a body would leave an empty block.
      if (loop.body.length < 2) return

      // How often the loop binds each name, counting the `for` target and every
      // assignment in the body — one write is "this construction and nothing
      // else", which is the only case we can move.
      const writeCounts = new Map<string, number>()
      for (const use of nameUses([loop as AnyNode])) {
        if (use.kind === 'write') writeCounts.set(use.name, (writeCounts.get(use.name) ?? 0) + 1)
      }
      const headerReads = namesRead([headerExpr(loop) as AnyNode])
      const scope = scopeOf(loop)

      for (let i = 0; i < loop.body.length; i++) {
        const stmt = loop.body[i]
        // Only an unconditional statement of the body itself: hoisting out of an
        // `if` would construct hardware the original might never have built.
        if (stmt.type !== 'Assign' || stmt.targets.length !== 1) continue
        const target = unwrap(stmt.targets[0])
        if (target.type !== 'Name') continue
        const call = hardwareCall(stmt.value)
        if (!call) continue
        const className = dottedName(call.func) ?? ''

        // One line only — a multi-line call would need re-indenting, and that
        // is a rewrite this rule has no business guessing at.
        const startLine = ctx.lines.positionAt(stmt.start).line
        if (startLine !== ctx.lines.positionAt(stmt.end).line) continue
        // …and not sharing the loop's own line (`for i in r: p = Pin(2)`).
        if (startLine === ctx.lines.positionAt(loop.start).line) continue
        if (lineTail(ctx, stmt) == null) continue

        if (!call.args.every(isHoistableArg)) continue
        if (!call.keywords.every((k) => isHoistableArg(k.value))) continue

        // Loop-invariance: the constructor must not read anything the loop
        // writes (including the loop variable, and its own target).
        const reads = namesRead([call as AnyNode])
        let variant = false
        for (const name of reads) if (writeCounts.has(name)) variant = true
        if (variant) continue

        // Assigned more than once in the loop — the statements between the two
        // writes would start seeing the previous iteration's object.
        if (writeCounts.get(target.id) !== 1) continue

        // An earlier `break`/`continue`/`return` could mean the construction
        // never happens at all; hoisting would make it happen once.
        if (loop.body.slice(0, i).some((s) => hasJump(s))) continue
        // Reading the name before it is assigned means the loop relies on the
        // previous iteration's object (or on an outer binding).
        const before = namesRead(loop.body.slice(0, i) as AnyNode[])
        if (before.has(target.id)) continue

        // The header is evaluated before the hoisted line would be, so it must
        // not depend on the name we are about to bind earlier.
        if (headerReads.has(target.id)) continue
        // Used after the loop — including in its own `else:` — and the object's
        // lifetime is part of what the code means.
        if (namesRead(loop.orelse as AnyNode[]).has(target.id)) continue
        if (isReadAfter(scope, target.id, loop.end)) continue

        out.push({
          ruleId: 'hoist-hardware-construction',
          start: stmt.start,
          end: stmt.end,
          message: `\`${className}(…)\` is rebuilt on every iteration — create \`${target.id}\` once, before the loop`,
          data: { loop, stmt, name: target.id, className }
        })
      }
    })

    return out
  },

  apply(match: RefactorMatch<HoistMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, stmt } = match.data
    const tail = lineTail(ctx, stmt)
    if (tail == null) return null

    const from = lineStart(ctx.src, stmt.start)
    const to = lineEnd(ctx.src, stmt.end)
    // Everything before the statement on its line must be indentation only.
    if (ctx.src.slice(from, stmt.start).trim() !== '') return null

    const loopLine = lineStart(ctx.src, loop.start)
    if (loopLine >= from) return null

    // Take the statement with its trailing comment, and re-indent to the loop's
    // own column. A file's last line may have no newline of its own.
    let moved = indentAt(ctx.src, loop.start) + ctx.src.slice(stmt.start, to)
    if (!moved.endsWith('\n')) moved += ctx.eol

    return [
      { start: loopLine, end: loopLine, newText: moved },
      { start: from, end: to, newText: '' }
    ]
  }
})
