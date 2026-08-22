/**
 * Rule 33 — **Make this loop non-blocking** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                        # after
 * while True:                     last_tick = time.ticks_ms()
 *     read_line()                 while True:
 *     drive_motors()                  if time.ticks_diff(time.ticks_ms(), last_tick) >= 100:
 *     time.sleep(0.1)                     last_tick = time.ticks_ms()
 *                                         read_line()
 *                                         drive_motors()
 * ```
 *
 * `time.sleep()` does not pause *this loop*, it pauses **the whole board**. For
 * those 100 ms nothing else can happen: the bumper switch is not read, the UART
 * command sits unanswered, the second motor never gets its ramp step. That is
 * why a first robot can follow a line beautifully and still drive straight into
 * a wall — the wall was detected during the sleep, and by the time the code
 * looked, it was too late.
 *
 * Checking the clock instead of blocking on it is the pattern every non-trivial
 * MicroPython program ends up using. The loop keeps spinning; the timed work
 * runs only when its period is up. The real payoff arrives on the *next* thing
 * you add: a second sensor on a 20 ms period, a heartbeat on 500 ms, a command
 * parser that must answer straight away. Each one is another `if` in the same
 * loop, and they interleave instead of taking turns to freeze each other. That
 * is cooperative multitasking by hand, and it is what `asyncio` (rule 39) does
 * for you once the program grows big enough to want it.
 *
 * **Why the loop must already have at least two other statements.** Converting
 * a loop that does nothing *but* sleep makes it strictly worse. `while True:
 * time.sleep(1)` costs almost no CPU — the interpreter is parked. Turn it into a
 * tick check and it spins flat out, burning current and starving anything else
 * on the board, for no benefit at all: there is no other work in the loop to
 * interleave with. That is exactly the busy-wait rule 84 warns about, so this
 * rule refuses to create one. Two other statements is the floor at which the
 * loop plausibly has something worth freeing up.
 *
 * The same honesty applies to the rewrite itself: the loop it produces is still
 * a spin loop until you put more work in it. It is the enabling step, not the
 * finished article — hence `severity: 'hint'` and `safe: false`, so
 * "Tidy this file" never does this behind your back. One further difference
 * worth knowing: the original ran its body first and slept afterwards, whereas
 * the rewrite waits one period before the first pass. For a periodic task that
 * is immaterial; if it is not, seed the timestamp with
 * `ticks_add(ticks_ms(), -PERIOD)` instead.
 *
 * What it declines, and why:
 *
 * - **`break`, `continue`, `return` or `yield` in the body.** The body moves
 *   inside a new `if`, and a `continue` that used to skip the sleep would now
 *   skip nothing. Changing what a jump means is exactly the kind of silent
 *   behaviour change §2.6 forbids.
 * - **A loop inside an `async def`.** Rule 39 owns that case, and
 *   `await asyncio.sleep()` is the better answer there.
 * - **`sleep_us`.** A sub-millisecond period is not a fit for a tick check —
 *   `ticks_ms()` cannot see it, and `ticks_us()` polling is a busy-wait by
 *   definition.
 * - **A delay that is not a whole number of milliseconds**, or is not a literal
 *   at all. We would be inventing a period.
 * - **A comment touching the sleep line.** That line is deleted; a comment on
 *   it, on the line above it or on the line below it is a comment about the
 *   delay, and the rewrite would either bin it or leave it explaining nothing.
 * - **A name that means something else in this file.** `sleep`, `ticks_ms`,
 *   `ticks_diff` and the module prefix must be bound to the real `time`
 *   functions and nothing else — in *every* scope, parameters and function
 *   locals included. See {@link bindingsOf}.
 * - **A module prefix we cannot resolve to the real `ticks_ms`/`ticks_diff`.**
 *   `apply` returns null rather than calling a function it cannot prove exists.
 */
