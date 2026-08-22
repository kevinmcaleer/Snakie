/**
 * Rule 8 — **Extract into a function** (epic #634 §3.2, phase R2).
 *
 * ```python
 * # before — select the four lines that work out the average
 * def report(readings, radio):
 *     radio.send(b"start")
 *     total = 0
 *     for reading in readings:
 *         total += reading
 *     average = total / len(readings)
 *     radio.send(b"%d" % average)
 *
 * # after
 * def compute_average(readings):
 *     total = 0
 *     for reading in readings:
 *         total += reading
 *     average = total / len(readings)
 *     return average
 *
 *
 * def report(readings, radio):
 *     radio.send(b"start")
 *     average = compute_average(readings)
 *     radio.send(b"%d" % average)
 * ```
 *
 * Why it matters: this is the refactoring the rest of the catalogue keeps
 * pointing at. "Too deeply nested" (rule 5), "this function is too long"
 * (rule 11) and "these branches are nearly the same" all end with *give that
 * block a name*, and a name is the cheapest documentation there is — it turns
 * four lines a reader has to simulate in their head into one line they can
 * read. On a microcontroller it also gives you something you can test on the
 * desktop without the robot plugged in.
 *
 * **This is the only selection-driven rule in the catalogue.** There is no
 * smell to scan for: which lines belong together is a judgement about meaning,
 * not about syntax, so the rule offers nothing until the user has selected
 * whole statements (§2.4). `detect` returns `[]` with no selection, which is
 * also why its golden fixture rewrites nothing.
 *
 * ### Why the rewrite is safe
 *
 * The new `def` is inserted as the **immediate sibling** of the enclosing
 * function, so its enclosing scope chain is exactly the enclosing function's
 * chain minus the function itself. Every name the block reads therefore
 * resolves the same way it did before, provided the ones that were *local to
 * the enclosing function* are handed over explicitly — which is precisely the
 * parameter list (`bindingScopeFor` picks them out, and leaves module globals,
 * imports and builtins alone, because those are still visible from inside a
 * function defined next door). Being a sibling of the `def` also means the
 * helper is bound at the same moment the enclosing function is, so it can never
 * be missing when the call runs.
 *
 * Values flow back out through the return tuple: every name the block binds
 * that anything outside it still reads. "Reads it afterwards" is not only about
 * source order — a read *above* the selection runs again on the next turn of an
 * enclosing loop, and a read inside a nested `def`, `lambda` or generator
 * expression runs whenever that is called — so both count. Over-returning a
 * value is harmless (the caller assigns it straight back); under-returning one
 * silently loses a write, so the analysis leans the safe way.
 *
 * ### What it declines rather than guess (§2.6.5)
 *
 * - a `return`, `yield`, or a `break`/`continue` whose loop is outside the
 *   selection: the jump would land somewhere else entirely;
 * - `global`/`nonlocal` in the block — it binds names in a scope the new
 *   function does not have;
 * - an `await`, `async for` or `async with` inside a function that is not
 *   `async` (in an `async def` the helper is generated `async` and the call is
 *   awaited);
 * - a **method** — a class body is not a scope its methods can see, so a
 *   sibling `def` would be invisible to a bare call. Extracting a *method* is a
 *   different rewrite (it has to emit `self.…` at the call site and check the
 *   whole class for member collisions), and doing it wrong here would produce a
 *   `NameError` at runtime rather than a bad-but-working shape;
 * - a selection that straddles a block boundary or takes only part of a
 *   compound statement — the run must be whole, contiguous, sibling statements;
 * - a returned value where the block sits inside a `try`: a half-finished block
 *   leaves the earlier assignments visible to the handler, and a call that
 *   raised leaves none of them;
 * - a parameter or a returned value that is only *conditionally* bound. A name
 *   the caller may not have bound yet cannot be passed (the argument is
 *   evaluated before any of the block's side effects, so `motor.stop()` would
 *   never run), and a name the block only binds down one branch cannot be
 *   returned (`return value` would raise where the original quietly kept the
 *   caller's earlier value). {@link definitelyBound} is the definite-assignment
 *   analysis both tests use;
 * - a value a nested `def` can see: a closure that already exists while the
 *   block runs reads the *enclosing* function's variable, which the new
 *   function no longer writes, and a `nonlocal` in any nested scope writes one
 *   behind our back — a parameter is a copy, and copies go stale;
 * - a multi-line string in the block, or a line indented shallower than the
 *   block itself, because re-indenting would rewrite the string's own contents.
 *
 * ### f-strings
 *
 * The lexer keeps a string literal whole, so the names inside `f"{reading}"`
 * are invisible to `scope.ts` — and a name missed is a parameter not passed,
 * which is a `NameError` on the robot. {@link interpolatedNames} reads the
 * `{…}` replacement fields back out of the literal text and feeds them to both
 * halves of the analysis. It deliberately over-reports (a format spec's stray
 * letter, a `.format()` template's field name): a name too many costs a
 * redundant argument, a name too few costs a crash.
 */
