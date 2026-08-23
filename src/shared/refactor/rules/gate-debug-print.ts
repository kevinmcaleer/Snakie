/**
 * Rule 38 — **Gate the print behind a DEBUG flag** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                          # after (yours to write)
 * while True:                       DEBUG = False
 *     angle = read_angle()          …
 *     print("angle", angle)         while True:
 *     drive(angle * 4)                  angle = read_angle()
 *     sleep_ms(20)                      if DEBUG:
 *                                           print("angle", angle)
 *                                       drive(angle * 4)
 *                                       sleep_ms(20)
 * ```
 *
 * Why it matters: on a microcontroller `print` is not free and it is not
 * asynchronous. It formats the arguments, then **blocks** until the bytes have
 * been pushed out of the UART or USB CDC — and if nothing is draining the other
 * end, it can block for a very long time. At 115200 baud a forty-character line
 * costs about 3.5 ms; drop that into a 20 ms control loop and a fifth of the
 * budget has gone to a debug message. This is the single most common reason a
 * beginner's balancing robot, line follower or PID loop "runs fine until I plug
 * it into the laptop" — and it is invisible in the code, because the same line
 * on a desktop costs nothing.
 *
 * **Hint only.** Deleting someone's debugging is not a refactoring, and the
 * right fix depends on what they were debugging: a `DEBUG` flag, a counter that
 * prints every hundredth pass, or a value logged to a list and dumped after the
 * run. So `apply` declines and the "Why?" article does the teaching.
 */
import type { AnyNode, ForStmt, Stmt, WhileStmt } from '../ast'
import { ancestors, enclosingLoop, unwrap, walk } from '../ast'
import { callName, dottedName, literalNumber } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface GatePrintMatch {
  stmt: Stmt
  /** True when the enclosing loop is `while True:` rather than merely tight. */
  forever: boolean
}

/** Calls that hand time back — a loop containing one is not a tight loop. */
const SLEEPS = new Set([
  'sleep',
  'sleep_ms',
  'sleep_us',
  'lightsleep',
  'deepsleep',
  'idle',
  'wfi'
])

/** Names that mark a condition as an existing debug gate. */
const DEBUG_NAME = /debug|verbose|trace/i

/** `while True:` — or `while 1:`, which beginners write just as often. */
function loopsForever(loop: ForStmt | WhileStmt): boolean {
  if (loop.type !== 'While') return false
  const test = unwrap(loop.test)
  if (test.type === 'Constant' && test.kind === 'bool') return test.raw === 'True'
  return literalNumber(test) === 1
}

/** Does this block hand time back anywhere inside it? */
function containsSleep(body: readonly Stmt[]): boolean {
  let found = false
  for (const stmt of body) {
    walk(stmt as AnyNode, (n) => {
      if (found) return false
      if (n.type === 'Call') {
        const name = callName(n.func)
        if (name && SLEEPS.has(name)) {
          found = true
          return false
        }
      }
      return undefined
    })
  }
  return found
}

/** Is the print already inside `if DEBUG:` (or VERBOSE, or TRACE)? */
function alreadyGated(stmt: Stmt, loop: ForStmt | WhileStmt): boolean {
  for (const a of ancestors(stmt as AnyNode)) {
    if (a === (loop as AnyNode)) break
    if (a.type !== 'If') continue
    let gated = false
    walk(a.test as AnyNode, (n) => {
      if (n.type === 'Name' && DEBUG_NAME.test(n.id)) gated = true
      if (n.type === 'Attribute' && DEBUG_NAME.test(n.attr)) gated = true
    })
    if (gated) return true
  }
  return false
}

export const gateDebugPrintRule = defineRule<GatePrintMatch>({
  id: 'gate-debug-print',
  title: 'Gate the print behind a DEBUG flag',
  message: 'A print inside a tight loop blocks on the serial port every pass',
  catalogue: 38,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-gate-debug-print',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<GatePrintMatch>[] {
    const out: RefactorMatch<GatePrintMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      // A bare `print(…)` used as a statement — `x = print(…)` is somebody
      // being clever, and not our business.
      if (node.type !== 'ExprStmt') return
      const call = unwrap(node.value)
      if (call.type !== 'Call' || dottedName(call.func) !== 'print') return

      // The loop it beats inside. `enclosingLoop` stops at a `def`, so a print
      // in a function that merely happens to be called from a loop is not it.
      const loop = enclosingLoop(node)
      if (!loop) return

      const forever = loopsForever(loop)
      // Tight = nothing in the body hands time back. A `while True:` counts
      // whatever it does: that is the control loop, and it is the one place
      // where every millisecond is somebody's wobble.
      if (!forever && containsSleep(loop.body)) return
      // Already behind a DEBUG flag — this rule's own advice, taken.
      if (alreadyGated(node, loop)) return

      out.push({
        ruleId: 'gate-debug-print',
        start: node.start,
        end: node.end,
        message: forever
          ? 'This `print` runs every pass of the control loop and blocks until the serial port drains — gate it behind a `DEBUG` flag'
          : 'This `print` runs every iteration of a tight loop and blocks until the serial port drains — gate it behind a `DEBUG` flag',
        data: { stmt: node, forever }
      })
    })

    return out
  },

  apply(): TextEdit[] | null {
    // Removing or rewriting somebody's debugging is not a refactoring: only the
    // author knows whether the answer is a flag, a counter or a log buffer.
    return null
  }
})