import type { AnyNode, Call, Expr, ImportFrom, Stmt, WhileStmt } from '../ast'
import { enclosingFunction, unwrap, walk } from '../ast'
import { dottedName, literalNumber } from '../expr'
import type { Scope } from '../scope'
import { hasEscapingControlFlow, isNameFree, scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { indent, indentAt, lineEnd, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Modules whose blocking sleeps we recognise, under either MicroPython spelling. */
const TIME_MODULES = ['time', 'utime']

/** The blocking sleeps this rule knows how to read a period out of. */
const SLEEP_FUNCS = new Set(['sleep', 'sleep_ms', 'sleep_us'])

/** The wrap-safe clock the rewrite polls. */
const TICKS_MS = 'ticks_ms'
const TICKS_DIFF = 'ticks_diff'

/** The base name of the timestamp variable the rewrite introduces. */
const TIMESTAMP_BASE = 'last_tick'

/** A day. Beyond this a poll loop is the wrong shape for the job entirely. */
const MAX_MS = 86_400_000

/** A blocking sleep call, resolved to the `time` function it really is. */
interface SleepCall {
  call: Call
  /** The canonical name: `sleep`, `sleep_ms` or `sleep_us`. */
  func: string
  /** The module name as written (`time`, `utime`, an alias), or null when bare. */
  prefix: string | null
  /** The `from time import …` that bound a bare name, or null for the dotted form. */
  home: ImportFrom | null
}

interface NonBlockingMatch {
  loop: WhileStmt
  /** The `time.sleep(…)` statement that ends the body. */
  sleepStmt: Stmt
  sleep: SleepCall
  /** The period the sleep is worth, in whole milliseconds. */
  ms: number
}

/** How this file can reach the tick clock, and whether an import must grow. */
interface TickAccess {
  ticksMs: string
  ticksDiff: string
  /** The `from time import …` to extend, or null when nothing needs adding. */
  extend: ImportFrom | null
  /** The names to append to that import, in order. */
  add: string[]
}

/**
 * How many times this file binds `name`, in **any** scope.
 *
 * `scope.ts`'s `nameUses` deliberately hides a nested function's own locals and
 * never reports parameters at all — the right answer for "is this used later?",
 * and precisely the wrong one here. A `def run(sleep)`, a `for sleep in …`, a
 * local `ticks_ms = 0`: each is a name this rule would otherwise read as the
 * `time` function it is emphatically not, and the rewrite would delete a call to
 * somebody else's code or emit `ticks_ms()` against an integer. So this counts
 * every binding form the language has, everywhere in the file, and a name that
 * is bound anywhere unexpected disqualifies the rewrite.
 */
function bindingsOf(ctx: RefactorContext, name: string): number {
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
        target(node.target)
        return
      case 'For':
        target(node.target)
        return
      case 'With':
        for (const item of node.items) target(item.optionalVars)
        return
      case 'Comprehension':
        // Its own scope in Python 3, so it cannot really collide — but a rule
        // that declines here only loses a rewrite, and counting is one less
        // thing to be wrong about.
        target(node.target)
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
      default:
        return
    }
  })

  return count
}

/** Bindings of `name` created by `import time` / `import utime as name`. */
function timeModuleBindings(ctx: RefactorContext, name: string): number {
  let count = 0
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return
    for (const alias of node.names) {
      if (
        (alias.asname ?? alias.name.split('.')[0]) === name &&
        TIME_MODULES.includes(alias.name)
      ) {
        count++
      }
    }
  })
  return count
}

/** Bindings of `name` created by a `from time import …` in this file. */
function timeImportBindings(ctx: RefactorContext, name: string): number {
  let count = 0
  for (const imp of timeImports(ctx)) {
    for (const alias of imp.names) {
      if ((alias.asname ?? alias.name) === name) count++
    }
  }
  return count
}

/**
 * Does `name` reach the real `time` module, and nothing else?
 *
 * The plain spellings stay acceptable without an import in sight — a file that
 * says `time.sleep()` means the time module even when the import lives in a
 * package `__init__`. What is *not* acceptable is the file binding the name to
 * something of its own: `def run(time)` or `time = "later"` both leave
 * `time.ticks_ms()` calling into whatever that is instead.
 */
function isTimeModuleAlias(ctx: RefactorContext, name: string): boolean {
  const fromImport = timeModuleBindings(ctx, name)
  // Every binding of the name has to be one of those imports, or somebody else
  // owns it for at least part of the file and we cannot tell which is live here.
  if (bindingsOf(ctx, name) !== fromImport) return false
  return fromImport > 0 || TIME_MODULES.includes(name)
}