import type { AnyNode, Constant, Expr, FunctionDef, Module, Stmt } from '../ast'
import { ancestors, blocksOf, enclosingFunction, unwrap, walk } from '../ast'
import { fullLineRange, indentAt, lineEnd, lineStart, reindent } from '../text'
import type { TextEdit } from '../text'
import {
  bindingScopeFor,
  bodyOf,
  hasEscapingControlFlow,
  hasScopeDeclarations,
  isScope,
  nameUses,
  namesWritten,
  readBeforeWritten,
  scopeOf
} from '../scope'
import type { Scope } from '../scope'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ExtractMatch {
  /** The function the selected statements live in. */
  fn: FunctionDef
  /** The contiguous run of sibling statements to move. */
  stmts: Stmt[]
  /** Whole-line span of that run — what the call replaces. */
  regionStart: number
  regionEnd: number
  /** Names the block reads that belong to the enclosing function. */
  params: string[]
  /** Names the block binds that anything outside it still reads. */
  returns: string[]
  /** The new function's name. */
  name: string
  /** True when the block needs an async context (`await`, `async for`/`with`). */
  isAsync: boolean
}

/** One run of sibling statements the selection covers, with its line span. */
interface Run {
  stmts: Stmt[]
  regionStart: number
  regionEnd: number
}

// ---------------------------------------------------------------------------
// Finding the selected run
// ---------------------------------------------------------------------------

/** Every statement list in the file, outermost first (pre-order). */
function statementLists(module: Module): Stmt[][] {
  const out: Stmt[][] = []
  walk(module as AnyNode, (node) => {
    for (const block of blocksOf(node)) out.push(block)
  })
  return out
}

/** True when everything between two offsets is blank or a `#` comment. */
function isFiller(src: string, from: number, to: number): boolean {
  if (to <= from) return true
  for (const line of src.slice(from, to).split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '' && !trimmed.startsWith('#')) return false
  }
  return true
}

/**
 * The run of whole statements the user selected, or null.
 *
 * The selection is snapped outwards to whole lines and then matched against one
 * statement list. A candidate list qualifies only when the selection covers its
 * run's lines *exactly* — anything extra either side must be blank or comment.
 * That single test is what rejects the partial selections: reaching down into
 * an `if` body leaves the `if` header uncovered, and starting inside one leaves
 * the statements above it uncovered, so neither list qualifies and we decline.
 */
function selectedRun(ctx: RefactorContext): Run | null {
  const sel = ctx.selection
  // A bare cursor is not a selection of statements — this rule stays quiet
  // until the user has actually chosen the lines they mean.
  if (!sel || sel.end <= sel.start) return null
  const src = ctx.src

  const selStart = lineStart(src, sel.start)
  // A whole-line selection already ends at the start of the following line;
  // anything else is extended to the end of the line the cursor landed on.
  const selEnd = sel.end > lineStart(src, sel.end) ? lineEnd(src, sel.end) : sel.end

  for (const list of statementLists(ctx.module)) {
    const picked: number[] = []
    for (let i = 0; i < list.length; i++) {
      // A statement counts as selected when the lines it occupies overlap the
      // selection at all, so half a dragged line still takes the whole thing.
      const lines = fullLineRange(src, list[i])
      if (lines.start < selEnd && selStart < lines.end) picked.push(i)
    }
    if (picked.length === 0) continue
    // Statements in a list are in source order and never overlap, so the picked
    // set is contiguous already — but a rewrite that assumed it wrongly would
    // splice out code nobody selected, so check rather than trust.
    if (picked[picked.length - 1] - picked[0] + 1 !== picked.length) continue

    const first = list[picked[0]]
    const last = list[picked[picked.length - 1]]
    const regionStart = fullLineRange(src, first).start
    const regionEnd = fullLineRange(src, last).end
    // The selection must reach the whole run and add nothing but blank lines
    // and comments either side of it.
    if (selStart > regionStart || selEnd < regionEnd) continue
    if (!isFiller(src, selStart, regionStart)) continue
    if (!isFiller(src, regionEnd, selEnd)) continue
    // `if ready: led.on()` puts a statement in the middle of a line. Replacing
    // that line would take the header with it, so only a statement that starts
    // its own line can be moved.
    if (!/^[ \t]*$/.test(src.slice(regionStart, first.start))) continue
    if (!/^[ \t]*(#[^\r\n]*)?\r?\n?$/.test(src.slice(last.end, regionEnd))) continue

    return { stmts: list.slice(picked[0], picked[picked.length - 1] + 1), regionStart, regionEnd }
  }
  return null
}

// ---------------------------------------------------------------------------
// Names the parser cannot see — f-string replacement fields
// ---------------------------------------------------------------------------

/** Words that look like names inside a replacement field but bind nothing. */
const FIELD_KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'if',
  'else',
  'for',
  'in',
  'is',
  'None',
  'True',
  'False',
  'lambda',
  'await',
  'yield'
])

