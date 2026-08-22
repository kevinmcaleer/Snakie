/**
 * Rule 87 — **Batch the writes** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                              # after (by hand)
 * log = open("wind.csv", "a")           log = open("wind.csv", "a")
 * for n in range(samples):              rows = []
 *     log.write("%d\n" % read())        for n in range(samples):
 *     log.flush()                           rows.append("%d\n" % read())
 *     sleep_ms(100)                         if len(rows) == 200:
 *                                               log.write("".join(rows))
 *                                               rows.clear()
 * ```
 *
 * Why it matters: on a microcontroller "the filesystem" is the flash the
 * firmware itself is stored in, and flash cannot be changed a byte at a time. A
 * write turns into *erase a whole block, rewrite a whole block* — tens of
 * milliseconds during which the rest of your loop is simply not running. A
 * datalogger that writes one line per sample spends most of its life waiting for
 * flash, and a loop that was supposed to sample at 100 Hz quietly drops to 20.
 *
 * The second cost is permanent. Flash cells survive a finite number of erase
 * cycles — on the order of 100,000 — and every per-sample write ages the same
 * block again. A logger left running for a weekend can genuinely wear a board
 * out, and the failure looks like random corruption long before it looks like
 * wear.
 *
 * `flush()` inside the loop is the sharper version of the same mistake: it
 * defeats the buffering the runtime was already doing for you and forces the
 * erase-rewrite cycle on *every single iteration*.
 *
 * The fix is to collect a few hundred samples in a list or a `bytearray` and
 * write them in one call. That is a real change in behaviour — pull the power
 * mid-batch and the unwritten samples are gone — so it is a trade the author has
 * to make deliberately. Hence `hintOnly`: the rule points at the write, explains
 * what it costs, and changes nothing.
 */