/** Every `from time import …` / `from utime import …` in the file, in order. */
function timeImports(ctx: RefactorContext): ImportFrom[] {
  const out: ImportFrom[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return
    if (node.level !== 0 || !node.module || !TIME_MODULES.includes(node.module)) return
    out.push(node)
  })
  return out
}

/** Is there a `from <something-else> import *` that could be binding names? */
function hasForeignStarImport(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom' || !node.isStar) return
    if (node.level !== 0 || !node.module || !TIME_MODULES.includes(node.module)) found = true
  })
  return found
}

/**
 * The `from time import sleep` that bound a bare `sleep(…)`, or null.
 *
 * Null covers every case where the bare name might be something else: an
 * `asyncio` import, a hand-written `def sleep(seconds)`, a wildcard import from
 * another module, two imports fighting over the name, or — the one that bites
 * hardest — a **function-local** `sleep`. `def run(sleep)` and
 * `sleep = make_sleeper()` are ordinary code, and the call the rule would delete
 * there is not a delay at all. Rewriting a coroutine's `sleep` into a tick check
 * would be a disaster, so this stays strict.
 */
function bareSleep(ctx: RefactorContext, bound: string): { func: string; home: ImportFrom } | null {
  if (hasForeignStarImport(ctx)) return null

  // Exactly one binding of the name in the whole file, in any scope, or we
  // cannot tell which one is live at the call we are looking at.
  if (bindingsOf(ctx, bound) !== 1) return null

  for (const imp of timeImports(ctx)) {
    for (const alias of imp.names) {
      if ((alias.asname ?? alias.name) === bound && SLEEP_FUNCS.has(alias.name)) {
        return { func: alias.name, home: imp }
      }
    }
  }
  return null
}

/** Resolve a call to a blocking `time` sleep, or null. */
function resolveSleep(ctx: RefactorContext, call: Call): SleepCall | null {
  const dotted = dottedName(call.func)
  if (!dotted) return null
  const parts = dotted.split('.')
  if (parts.length === 2 && SLEEP_FUNCS.has(parts[1]) && isTimeModuleAlias(ctx, parts[0])) {
    return { call, func: parts[1], prefix: parts[0], home: null }
  }
  if (parts.length === 1) {
    const bare = bareSleep(ctx, parts[0])
    if (bare) return { call, func: bare.func, prefix: null, home: bare.home }
  }
  return null
}

/** A single plain positional argument — no `*args`, no keywords. */
function lonePositionalArg(call: Call): Expr | null {
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const only = call.args[0]
  return only.type === 'Starred' ? null : only
}

/**
 * The whole milliseconds a sleep argument is worth, or null.
 *
 * `sleep()` takes seconds, so `0.1` is 100 ms — but `0.0005` is 500 µs, which a
 * millisecond tick check simply cannot see, and rounding it to 1 ms would change
 * the timing by a factor of two. Those decline.
 */
function periodMs(func: string, arg: Expr): number | null {
  const value = literalNumber(arg)
  if (value == null) return null
  if (func === 'sleep_ms') {
    if (!Number.isInteger(value)) return null
    return value >= 1 && value <= MAX_MS ? value : null
  }
  if (func !== 'sleep') return null
  const ms = value * 1000
  const rounded = Math.round(ms)
  // Binary floats never land exactly on 100 for 0.1, so compare with a tolerance
  // far tighter than the sub-millisecond values we mean to exclude.
  if (Math.abs(ms - rounded) > 1e-6) return null
  return rounded >= 1 && rounded <= MAX_MS ? rounded : null
}

/** Nothing but whitespace between the start of the node's line and the node. */
function startsItsLine(src: string, node: { start: number }): boolean {
  return /^[ \t]*$/.test(src.slice(lineStart(src, node.start), node.start))
}

/** The rest of the node's line is blank — no `;`, no trailing comment. */
function tailIsBlank(src: string, node: { end: number }): boolean {
  return /^[ \t]*\r?\n?$/.test(src.slice(node.end, lineEnd(src, node.end)))
}