/**
 * Identifiers in one replacement field's text.
 *
 * A name preceded by `.` is an attribute, one preceded by a digit is the tail
 * of a number or of a format spec like `:.2f`, and one preceded by `!` is a
 * conversion (`!r`) — none of those are names in any scope.
 */
function identifiersIn(text: string): string[] {
  const out: string[] = []
  const re = /[A-Za-z_][A-Za-z0-9_]*/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = m.index > 0 ? text[m.index - 1] : ''
    if (before === '.' || before === '!' || (before >= '0' && before <= '9')) continue
    if (FIELD_KEYWORDS.has(m[0])) continue
    out.push(m[0])
  }
  return out
}

/**
 * Every identifier the `{…}` fields of a string literal mention. `{{` and `}}`
 * are escaped braces, quoted text inside a field is data, and a nested field
 * (`f"{value:>{width}}"`) counts too.
 */
function interpolatedNames(raw: string): string[] {
  const text = raw.replace(/\{\{|\}\}/g, '  ')
  const out: string[] = []
  let depth = 0
  let quote = ''
  let field = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (depth > 0 && quote) {
      if (c === quote) quote = ''
      field += ' '
      continue
    }
    if (c === '{') {
      depth++
      if (depth === 1) {
        field = ''
        continue
      }
    } else if (c === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        out.push(...identifiersIn(field))
        field = ''
        continue
      }
    } else if (depth > 0 && (c === '"' || c === "'")) {
      quote = c
      field += ' '
      continue
    }
    if (depth > 0) field += c
  }
  // An unbalanced brace means we cannot tell where the field ended; read the
  // rest as one, because over-reporting is the safe direction here.
  if (depth > 0) out.push(...identifiersIn(field))
  return out
}

/** One name an f-string mentions, with the literal it was written in. */
interface FieldRead {
  name: string
  /** The literal's offset — where the read happens, for the escape analysis. */
  at: number
  /** The literal itself, for the walk up to its enclosing scope. */
  node: AnyNode
}

/**
 * Names read by the replacement fields of every string literal in `nodes`.
 *
 * Every literal containing `{` is scanned, not only the ones whose prefix says
 * `f`: adjacent literals concatenate into a single `Constant` that keeps only
 * the *first* piece's prefix, so `"reading " f"{value}"` would otherwise look
 * like a plain string.
 */
function fieldReads(nodes: readonly AnyNode[]): FieldRead[] {
  const out: FieldRead[] = []
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type !== 'Constant') return undefined
      const literal = n as Constant
      if (literal.kind !== 'string' || !literal.raw.includes('{')) return undefined
      for (const name of interpolatedNames(literal.raw)) {
        out.push({ name, at: literal.start, node: literal })
      }
      return undefined
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Definite assignment
// ---------------------------------------------------------------------------

/** Add every name an assignment target binds to `out`. */
function targetNames(expr: Expr | undefined, out: Set<string>): void {
  if (!expr) return
  const e = unwrap(expr)
  if (e.type === 'Name') out.add(e.id)
  else if (e.type === 'Tuple' || e.type === 'List') for (const el of e.elts) targetNames(el, out)
  else if (e.type === 'Starred') targetNames(e.value, out)
  // `a.b = …` and `a[i] = …` mutate; they bind no name.
}