import type { AnyNode, Call, Expr, ForStmt, WhileStmt } from '../ast'
import { ancestors, enclosingLoop, unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import { bodyOf, isScope, nameUses } from '../scope'
import type { Scope } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The calls that reach the filesystem, and how hard they hit it. */
const FLUSHING_METHODS = new Set(['write', 'flush'])

/** Spellings of the builtin that hands back a file object. */
const OPEN_CALLS = new Set(['open', 'io.open', 'uio.open'])

interface BatchWriteMatch {
  call: Call
  /** The name the file object is bound to. */
  handle: string
  method: 'write' | 'flush'
  loopKind: 'for' | 'while'
}

/** Does this expression call `open(…)`? */
function isOpenCall(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Call') return false
  const dotted = dottedName(e.func)
  return dotted != null && OPEN_CALLS.has(dotted)
}

/** What one scope's own code binds, and which of those bindings are open files. */
interface ScopeFiles {
  /** Every name this scope binds, its parameters included. */
  bound: Set<string>
  /** Names whose *every* binding here is an `open(…)` result. */
  handles: Set<string>
}

/** Walk one scope's own statements, without descending into nested scopes. */
function walkScopeBody(scope: Scope, fn: (node: AnyNode) => void): void {
  for (const stmt of bodyOf(scope)) {
    walk(stmt, (n) => {
      if (isScope(n)) return false
      fn(n)
      return undefined
    })
  }
}

/**
 * What one scope binds to an `open(…)` result, from either spelling:
 * `log = open(path)` and `with open(path) as log:`.
 *
 * Restricting the rule to these names is what keeps it off `uart.write(…)`,
 * `sock.write(…)` and `display.write(…)`, none of which touch flash at all —
 * so the bookkeeping has to be exact. A name only counts when *every* binding
 * of it in this scope is an `open()`: `log = open(…)` and later `log = UART(…)`
 * is not a file by the time the loop runs. Parameters are bound by the caller,
 * so they are listed as bound and never as handles.
 */
function scopeFiles(scope: Scope): ScopeFiles {
  const writes = new Map<string, number>()
  for (const u of nameUses(bodyOf(scope))) {
    if (u.kind === 'write') writes.set(u.name, (writes.get(u.name) ?? 0) + 1)
  }
  const bound = new Set(writes.keys())
  if (scope.type === 'FunctionDef' || scope.type === 'Lambda') {
    for (const p of scope.params) bound.add(p.name)
  }

  const opens = new Map<string, number>()
  const note = (name: string): void => {
    opens.set(name, (opens.get(name) ?? 0) + 1)
  }
  walkScopeBody(scope, (node) => {
    if (node.type === 'Assign' && node.targets.length === 1) {
      const target = unwrap(node.targets[0])
      if (target.type === 'Name' && isOpenCall(node.value)) note(target.id)
      return
    }
    if (node.type === 'WithItem' && node.optionalVars && isOpenCall(node.context)) {
      const target = unwrap(node.optionalVars)
      if (target.type === 'Name') note(target.id)
    }
  })

  const handles = new Set<string>()
  for (const [name, count] of opens) {
    if ((writes.get(name) ?? 0) === count) handles.add(name)
  }
  return { bound, handles }
}

/**
 * Is `name`, as seen from `node`, one of this file's open files?
 *
 * Resolved through the scope chain rather than against one file-wide set of
 * names: `f = open(…)` in one function says nothing about the `f` in the next
 * one, and `f = sock.makefile()` there is not flash. The nearest scope that
 * binds the name decides, exactly as the interpreter would.
 */
function resolvesToFile(node: AnyNode, name: string, cache: Map<Scope, ScopeFiles>): boolean {
  for (const a of ancestors(node)) {
    if (!isScope(a)) continue
    // A class body's names are attributes; a method never sees them, so a class
    // is not part of the lookup chain.
    if (a.type === 'ClassDef') continue
    let info = cache.get(a)
    if (!info) {
      info = scopeFiles(a)
      cache.set(a, info)
    }
    if (!info.bound.has(name)) continue
    return info.handles.has(name)
  }
  return false
}

/**
 * Is this argument a whole batch rather than one sample?
 *
 * `log.write("".join(rows))` and `log.write(bytes(buffer))` are what this rule
 * *asks* for — the block write at the bottom of a fill-then-flush loop. Firing
 * on those would mean nagging about the fix, so they are recognised and left
 * alone even though they do sit inside the loop.
 */
function isAggregatedArgument(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Call') return false
  const func = unwrap(e.func)
  if (func.type === 'Attribute' && func.attr === 'join') return true
  const dotted = dottedName(func)
  return dotted === 'bytes' || dotted === 'bytearray'
}

/** `<name>.write` / `<name>.flush` on a plain name, or null. */
function fileMethodCall(call: Call): { handle: string; method: 'write' | 'flush' } | null {
  const func = unwrap(call.func)
  if (func.type !== 'Attribute' || !FLUSHING_METHODS.has(func.attr)) return null
  const base = unwrap(func.value)
  if (base.type !== 'Name') return null
  if (func.attr === 'write') {
    // `write()` with nothing to write is not what we are looking at.
    if (call.args.length !== 1) return null
    if (isAggregatedArgument(call.args[0])) return null
  }
  return { handle: base.id, method: func.attr as 'write' | 'flush' }
}

/** How to describe the loop this call sits in. */
function loopKindOf(loop: ForStmt | WhileStmt): 'for' | 'while' {
  return loop.type === 'For' ? 'for' : 'while'
}

export const batchFileWritesRule = defineRule<BatchWriteMatch>({
  id: 'batch-file-writes',
  title: 'Batch the writes',
  message: 'Writing to a file inside the loop commits to flash on every iteration',
  catalogue: 87,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-batch-file-writes',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<BatchWriteMatch>[] {
    // One ScopeFiles per scope, built the first time a candidate call needs it.
    const cache = new Map<Scope, ScopeFiles>()

    const out: RefactorMatch<BatchWriteMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Call') return
      const hit = fileMethodCall(node)
      if (!hit) return
      if (!resolvesToFile(node, hit.handle, cache)) return
      // Stops at a function boundary: a write inside a helper `def` that a loop
      // calls is not something this file can count the iterations of.
      const loop = enclosingLoop(node)
      if (!loop) return

      const kind = loopKindOf(loop)
      const message =
        hit.method === 'flush'
          ? `\`${hit.handle}.flush()\` forces a flash erase-and-rewrite on every pass of this \`${kind}\` — buffer a few hundred samples and write them in one go`
          : `\`${hit.handle}.write()\` commits to flash on every pass of this \`${kind}\` — that is slow, and it wears the flash out`

      out.push({
        ruleId: 'batch-file-writes',
        start: node.start,
        end: node.end,
        message,
        data: { call: node, handle: hit.handle, method: hit.method, loopKind: kind }
      })
    })

    return out
  },

  // Hint only. Buffering changes what survives a power cut mid-batch, and how
  // many samples that is — the author's trade to make, not ours.
  apply(): TextEdit[] | null {
    return null
  }
})