/**
 * Is the line at `from` a whole-line comment indented at least as deep as
 * `depth`? A comment dedented back to the margin belongs to whatever follows the
 * loop, not to the sleep.
 */
function isCommentLineAtDepth(src: string, from: number, to: number, depth: number): boolean {
  const line = src.slice(from, to)
  const ws = /^[ \t]*/.exec(line)![0]
  return ws.length >= depth && line.charAt(ws.length) === '#'
}

/**
 * Is a comment parked immediately above or below the sleep line?
 *
 * A comment touching the sleep is a comment about the delay: `# 10 Hz is plenty`
 * above it, `# and round we go` under it. The line itself is deleted, so one of
 * those is left explaining a wait that no longer exists — and the rule already
 * declines when the comment shares the sleep's line for exactly that reason.
 * Losing the rewrite on a commented sleep is much the cheaper mistake.
 */
function commentTouchesSleep(src: string, sleepStmt: Stmt): boolean {
  const from = lineStart(src, sleepStmt.start)
  const depth = sleepStmt.start - from
  if (from > 0 && isCommentLineAtDepth(src, lineStart(src, from - 1), from, depth)) return true
  const below = lineEnd(src, sleepStmt.end)
  return below < src.length && isCommentLineAtDepth(src, below, lineEnd(src, below), depth)
}

/**
 * True when any statement holds a multi-line string literal. Those lines are
 * *data*, so indenting the block would silently rewrite the string's contents.
 */
function hasMultilineString(nodes: readonly AnyNode[]): boolean {
  let found = false
  for (const n of nodes) {
    walk(n, (x) => {
      if (x.type === 'Constant' && x.kind === 'string' && /[\r\n]/.test(x.raw)) found = true
    })
  }
  return found
}

/** Is this `while` test the literal `True`? */
function isForever(loop: WhileStmt): boolean {
  const test = unwrap(loop.test)
  return test.type === 'Constant' && test.kind === 'bool' && test.raw === 'True'
}

/**
 * Does another endless loop sit between the top of the body and the sleep?
 *
 * If it does, the sleep is dead code — control never reaches it — so its delay
 * says nothing about how often the body runs, and turning it into a period would
 * invent a wait that was never there.
 */
function sleepIsUnreachable(body: readonly Stmt[]): boolean {
  let found = false
  for (const stmt of body.slice(0, -1)) {
    walk(stmt, (n) => {
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      if (n.type === 'While' && isForever(n)) found = true
      return undefined
    })
  }
  return found
}

/**
 * Work out how this file can call `ticks_ms` and `ticks_diff`.
 *
 * For a dotted sleep the answer is always the module the sleep came from. For a
 * bare one we need bare names, which means one of: already imported (possibly
 * under an `as` name), brought in by a star import, or added to the very import
 * the sleep came from. A file that already means something else by
 * `ticks_ms`/`ticks_diff` returns null, so `apply` declines rather than calling
 * somebody's helper of the same name.
 */
function tickAccess(ctx: RefactorContext, sleep: SleepCall): TickAccess | null {
  if (sleep.prefix) {
    return {
      ticksMs: `${sleep.prefix}.${TICKS_MS}`,
      ticksDiff: `${sleep.prefix}.${TICKS_DIFF}`,
      extend: null,
      add: []
    }
  }

  let ticksMs: string | null = null
  let ticksDiff: string | null = null
  for (const imp of timeImports(ctx)) {
    if (imp.isStar) {
      // `from time import *` brings both in with everything else.
      ticksMs = ticksMs ?? TICKS_MS
      ticksDiff = ticksDiff ?? TICKS_DIFF
      continue
    }
    for (const alias of imp.names) {
      if (alias.name === TICKS_MS) ticksMs = ticksMs ?? alias.asname ?? TICKS_MS
      if (alias.name === TICKS_DIFF) ticksDiff = ticksDiff ?? alias.asname ?? TICKS_DIFF
    }
  }

  const add: string[] = []
  if (!ticksMs) {
    ticksMs = TICKS_MS
    add.push(TICKS_MS)
  }
  if (!ticksDiff) {
    ticksDiff = TICKS_DIFF
    add.push(TICKS_DIFF)
  }

  // Both names are about to be written bare into the guard, so each must mean
  // the `time` function everywhere in the file and nowhere anything else. A
  // `def run(ticks_ms)` or a local `ticks_ms = 0` in some other function is
  // invisible to a module-level scan and would turn `ticks_ms()` into a call on
  // an integer, so compare against the bindings the time imports account for.
  for (const bound of [ticksMs, ticksDiff]) {
    if (bindingsOf(ctx, bound) !== timeImportBindings(ctx, bound)) return null
  }

  if (add.length === 0) return { ticksMs, ticksDiff, extend: null, add }
  // Extend the import the sleep itself came from, so the names stay together.
  return sleep.home ? { ticksMs, ticksDiff, extend: sleep.home, add } : null
}