/** The names present in every one of `sets` (empty when there are none). */
function intersect(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set()
  const out = new Set(sets[0])
  for (const s of sets.slice(1)) for (const name of [...out]) if (!s.has(name)) out.delete(name)
  return out
}

/**
 * The names `stmts` is **certain** to have bound once it finishes normally.
 *
 * Nothing here may guess: a name a rewrite returns (or hands over as an
 * argument) must be bound on every path, or the rewrite turns a working program
 * into an `UnboundLocalError`. So a loop body contributes nothing (it may run
 * zero times), an `if` contributes only what both of its branches bind, a `try`
 * only what the body and *every* handler bind, and a `with` body nothing at all
 * (a `__exit__` that swallows an exception resumes after the block with the
 * later assignments never made).
 */
function definitelyBound(stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>()
  for (const stmt of stmts) {
    switch (stmt.type) {
      case 'Assign':
        for (const t of stmt.targets) targetNames(t, out)
        break
      case 'AnnAssign':
        if (stmt.value) targetNames(stmt.target, out)
        break
      case 'AugAssign':
        targetNames(stmt.target, out)
        break
      case 'Import':
        for (const a of stmt.names) out.add(a.asname ?? a.name.split('.')[0])
        break
      case 'ImportFrom':
        for (const a of stmt.names) out.add(a.asname ?? a.name)
        break
      case 'FunctionDef':
      case 'ClassDef':
        out.add(stmt.name)
        break
      case 'With':
        for (const item of stmt.items) targetNames(item.optionalVars, out)
        break
      case 'If':
        if (stmt.orelse.length > 0) {
          for (const name of intersect([definitelyBound(stmt.body), definitelyBound(stmt.orelse)])) {
            out.add(name)
          }
        }
        break
      case 'Try': {
        const normal = definitelyBound([...stmt.body, ...stmt.orelse])
        const paths =
          stmt.handlers.length === 0
            ? [normal]
            : [normal, ...stmt.handlers.map((h) => definitelyBound(h.body))]
        for (const name of intersect(paths)) out.add(name)
        for (const name of definitelyBound(stmt.finalbody)) out.add(name)
        break
      }
      default:
        // `for`/`while` may run their body zero times; everything else binds
        // nothing at all.
        break
    }
  }
  return out
}

/** The statements of `list` that come before `child`, or none if it isn't in it. */
function precedingIn(list: readonly Stmt[], child: AnyNode): Stmt[] {
  const i = (list as readonly AnyNode[]).indexOf(child)
  return i < 0 ? [] : list.slice(0, i)
}

/**
 * The names that are **certain** to be bound by the time the block starts:
 * the enclosing function's parameters, the targets of the loops, `with`s and
 * `except`s the block sits inside, and whatever the statements before it on
 * that path definitely bind.
 *
 * Anything else is a name the caller may not have bound yet — and the call
 * evaluates its arguments *before* the block's first side effect, so passing
 * one would move a crash earlier and skip the `motor.stop()` that used to run.
 */
function boundBeforeBlock(fn: FunctionDef, first: Stmt): Set<string> {
  const out = new Set<string>()
  for (const p of fn.params) out.add(p.name)
  const add = (names: Iterable<string>): void => {
    for (const name of names) out.add(name)
  }

  let child: AnyNode = first
  for (const parent of ancestors(first)) {
    switch (parent.type) {
      case 'FunctionDef':
        add(definitelyBound(precedingIn(parent.body, child)))
        break
      case 'If':
      case 'While':
        add(
          definitelyBound(
            precedingIn(
              (parent.body as readonly AnyNode[]).includes(child) ? parent.body : parent.orelse,
              child
            )
          )
        )
        break
      case 'For':
        if ((parent.body as readonly AnyNode[]).includes(child)) {
          // The body only runs with the target bound.
          targetNames(parent.target, out)
          add(definitelyBound(precedingIn(parent.body, child)))
        } else {
          // The `else` runs even when the loop never did, so neither the target
          // nor anything the body bound is certain.
          add(definitelyBound(precedingIn(parent.orelse, child)))
        }
        break
      case 'With':
        for (const item of parent.items) targetNames(item.optionalVars, out)
        add(definitelyBound(precedingIn(parent.body, child)))
        break
      case 'ExceptHandler':
        if (parent.name) out.add(parent.name)
        add(definitelyBound(precedingIn(parent.body, child)))
        break
      case 'Try':
        if ((parent.body as readonly AnyNode[]).includes(child)) {
          add(definitelyBound(precedingIn(parent.body, child)))
        } else if ((parent.orelse as readonly AnyNode[]).includes(child)) {
          // The `else` runs only after the body finished.
          add(definitelyBound(parent.body))
          add(definitelyBound(precedingIn(parent.orelse, child)))
        } else if ((parent.finalbody as readonly AnyNode[]).includes(child)) {
          // A `finally` also runs when the body stopped half way through.
          add(definitelyBound(precedingIn(parent.finalbody, child)))
        }
        // A handler on the path takes nothing from the body: the exception may
        // have landed before any of it ran.
        break
      default:
        break
    }
    if (parent === (fn as AnyNode)) break
    child = parent
  }
  return out
}

