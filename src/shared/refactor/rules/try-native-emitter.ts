/**
 * Rule 43 — **Try `@micropython.native`** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                         # after
 * def mix(buf):                    @micropython.native
 *     total = 0                    def mix(buf):
 *     for i in range(len(buf)):        total = 0
 *         total += buf[i]              for i in range(len(buf)):
 *     return total                         total += buf[i]
 *                                      return total
 * ```
 *
 * Why it matters: by default MicroPython compiles your function to bytecode and
 * walks it with an interpreter loop. `@micropython.native` compiles the same
 * function to actual machine code for your chip instead, keeping full Python
 * semantics — every object, every type, every exception behaves identically.
 * On integer-heavy loop code that is typically around a 2× win for a one-line
 * change, which is the best effort-to-payoff ratio in the whole emitter story.
 *
 * It is not free. The compiled code is bigger than the bytecode it replaces, so
 * it costs flash and it costs RAM when the module is imported. Decorating an
 * entire file is the classic beginner mistake: you get a fatter, slower-to-import
 * build and no measurable speed-up, because most functions are not the
 * bottleneck. So this only fires on functions that actually *look* hot — a tight
 * loop over integers, called from another loop, with no I/O inside — and the
 * advice always leads with **measure it**.
 *
 * Which is the point of the **Benchmark on device** button next to the diff.
 * Snakie is holding a REPL connection to your board while you edit, so it can
 * time the function before and after and show you the real number. When the
 * honest answer is "4% faster", you see 4% and skip it. That is the cure for
 * cargo-culting these decorators, and no other MicroPython tool can offer it.
 *
 * Gated on the firmware actually having the native emitter compiled in: it is a
 * `SyntaxError` where it is missing, so Snakie asks the board rather than
 * guessing, and offers nothing at all when no board is connected.
 */
import type { AnyNode, FunctionDef, Stmt } from '../ast'
import { walk } from '../ast'
import { dottedName } from '../expr'
import { indentAt, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface NativeMatch {
  fn: FunctionDef
  /** Why we think it is hot, for the message. */
  reason: string
}

/** Decorators that already pick an emitter — never stack a second one. */
const EMITTER_DECORATORS = new Set([
  'micropython.native',
  'micropython.viper',
  'micropython.asm_thumb',
  'micropython.asm_xtensa',
  'micropython.asm_rv32',
  'native',
  'viper'
])

/** Calls that mean the function waits on the world, so the CPU is not the limit. */
const IO_NAMES = new Set([
  'sleep',
  'sleep_ms',
  'sleep_us',
  'print',
  'input',
  'open',
  'read',
  'write',
  'readinto',
  'recv',
  'send',
  'connect',
  'scan'
])

/** Does this function already carry an emitter decorator? */
function hasEmitter(fn: FunctionDef): boolean {
  return fn.decorators.some((d) => {
    const name = dottedName(d.type === 'Call' ? d.func : d)
    return name != null && EMITTER_DECORATORS.has(name)
  })
}

/**
 * Things the native emitter cannot help with, or that make it pointless.
 * Generators keep their bytecode frame; a function that mostly waits on I/O is
 * not CPU-bound; `yield` and `await` both mean the frame is suspended.
 */
function disqualified(fn: FunctionDef): boolean {
  if (fn.isAsync) return true
  let bad = false
  walk(fn as AnyNode, (node) => {
    if (node === fn) return undefined
    // A nested def has its own compilation; do not judge the outer by it.
    if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') return false
    if (node.type === 'Yield') bad = true
    if (node.type === 'Await') bad = true
    if (node.type === 'Try') bad = true
    if (node.type === 'Call') {
      const name = dottedName(node.func)
      const last = name?.split('.').pop()
      if (last && IO_NAMES.has(last)) bad = true
    }
    return undefined
  })
  return bad
}

/** A loop whose body does arithmetic — the shape the native emitter speeds up. */
function hasArithmeticLoop(fn: FunctionDef): boolean {
  let found = false
  walk(fn as AnyNode, (node) => {
    if (node !== fn && (node.type === 'FunctionDef' || node.type === 'Lambda')) return false
    if (node.type !== 'For' && node.type !== 'While') return undefined
    let arithmetic = false
    for (const stmt of node.body as Stmt[]) {
      walk(stmt as AnyNode, (inner) => {
        if (inner.type === 'BinOp' || inner.type === 'AugAssign') arithmetic = true
      })
    }
    if (arithmetic) found = true
    return undefined
  })
  return found
}

/** Is `name` called from inside a loop anywhere in the file? */
function calledFromALoop(ctx: RefactorContext, name: string): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'For' && node.type !== 'While') return undefined
    walk(node as AnyNode, (inner) => {
      if (inner.type === 'Call' && dottedName(inner.func) === name) found = true
    })
    return undefined
  })
  return found
}

export const tryNativeEmitterRule = defineRule<NativeMatch>({
  id: 'try-native-emitter',
  title: 'Try @micropython.native on this function',
  message: 'This looks like a hot loop — the native emitter may roughly double it',
  catalogue: 43,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-try-native-emitter',
  // Costs flash and import RAM for a speed-up that must be measured, not assumed.
  safe: false,
  requires: (caps) => caps.native,

  detect(ctx: RefactorContext): RefactorMatch<NativeMatch>[] {
    const out: RefactorMatch<NativeMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      if (hasEmitter(node) || disqualified(node)) return
      if (!hasArithmeticLoop(node)) return
      const hot = calledFromALoop(ctx, node.name)
      // A loop-heavy function nobody calls in a loop is probably not the
      // bottleneck; say so rather than pretending we know.
      const reason = hot
        ? 'an integer loop, called from another loop'
        : 'an integer loop with no I/O in it'
      out.push({
        ruleId: 'try-native-emitter',
        start: node.defStart,
        end: node.nameStart + node.name.length,
        message: `\`${node.name}()\` is ${reason} — measure it with @micropython.native before you keep it`,
        data: { fn: node, reason }
      })
    })
    return out
  },

  apply(match: RefactorMatch<NativeMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { fn } = match.data
    // Insert above the `def`, below any decorators the function already has, so
    // an existing @staticmethod keeps its position.
    const anchor = lineStart(ctx.src, fn.defStart)
    const indent = indentAt(ctx.src, fn.defStart)
    const edits: TextEdit[] = [
      { start: anchor, end: anchor, newText: `${indent}@micropython.native${ctx.eol}` }
    ]
    // The decorator needs `micropython` in scope. It is a built-in module, but
    // the name still has to be imported; add it when it is not already there.
    if (!/^\s*(?:import micropython\b|from micropython import)/m.test(ctx.src)) {
      edits.push({ start: 0, end: 0, newText: `import micropython${ctx.eol}` })
    }
    return edits
  }
})