/** Every name any `global` or `nonlocal` statement in the file mentions. */
function declaredNames(ctx: RefactorContext): Set<string> {
  const out = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'Global' || node.type === 'Nonlocal') {
      for (const n of node.names) out.add(n)
    }
  })
  return out
}

/**
 * A timestamp name that is free in `scope`, or null if we could not find one.
 *
 * `freshName` alone is not enough here, for two reasons the golden suite would
 * never have caught. `isNameFree` reads one scope's *body*, so a parameter the
 * body never mentions looks free — and taking it would destroy the argument.
 * And a `global last_tick` elsewhere in the file hides its own assignment inside
 * that function's locals, so a module-level loop happily claims a name another
 * function is already writing through: the two would then share one variable and
 * stamp on each other every pass. Both are collisions the rewrite must not make.
 */
function timestampName(ctx: RefactorContext, scope: Scope): string | null {
  const declared = declaredNames(ctx)
  const params =
    scope.type === 'FunctionDef' || scope.type === 'Lambda'
      ? scope.params.map((p) => p.name)
      : []
  const free = (name: string): boolean =>
    !declared.has(name) && !params.includes(name) && isNameFree(scope, name)

  if (free(TIMESTAMP_BASE)) return TIMESTAMP_BASE
  for (let i = 2; i < 100; i++) {
    const candidate = `${TIMESTAMP_BASE}${i}`
    if (free(candidate)) return candidate
  }
  return null
}

/**
 * An insertion anchored on one real character.
 *
 * Two loops in the same file both want `ticks_ms` on the same import line. A
 * zero-width insert cannot overlap another zero-width insert at the same offset,
 * so a batch would happily add the names twice. Widening the edit by the
 * neighbouring character (and putting it back) makes the engine see the clash,
 * keep the first and re-offer the rest on the next pass — by which time the
 * import already has the names and no second edit is produced.
 */
function anchoredInsert(src: string, at: number, text: string): TextEdit {
  return { start: at - 1, end: at, newText: src[at - 1] + text }
}