// ---------------------------------------------------------------------------
// Safety probes
// ---------------------------------------------------------------------------

/** Does the block need an async context of its own? */
function needsAsyncContext(stmts: readonly Stmt[]): boolean {
  let needs = false
  for (const root of stmts) {
    walk(root as AnyNode, (n) => {
      // A nested `def` carries its own context — its `await`s are not ours.
      if (n.type === 'FunctionDef' || n.type === 'Lambda') return false
      if (n.type === 'Await') needs = true
      if ((n.type === 'For' || n.type === 'With' || n.type === 'Comprehension') && n.isAsync) {
        needs = true
      }
      return undefined
    })
  }
  return needs
}

/**
 * Does the block `del` a bare name? The name would then be unbound inside the
 * new function while the caller's own binding survives, which is a difference
 * no return value can express. (`del buffer[0]` is a mutation and is fine.)
 */
function deletesBareName(stmts: readonly Stmt[]): boolean {
  let found = false
  for (const root of stmts) {
    walk(root as AnyNode, (n) => {
      if (n.type !== 'Delete') return undefined
      for (const target of n.targets) if (unwrap(target).type === 'Name') found = true
      return undefined
    })
  }
  return found
}

/**
 * Does the block contain a string literal that spans lines? Its contents sit in
 * the source at a fixed indentation, so re-indenting the block would rewrite
 * the string itself — a change to the program's data, not its shape.
 */
function hasMultilineString(stmts: readonly Stmt[]): boolean {
  let found = false
  for (const root of stmts) {
    walk(root as AnyNode, (n) => {
      if (n.type === 'Constant' && n.kind === 'string' && n.raw.includes('\n')) found = true
      return undefined
    })
  }
  return found
}

/**
 * Names the enclosing function declares `global` or `nonlocal`, wherever it
 * does it. The declaration binds the whole function, not just the lines around
 * it, so a block that *writes* one of these names is writing a variable that
 * lives somewhere else — and the new function, which has no declaration of its
 * own, would quietly write a local instead.
 */
function namesDeclaredIn(fn: FunctionDef): Set<string> {
  const out = new Set<string>()
  for (const stmt of fn.body) {
    walk(stmt as AnyNode, (n) => {
      // A nested scope's declarations are its own business.
      if (isScope(n)) return false
      if (n.type === 'Global' || n.type === 'Nonlocal') for (const name of n.names) out.add(name)
      return undefined
    })
  }
  return out
}

/** Is the block inside a `try` belonging to the enclosing function? */
function insideTry(stmt: Stmt, fn: FunctionDef): boolean {
  for (const a of ancestors(stmt)) {
    if (a === (fn as AnyNode)) return false
    if (a.type === 'Try' || a.type === 'ExceptHandler') return true
  }
  return false
}

/**
 * Can a read that sits *before* the block still observe what the block wrote?
 *
 * Two ways it can: it is inside a nested `def`/`lambda`/comprehension, which
 * runs whenever it is called rather than where it is written; or an enclosing
 * loop brings the reader round again after the block has run. Either way the
 * name has to come back out of the new function.
 */
function runsAfterTheBlock(read: AnyNode, fn: FunctionDef, run: Run): boolean {
  for (const a of ancestors(read)) {
    if (a === (fn as AnyNode)) return false
    if (
      a.type === 'FunctionDef' ||
      a.type === 'Lambda' ||
      a.type === 'ListComp' ||
      a.type === 'SetComp' ||
      a.type === 'DictComp' ||
      a.type === 'GeneratorExp'
    ) {
      return true
    }
    if ((a.type === 'For' || a.type === 'While') && a.start <= run.regionStart && run.regionEnd <= a.end) {
      return true
    }
  }
  return false
}

