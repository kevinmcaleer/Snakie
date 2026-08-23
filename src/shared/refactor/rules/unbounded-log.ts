/**
 * Rule 37 — **This list grows without limit** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * samples = []
 *
 * while True:
 *     samples.append(sensor.read_u16())   # nothing ever takes one back out
 *     time.sleep_ms(100)
 * ```
 *
 * Ten samples a second, a tuple each, and a Pico's 264 KB of RAM: the numbers
 * are fine for the first minute, fine for the tenth, and then the allocator
 * cannot find a free block and the program dies with
 * `MemoryError: memory allocation failed`. Nothing in the code is wrong in the
 * way a typo is wrong — it simply assumes a computer with a hard disc and an
 * operating system underneath it, and there isn't one. A microcontroller has
 * exactly the RAM it shipped with, and a list is the easiest way in the world to
 * spend all of it.
 *
 * The cruel part is the timing. Twenty minutes is longer than any bench test
 * anyone runs, so this passes every check on the desk and fails on the robot,
 * mid-run, with the wheels still turning — and the traceback lands wherever the
 * next allocation happened to be, which is usually nowhere near the `.append()`
 * that caused it.
 *
 * There are two good fixes and the code cannot tell us which one is wanted:
 *
 * - a **ring buffer** — a fixed-size list (or, better, a `bytearray` /
 *   `array.array`) with an index that wraps, so the memory is claimed once at
 *   import time and never grows again;
 * - **streaming** — open the log file, write each row as it arrives, keep one
 *   row in RAM at a time.
 *
 * Which is right depends on whether the data is wanted later or only recently,
 * and on whether there is a filesystem worth writing to. That is a design
 * decision, so the rule is `hintOnly`: it points at the list, explains what will
 * happen, and never rewrites anything.
 *
 * It goes out of its way not to cry wolf. It fires only on a list that starts
 * empty, is appended to inside a loop that never ends, and that **nothing in the
 * file ever shortens** — no `.pop()`, `.clear()` or `.remove()`, no `del`, no
 * `buf[:] = …` slice assignment, and no `len(buf)` sitting in a comparison,
 * which is what a hand-rolled cap looks like. A second binding of the name — a
 * `buf = buf[-100:]`, a periodic `buf = []`, a parameter or a local of the same
 * name somewhere else — also stands the hint down, because then we cannot prove
 * the list we are looking at is the list that grows. A bounded
 * `for i in range(10)` is not an unbounded loop and never fires: filling a
 * lookup table is not a leak.
 *
 * Three more shapes that look like the smell and are not:
 *
 * - **A loop with a `break` or a `return` in it.** `while True:` is only half
 *   the story; read-until-EOF stops when the data does, and the list it fills is
 *   bounded by however much arrived. The warning asserts "a loop that never
 *   ends", so a loop that plainly can end must not get it.
 * - **The list handed to a call.** `trim(rows, 64)` and `flush(pending)` are how
 *   a cap is spelled once it outgrows an `if`, and from the loop they look
 *   exactly like `render(rows)`. Only calls that are read-only by definition —
 *   `len`, `print` and friends — leave the hint standing.
 * - **`batch = []` *inside* the loop.** That is a fresh list every pass and the
 *   old one is collected; it is the streaming fix this hint asks for, so
 *   flagging it would be pointing at the cure.
 *
 * It also stays on plain names. `self.rows.append(…)` leaks exactly as badly,
 * but proving that `self` is the same object at the `[]` and at the `append`
 * needs more than this file's text can give us, so an attribute is left alone
 * rather than guessed at.
 */