export const nonBlockingLoopRule = defineRule<NonBlockingMatch>({
  id: 'non-blocking-loop',
  title: 'Make this loop non-blocking',
  message: 'This loop sleeps, and the whole board sleeps with it — poll the clock instead',
  catalogue: 33,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-non-blocking-loop',
  // Trades a parked CPU for a spinning one until the loop gains more work, so
  // "Tidy this file" must never apply it unasked.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<NonBlockingMatch>[] {
    const out: RefactorMatch<NonBlockingMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'While' || !isForever(node)) return
      // `while True: … else:` is exotic enough that the rewrite's shape is not
      // obviously right, and the `else` of an infinite loop never runs anyway.
      if (node.orelse.length > 0) return

      // The floor that keeps this from manufacturing a busy-wait: the sleep plus
      // at least two statements that could be doing something while it waits.
      if (node.body.length < 3) return

      const sleepStmt = node.body[node.body.length - 1]
      if (sleepStmt.type !== 'ExprStmt') return
      const call = unwrap(sleepStmt.value)
      if (call.type !== 'Call') return

      const sleep = resolveSleep(ctx, call)
      if (!sleep) return
      // `sleep_us` is below what `ticks_ms()` can resolve, and polling `ticks_us`
      // is a busy-wait by definition. Not this rule's pattern.
      if (sleep.func === 'sleep_us') return
      const arg = lonePositionalArg(call)
      if (!arg) return
      const ms = periodMs(sleep.func, arg)
      if (ms == null) return

      // Rule 39 owns the coroutine case, where `await asyncio.sleep()` is both
      // simpler and better than a hand-rolled tick check.
      const fn = enclosingFunction(node)
      if (fn && fn.type === 'FunctionDef' && fn.isAsync) return

      // The body moves inside a new `if`, so any jump out of it — or a `continue`
      // that used to skip the sleep — would quietly change meaning.
      if (hasEscapingControlFlow([...node.body])) return

      // A nested `while True:` earlier in the body means the sleep never runs,
      // so there is no real period here to preserve.
      if (sleepIsUnreachable(node.body)) return

      // Every statement must own its line, or the line-based rewrite below would
      // slice a `a(); b()` in half.
      if (!startsItsLine(ctx.src, node)) return
      if (node.body.some((s) => !startsItsLine(ctx.src, s))) return
      if (ctx.lines.positionAt(node.start).line === ctx.lines.positionAt(node.body[0].start).line) {
        return
      }
      // The sleep's whole line is deleted, so it must hold nothing else — a
      // trailing comment explaining the delay would vanish with it, and one
      // parked on the line above or below would be left explaining nothing.
      if (!tailIsBlank(ctx.src, sleepStmt)) return
      if (commentTouchesSleep(ctx.src, sleepStmt)) return
      // Indenting a block that contains a triple-quoted string would rewrite the
      // string's own contents.
      if (hasMultilineString(node.body.slice(0, -1))) return

      out.push({
        ruleId: 'non-blocking-loop',
        start: node.start,
        end: sleepStmt.end,
        message: `This loop blocks for ${ms} ms every pass — check \`${TICKS_MS}()\` instead and the rest of the board keeps running`,
        data: { loop: node, sleepStmt, sleep, ms }
      })
    })
    return out
  },

  apply(match: RefactorMatch<NonBlockingMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, sleepStmt, sleep, ms } = match.data

    // No names we can prove reach the real tick clock. The hint still stands;
    // only the automatic rewrite stands down.
    const access = tickAccess(ctx, sleep)
    if (!access) return null

    const unit = ctx.indentUnit
    const loopIndent = indentAt(ctx.src, loop.start)
    const bodyIndent = indentAt(ctx.src, loop.body[0].start)

    const insertAt = lineStart(ctx.src, loop.start)
    // Everything the loop keeps: the body lines up to but not including the
    // sleep, taken verbatim so comments and blank lines travel with them. The
    // region starts at the first statement, so a comment parked between the
    // `while` header and that statement stays where the author put it.
    const bodyStart = lineStart(ctx.src, loop.body[0].start)
    const bodyEnd = lineStart(ctx.src, sleepStmt.start)
    const sleepEnd = lineEnd(ctx.src, sleepStmt.end)
    if (insertAt >= bodyStart || bodyStart >= bodyEnd || bodyEnd >= sleepEnd) return null

    const name = timestampName(ctx, scopeOf(loop))
    if (!name) return null
    const kept = ctx.src.slice(bodyStart, bodyEnd)

    const guard =
      `${bodyIndent}if ${access.ticksDiff}(${access.ticksMs}(), ${name}) >= ${ms}:${ctx.eol}` +
      `${bodyIndent}${unit}${name} = ${access.ticksMs}()${ctx.eol}`

    const edits: TextEdit[] = [
      // Seed the timestamp on the line above the loop, at the loop's own indent.
      {
        start: insertAt,
        end: insertAt,
        newText: `${loopIndent}${name} = ${access.ticksMs}()${ctx.eol}`
      },
      { start: bodyStart, end: bodyEnd, newText: guard + indent(kept, unit) },
      // The sleep line goes entirely; the clock check has replaced it.
      { start: bodyEnd, end: sleepEnd, newText: '' }
    ]

    if (access.extend) {
      const last = access.extend.names[access.extend.names.length - 1]
      if (!last || last.end <= 0 || last.end > ctx.src.length) return null
      const insert = anchoredInsert(ctx.src, last.end, access.add.map((n) => `, ${n}`).join(''))
      // The import has to sit strictly above the loop, or the edits would collide.
      if (insert.end > insertAt) return null
      edits.push(insert)
    }

    return edits
  }
})