/** Is `name` still read anywhere outside the block once the block has run? */
function escapesBlock(fn: FunctionDef, name: string, run: Run): boolean {
  for (const use of nameUses(bodyOf(fn))) {
    if (use.kind !== 'read' || use.name !== name) continue
    if (use.node.start >= run.regionEnd) return true
    if (use.node.start >= run.regionStart) continue
    if (runsAfterTheBlock(use.node, fn, run)) return true
  }
  // A read the lexer hid inside an f-string counts exactly the same: miss one
  // and the block's write is silently thrown away.
  for (const read of fieldReads(bodyOf(fn))) {
    if (read.name !== name) continue
    if (read.at >= run.regionEnd) return true
  }
  return false
}

/**
 * The nested scope a node sits in, stopping at `fn`. `null` when the node is
 * directly in the enclosing function's own body.
 *
 * Only the scopes that can outlive the statement that created them count: a
 * `def`, a `lambda` and a generator expression are all objects that run later,
 * while a list/set/dict comprehension has finished by the time the next line
 * starts.
 */
function liveScopeAround(node: AnyNode, fn: FunctionDef): AnyNode | null {
  for (const a of ancestors(node)) {
    if (a === (fn as AnyNode)) return null
    if (a.type === 'FunctionDef' || a.type === 'Lambda' || a.type === 'GeneratorExp') return a
  }
  return null
}

/** The innermost loop of `fn` that contains the whole block, if any. */
function loopAround(first: Stmt, fn: FunctionDef): AnyNode | null {
  for (const a of ancestors(first)) {
    if (a === (fn as AnyNode)) return null
    if (a.type === 'For' || a.type === 'While') return a
  }
  return null
}

/**
 * Names a closure can read *while the block is running*.
 *
 * A nested `def` closes over the enclosing function's variable, not over a
 * copy. Once the block moves out, the enclosing function's binding stops
 * changing until the call returns — so a closure that already exists and is
 * called from inside the block reads a stale value. Nothing in the diff shows
 * that, and it can hang a robot (an IRQ handler's counter that never moves), so
 * the rule declines instead.
 *
 * A closure created *after* the block cannot be called from inside it — its
 * `def` has not run yet — unless a loop brings the block round again.
 */
function namesReadByLiveClosures(fn: FunctionDef, run: Run, first: Stmt): Set<string> {
  const loop = loopAround(first, fn)
  const out = new Set<string>()
  const live = (node: AnyNode, at: number): boolean => {
    if (at >= run.regionStart && at < run.regionEnd) return false
    const scope = liveScopeAround(node, fn)
    if (!scope) return false
    if (scope.start < run.regionStart) return true
    return loop != null && loop.start <= scope.start && scope.end <= loop.end
  }
  for (const use of nameUses(bodyOf(fn))) {
    if (use.kind === 'read' && live(use.node, use.node.start)) out.add(use.name)
  }
  for (const read of fieldReads(bodyOf(fn))) {
    // The `{…}` of an f-string inside a closure reads it just the same.
    if (live(read.node, read.at)) out.add(read.name)
  }
  return out
}

/**
 * Names a nested scope rebinds with `nonlocal`. Such a name is written from
 * somewhere the new function cannot be told about, so a parameter holding a
 * copy of it — or a return value replacing it — loses those writes.
 */