import type { AnyNode, Assign, Call, Expr, ForStmt, Stmt, WhileStmt } from '../ast'
import { ancestors, unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import { scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** List methods that take elements back out again. */
const SHRINKING_METHODS = new Set(['pop', 'clear', 'remove'])

/**
 * Calls that provably cannot shorten a list handed to them.
 *
 * Anything else — `trim(buf, 32)`, `flush(rows)`, `Logger(buf)` — might pop,
 * clear or slice it out of sight, and a helper that does exactly that is how
 * most people cap a log in the first place. Only the builtins that are read-only
 * by definition stay on the loud side of the line, and `len(buf)` and
 * `print(buf)` are the two that show up in genuinely leaking code.
 */
const READ_ONLY_CALLS = new Set([
  'len',
  'print',
  'str',
  'repr',
  'sum',
  'min',
  'max',
  'sorted',
  'reversed',
  'any',
  'all',
  'enumerate',
  'zip',
  'map',
  'filter',
  'iter',
  'list',
  'tuple',
  'set',
  'dict',
  'bool',
  'bytes',
  'bytearray',
  'type',
  'id'
])

/** Infinite iterators we recognise, so `for x in itertools.count():` counts. */
const ENDLESS_ITERATORS = new Set(['itertools.count', 'uitertools.count'])

interface UnboundedMatch {
  /** The `name = []` that starts the list off. */
  assign: Assign
  /** The list's name. */
  name: string
  /** The first `name.append(…)` inside an unbounded loop, for the message. */
  append: Call
}

/** `name = []` with a single plain-name target, or null. */
function emptyListAssign(stmt: Stmt): { assign: Assign; name: string } | null {
  if (stmt.type !== 'Assign' || stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  if (target.type !== 'Name') return null
  const value = unwrap(stmt.value)
  // Only a literal empty list. `rows = [0] * 64` is already a fixed-size buffer,
  // which is the very thing this rule would be recommending.
  if (value.type !== 'List' || value.elts.length > 0) return null
  return { assign: stmt, name: target.id }
}

/** Is this `while` test a literal that never goes false? */
function isForeverWhile(loop: WhileStmt): boolean {
  const test = unwrap(loop.test)
  if (test.type === 'Constant' && test.kind === 'bool') return test.raw === 'True'
  // `while 1:` is the same loop with the older spelling.
  if (test.type === 'Constant' && test.kind === 'number') return /^0*1$/.test(test.raw)
  return false
}

/** Is this `for` iterating something that never runs out? */
function isEndlessFor(loop: ForStmt): boolean {
  const iter = unwrap(loop.iter)
  if (iter.type !== 'Call') return false
  const dotted = dottedName(iter.func)
  return dotted != null && ENDLESS_ITERATORS.has(dotted)
}

/**
 * Can this loop finish? True when its own body holds a `break` or a `return`.
 *
 * `while True:` is only half the story. `while True: row = read(); if row is
 * None: break; rows.append(row)` is the ordinary read-until-EOF shape, it stops
 * when the data does, and the list it fills is bounded by that data — so the
 * warning's whole claim ("a loop that never ends") would be false. A `break`
 * belonging to a *nested* loop, or a `return` inside a nested `def`, says
 * nothing about this loop and does not count.
 */
function loopCanEnd(loop: WhileStmt | ForStmt): boolean {
  let ends = false
  for (const stmt of loop.body) {
    walk(stmt, (n) => {
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      if (n.type === 'Return') {
        ends = true
        return false
      }
      if (n.type === 'Break') {
        // A `break` binds to the nearest enclosing loop; only ours ends us.
        for (const a of ancestors(n)) {
          if (a.type === 'For' || a.type === 'While') {
            if (a === loop) ends = true
            break
          }
          if (a.type === 'FunctionDef' || a.type === 'Lambda') break
        }
      }
      return undefined
    })
  }
  return ends
}

/** Does `node` sit inside a loop that never terminates on its own? */
function insideEndlessLoop(node: AnyNode): boolean {
  for (const a of ancestors(node)) {
    if (a.type === 'While' && isForeverWhile(a) && !loopCanEnd(a)) return true
    if (a.type === 'For' && isEndlessFor(a) && !loopCanEnd(a)) return true
  }
  return false
}

/** Is this expression a bare reference to `name`? */
function isNamed(expr: Expr | undefined, name: string): boolean {
  if (!expr) return false
  const e = unwrap(expr)
  return e.type === 'Name' && e.id === name
}

/**
 * Every `name.append(…)` in the file that runs inside an unbounded loop.
 *
 * `extend()` and `+=` grow a list too, but they are rarer inside a hot loop and
 * `append` is the shape a beginner writes; keeping the trigger narrow keeps the
 * hint believable.
 */
function unboundedAppends(ctx: RefactorContext, name: string): Call[] {
  const out: Call[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Call') return
    const func = unwrap(node.func)
    if (func.type !== 'Attribute' || func.attr !== 'append') return
    if (!isNamed(func.value, name)) return
    if (!insideEndlessLoop(node)) return
    out.push(node)
  })
  return out
}

/**
 * Does anything in the file put a ceiling on this list?
 *
 * Deliberately generous — every extra shape recognised here is one more file the
 * hint stays quiet on, and a hint that fires on already-correct code is worse
 * than one that misses a leak.
 */
function isBounded(ctx: RefactorContext, name: string): boolean {
  let bounded = false
  walk(ctx.module as AnyNode, (node) => {
    if (bounded) return false

    // `buf.pop()`, `buf.clear()`, `buf.remove(x)`.
    if (node.type === 'Call') {
      const func = unwrap(node.func)
      if (
        func.type === 'Attribute' &&
        SHRINKING_METHODS.has(func.attr) &&
        isNamed(func.value, name)
      ) {
        bounded = true
        return false
      }
      const callee = dottedName(node.func)

      // `len(buf)` inside a comparison — a hand-rolled cap.
      if (callee === 'len' && node.args.length === 1 && isNamed(node.args[0], name)) {
        if (ancestors(node).some((a) => a.type === 'Compare')) {
          bounded = true
          return false
        }
      }

      // The list handed to something we cannot see inside. `trim(buf, 32)` and
      // `flush(rows)` are how a cap is usually spelled once it outgrows an `if`,
      // and from here they are indistinguishable from `render(rows)`. Claiming
      // "nothing ever shortens this list" over a call that plainly might is the
      // one mistake this rule cannot afford.
      if (callee == null || !READ_ONLY_CALLS.has(callee)) {
        const handedOver =
          node.args.some((a) => isNamed(a, name)) ||
          node.keywords.some((k) => isNamed(k.value, name))
        if (handedOver) {
          bounded = true
          return false
        }
      }
      return undefined
    }

    // `buf[:] = buf[-64:]` — a slice assignment that replaces the contents.
    if (node.type === 'Assign') {
      for (const target of node.targets) {
        const t = unwrap(target)
        if (t.type === 'Subscript' && isNamed(t.value, name)) {
          bounded = true
          return false
        }
      }
      return undefined
    }

    // `del buf[0]` / `del buf[:32]`.
    if (node.type === 'Delete') {
      for (const target of node.targets) {
        const t = unwrap(target)
        if (t.type === 'Subscript' && isNamed(t.value, name)) {
          bounded = true
          return false
        }
      }
      return undefined
    }

    return undefined
  })
  return bounded
}

/**
 * How many times the file binds `name`.
 *
 * More than once and we cannot prove the list we found is the one that grows:
 * the second binding may be a `buf = buf[-100:]` that trims it, a periodic
 * `buf = []` that resets it, or a completely unrelated local in another
 * function. Any of those makes the hint a guess, so it stands down.
 *
 * This walks the whole module without scope shadowing on purpose — a same-named
 * local elsewhere is exactly the ambiguity we are counting.
 */
function bindingCount(ctx: RefactorContext, name: string): number {
  let count = 0

  const target = (expr: Expr | undefined): void => {
    if (!expr) return
    const e = unwrap(expr)
    switch (e.type) {
      case 'Name':
        if (e.id === name) count++
        return
      case 'Tuple':
      case 'List':
        for (const el of e.elts) target(el)
        return
      case 'Starred':
        target(e.value)
        return
      default:
        return
    }
  }

  walk(ctx.module as AnyNode, (node) => {
    switch (node.type) {
      case 'Assign':
        for (const t of node.targets) target(t)
        return
      case 'AugAssign':
        target(node.target)
        return
      case 'AnnAssign':
        if (node.value) target(node.target)
        return
      case 'For':
        target(node.target)
        return
      case 'With':
        for (const item of node.items) target(item.optionalVars)
        return
      case 'NamedExpr':
        if (node.target.id === name) count++
        return
      case 'Param':
        if (node.name === name) count++
        return
      case 'FunctionDef':
      case 'ClassDef':
        if (node.name === name) count++
        return
      case 'Import':
        for (const a of node.names) {
          if ((a.asname ?? a.name.split('.')[0]) === name) count++
        }
        return
      case 'ImportFrom':
        for (const a of node.names) {
          if ((a.asname ?? a.name) === name) count++
        }
        return
      case 'ExceptHandler':
        if (node.name === name) count++
        return
      case 'Delete':
        for (const t of node.targets) {
          const e = unwrap(t)
          if (e.type === 'Name' && e.id === name) count++
        }
        return
      default:
        return
    }
  })

  return count
}

/** Every `name = []` in the file, at module level or inside a `def`. */
function emptyLists(ctx: RefactorContext): { assign: Assign; name: string }[] {
  const out: { assign: Assign; name: string }[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Assign') return
    const found = emptyListAssign(node)
    if (!found) return
    // A class-body `rows = []` is a class attribute shared by every instance —
    // a different (and nastier) bug, and not this rule's.
    const scope = scopeOf(node)
    if (scope.type !== 'Module' && scope.type !== 'FunctionDef') return
    // A `batch = []` *inside* a loop is a fresh list every pass — the previous
    // one is unreachable and collected. That is the streaming shape this rule
    // recommends, so flagging it would be telling someone off for the fix.
    for (const a of ancestors(node)) {
      if (a.type === 'FunctionDef' || a.type === 'Lambda' || a.type === 'ClassDef') break
      if (a.type === 'For' || a.type === 'While') return
    }
    out.push(found)
  })
  return out
}

export const unboundedLogRule = defineRule<UnboundedMatch>({
  id: 'unbounded-log',
  title: 'This list grows without limit',
  message: 'Nothing ever shortens this list — on a 264 KB board it ends in MemoryError',
  catalogue: 37,
  category: 'micropython',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-unbounded-log',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<UnboundedMatch>[] {
    const out: RefactorMatch<UnboundedMatch>[] = []
    for (const { assign, name } of emptyLists(ctx)) {
      // One binding only, or the list we are looking at may not be the list that
      // grows (see `bindingCount`).
      if (bindingCount(ctx, name) !== 1) continue
      const appends = unboundedAppends(ctx, name)
      if (appends.length === 0) continue
      if (isBounded(ctx, name)) continue

      out.push({
        ruleId: 'unbounded-log',
        start: assign.start,
        end: assign.end,
        message: `\`${name}\` is appended to inside a loop that never ends and nothing ever shortens it — it will fill the heap and raise MemoryError`,
        data: { assign, name, append: appends[0] }
      })
    }
    return out
  },

  // Hint only. A ring buffer keeps the most recent readings; streaming to a file
  // keeps all of them but needs somewhere to write. Which one is right depends on
  // what the data is for, and only the author knows that.
  apply(): TextEdit[] | null {
    return null
  }
})

/** Exported for the tests that probe the shape detectors directly. */
export const _internals: {
  emptyListAssign: typeof emptyListAssign
  isBounded: typeof isBounded
} = { emptyListAssign, isBounded }