function namesRebindableByNestedScopes(fn: FunctionDef): Set<string> {
  const out = new Set<string>()
  for (const stmt of fn.body) {
    walk(stmt as AnyNode, (n) => {
      if (n.type === 'Nonlocal') for (const name of n.names) out.add(name)
      return undefined
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Every name visible from the new function's insertion point. */
function takenNames(ctx: RefactorContext, fn: FunctionDef): Set<string> {
  const taken = new Set<string>()
  const addScope = (scope: Scope): void => {
    for (const use of nameUses(bodyOf(scope))) taken.add(use.name)
    for (const read of fieldReads(bodyOf(scope))) taken.add(read.name)
    if (scope.type === 'FunctionDef' || scope.type === 'Lambda') {
      for (const p of scope.params) taken.add(p.name)
    }
  }
  addScope(ctx.module)
  addScope(fn)
  for (const a of ancestors(fn)) if (isScope(a)) addScope(a)
  return taken
}

/**
 * A name for the block. A single assignment names itself — `speed = …` becomes
 * `compute_speed()` — and so does a block with exactly one value to hand back;
 * anything else gets the neutral `extracted`, which is a prompt to rename it.
 */
function baseName(stmts: readonly Stmt[], returns: readonly string[]): string {
  if (stmts.length === 1 && stmts[0].type === 'Assign' && stmts[0].targets.length === 1) {
    const target = unwrap(stmts[0].targets[0])
    if (target.type === 'Name') return `compute_${target.id}`
  }
  if (returns.length === 1) return `compute_${returns[0]}`
  return 'extracted'
}

/**
 * Where the new `def` goes: the enclosing function's line, or the top of the
 * comment block hugging it.
 *
 * A comment written directly above a `def` is about that `def`. Slipping a new
 * function in underneath it would leave the comment describing the wrong one —
 * the file would still run, but it would now say something untrue.
 *
 * Two comments have to stay on the line they are on: a `#!` shebang (only the
 * first line of a file is one) and an encoding cookie (only the first two count),
 * so the scan never passes either.
 */
function insertionPoint(src: string, fn: FunctionDef): number {
  let at = lineStart(src, fn.start)
  while (at > 0) {
    const prev = lineStart(src, at - 1)
    const line = src.slice(prev, at).trim()
    if (!line.startsWith('#')) break
    if (line.startsWith('#!') || /coding[:=]/.test(line)) break
    at = prev
  }
  return at
}

/** `base`, `base2`, `base3`, … — the first that collides with nothing in sight. */
function freshFunctionName(base: string, taken: ReadonlySet<string>): string | null {
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) {
    if (!taken.has(`${base}${i}`)) return `${base}${i}`
  }
  return null
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** Work out the whole extraction, or decide it cannot be proved safe. */
function analyse(ctx: RefactorContext): ExtractMatch | null {
  const run = selectedRun(ctx)
  if (!run) return null
  const { stmts } = run
  const first = stmts[0]

  const fn = enclosingFunction(first)
  // Module-level code has no `def` to sit next to; a `lambda` has no statements.
  if (!fn || fn.type !== 'FunctionDef') return null
  // Anything nested in a class body (or in a `def` of its own) inside the
  // function belongs to another scope entirely.
  if (scopeOf(first) !== (fn as Scope)) return null
  // A method's siblings live in the class body, which its own code cannot see.
  if (scopeOf(fn).type === 'ClassDef') return null

  if (hasEscapingControlFlow(stmts)) return null
  if (hasScopeDeclarations(stmts)) return null
  if (deletesBareName(stmts)) return null
  if (hasMultilineString(stmts)) return null

  const isAsync = needsAsyncContext(stmts)
  if (isAsync && !fn.isAsync) return null

  // A `global`/`nonlocal` anywhere in the function reaches these lines too, so
  // writing one of those names here is not writing a local at all.
  const declared = namesDeclaredIn(fn)
  const written = [...namesWritten(stmts)]
  if (written.some((name) => declared.has(name))) return null

  // Parameters: what the block reads before it writes, minus everything that is
  // still in scope from outside the function — globals, imports, builtins.
  const params = readBeforeWritten(stmts).filter((name) => bindingScopeFor(first, name) === fn)
  // The lexer keeps `f"{reading}"` whole, so `readBeforeWritten` never saw the
  // names inside it. Add them, or the new function references a name nobody
  // passed it.
  const writtenAt = new Map<string, number>()
  for (const use of nameUses(stmts)) {
    if (use.kind === 'write' && !writtenAt.has(use.name)) writtenAt.set(use.name, use.node.start)
  }
  for (const read of fieldReads(stmts)) {
    if (params.includes(read.name)) continue
    // A name the block itself binds first needs no parameter.
    const bound = writtenAt.get(read.name)
    if (bound != null && bound < read.at) continue
    if (bindingScopeFor(first, read.name) !== fn) continue
    params.push(read.name)
  }
  // Returns: what the block binds and something outside it still reads. The set
  // is built in source order of first write, so the tuple never wobbles.
  const returns = written.filter((name) => escapesBlock(fn, name, run))

  // Inside a `try`, a call that raises part-way leaves none of the assignments
  // the original block would have made before the exception, and a handler (or
  // anything after it) can see the difference.
  if (returns.length > 0 && insideTry(first, fn)) return null

  // An argument is evaluated before the block's first side effect, and a
  // returned name is read after its last, so both have to be bound on every
  // path — otherwise the rewrite raises where the original ran happily.
  const boundBefore = boundBeforeBlock(fn, first)
  if (params.some((name) => !boundBefore.has(name))) return null
  const bound = definitelyBound(stmts)
  if (returns.some((name) => !bound.has(name) && !params.includes(name))) return null

  // Parameters and return values are copies. A closure that can run while the
  // block does, or a `nonlocal` in a nested scope, writes the original.
  const rebindable = namesRebindableByNestedScopes(fn)
  if (params.some((name) => rebindable.has(name))) return null
  if (returns.some((name) => rebindable.has(name))) return null
  const liveClosureReads = namesReadByLiveClosures(fn, run, first)
  if (written.some((name) => liveClosureReads.has(name))) return null

  const name = freshFunctionName(baseName(stmts, returns), takenNames(ctx, fn))
  if (!name) return null

  return {
    fn,
    stmts,
    regionStart: run.regionStart,
    regionEnd: run.regionEnd,
    params,
    returns,
    name,
    isAsync
  }
}

export const extractFunctionRule = defineRule<ExtractMatch>({
  id: 'extract-function',
  title: 'Extract into a function',
  message: 'Move the selected statements into a function of their own',
  catalogue: 8,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-extract-function',
  // Never batched by "Tidy this file": which lines belong together is the
  // user's judgement, and the new name is theirs to choose.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<ExtractMatch>[] {
    const found = analyse(ctx)
    if (!found) return []
    const signature = `${found.name}(${found.params.join(', ')})`
    return [
      {
        ruleId: 'extract-function',
        start: found.stmts[0].start,
        end: found.stmts[found.stmts.length - 1].end,
        title: `Extract into ${signature}`,
        message:
          found.stmts.length === 1
            ? `Move this statement into ${signature}`
            : `Move these ${found.stmts.length} statements into ${signature}`,
        data: found
      }
    ]
  },

  apply(match: RefactorMatch<ExtractMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { fn, stmts, regionStart, regionEnd, params, returns, name, isAsync } = match.data
    const src = ctx.src
    const unit = ctx.indentUnit
    const eol = ctx.eol

    const blockIndent = indentAt(src, stmts[0].start)
    const fnIndent = indentAt(src, fn.start)
    const bodyIndent = fnIndent + unit
    const region = src.slice(regionStart, regionEnd)
    if (region.trim() === '') return null

    // Every line has to sit at the block's own indent or deeper. A shallower
    // one is a continuation (or something stranger) whose meaning we cannot
    // preserve by shifting it, so decline instead of mangling it.
    for (const line of region.split('\n')) {
      if (line.trim() === '') continue
      if (!line.startsWith(blockIndent)) return null
    }

    const signature = `${isAsync ? 'async ' : ''}def ${name}(${params.join(', ')}):`
    let body = reindent(region, blockIndent, bodyIndent)
    if (!body.endsWith('\n')) body += eol
    const returnLine = returns.length ? `${bodyIndent}return ${returns.join(', ')}${eol}` : ''
    // Two blank lines between top-level defs, one between nested ones — the
    // spacing the file already uses around the function we are sitting beside.
    const gap = fnIndent === '' ? eol + eol : eol
    const newFunction = `${fnIndent}${signature}${eol}${body}${returnLine}${gap}`

    const target = returns.length ? `${returns.join(', ')} = ` : ''
    const call = `${blockIndent}${target}${isAsync ? 'await ' : ''}${name}(${params.join(', ')})`
    // Keep the file's last line unterminated if that is how it already was.
    const callLine = /\n$/.test(region) ? call + eol : call

    // The new function goes above the enclosing one — above its decorators too,
    // since `FunctionDef.start` already covers them — so the two edits are
    // always disjoint.
    const insertAt = insertionPoint(src, fn)
    if (insertAt >= regionStart) return null

    return [
      { start: insertAt, end: insertAt, newText: newFunction },
      { start: regionStart, end: regionEnd, newText: callLine }
    ]
  }
})

/** Exported for the tests that probe the selection and escape analysis directly. */
export const _internals: {
  selectedRun: typeof selectedRun
  escapesBlock: typeof escapesBlock
} = { selectedRun, escapesBlock }
