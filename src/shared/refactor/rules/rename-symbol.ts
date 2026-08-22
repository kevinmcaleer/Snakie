/**
 * Rule 90 — **Rename this variable** (epic #634 §3, issue [#451]).
 *
 * ```python
 * def follow_line(sensor):        def follow_line(sensor):
 *     motorSpeed = 40                 motor_speed = 40
 *     while sensor.value():           while sensor.value():
 *         motorSpeed -= 5      →          motor_speed -= 5
 *         drive(motorSpeed)               drive(motor_speed)
 *     return motorSpeed               return motor_speed
 * ```
 *
 * #451 calls rename "the simplest type of refactoring", and it is — *once you
 * have scope analysis*. Find-and-replace on the word `motorSpeed` also hits the
 * attribute `self.motorSpeed`, the string `"motorSpeed"`, the keyword argument
 * `spin(motorSpeed=1)` and the unrelated `motorSpeed` local two functions down.
 * Every one of those is a different thing that merely spells the same. This rule
 * renames a *binding*: {@link bindingScopeFor} finds which scope owns the name at
 * the cursor and {@link referencesTo} returns that scope's own uses of it,
 * skipping any nested scope that rebinds it. That is the whole reason #451 hangs
 * off this epic rather than being a two-line editor command.
 *
 * **Where the new name comes from.** A rule cannot prompt, so it never invents
 * meaning. The only rename offered automatically is the one that is derivable
 * and unambiguous: `camelCase`/`PascalCase` → `snake_case`, which is what PEP 8
 * asks for and what the rest of a MicroPython file already looks like. A name
 * that is already snake_case gets no offer, and a single letter gets none either
 * — turning `d` into something meaningful takes knowledge of the robot that is
 * not in the file. For an interactive rename with a name the user typed, the
 * editor layer calls {@link renameEdits} directly.
 *
 * **Selection-driven.** With no cursor there is no symbol, so `detect` returns
 * nothing during the whole-file hint pass — a Problems entry per camelCase
 * variable would be nagging, not help.
 *
 * **What it refuses, and why.** The rewrite must be provable from this one file:
 *
 * - **Anything bound at module scope.** `motorSpeed = 0` at the top of
 *   `robot.py` is that module's public surface — another file may say
 *   `from robot import motorSpeed`, and the REPL may poke it by name. We cannot
 *   see those, so we decline (§2.6.6). A name bound inside a `def` cannot be
 *   reached from outside it, which is exactly what makes *that* rename provable.
 *   Class bodies go the same way: a class-level name is an attribute of the
 *   class, reachable as `Cls.name` from anywhere.
 * - **Parameters of anything but a closure that cannot escape.**
 *   `spin(motorSpeed=200)` passes the parameter by name from a call site this
 *   file may not contain, and the keyword in a call is not a name in any scope.
 *   Only a `def` nested inside another `def` is eligible, and only when that
 *   nested `def` is *provably* callable from nowhere else: its own name is used
 *   solely as the callee of a call inside the enclosing function. The moment it
 *   is returned, stored (`bot.handler = step`), passed on or decorated, its
 *   callers are outside this file again and `ramp(stepSize=3)` in `main.py`
 *   would start raising `TypeError`. Even for an eligible closure, no keyword
 *   argument anywhere in the file may spell the name.
 * - **Import bindings.** Renaming the `machine` in `import machine` needs the
 *   `import` line rewritten too (`import machine as mach`), which is a different
 *   refactoring; the reference set does not include the line.
 * - **Dunder and `ALL_CAPS` names.** `__init__` is a protocol, `__x` is name
 *   mangled, and a constant is exactly the kind of name another module imports.
 * - **Names touched by `global`/`nonlocal`.** The declaration itself carries no
 *   `Name` node, so a rename would leave it pointing at the old spelling.
 * - **Names — old *or* new — that appear inside an f-string.** The parser keeps
 *   an f-string opaque (it is a `Constant`), so `f"{motorSpeed}"` is invisible
 *   to the reference set: renaming around the old spelling leaves a `NameError`
 *   waiting on the board, and renaming *into* a spelling an f-string already
 *   interpolates silently repoints that read at the new local
 *   (`f"{battery_v}"` stops reading the module's `battery_v`).
 * - **A bare annotation of the name** (`motorSpeed: int`, no value). PEP 526
 *   binds nothing there, so `nameUses` does not report it and it is not in the
 *   reference set — the rename would leave that one spelling behind.
 * - **Anything the new name would collide with**, including a binding in a scope
 *   *between* a reference and its own scope: renaming a global to `motor_speed`
 *   when the function that reads it has a local `motor_speed` would silently
 *   repoint the read. Comprehension `for` targets count, even though a
 *   comprehension is not a scope node this engine models.
 *
 * [#451]: https://github.com/kevinmcaleer/Snakie/issues/451
 */
import type { AnyNode, FunctionDef, Param } from '../ast'
import { ancestors, enclosingFunction, unwrap, walk } from '../ast'
import { KEYWORDS } from '../lexer'
import type { Scope } from '../scope'
import {
  bindingScopeFor,
  bodyOf,
  isNameFree,
  isScope,
  localBindings,
  nameUses,
  referencesTo
} from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { OffsetRange, RefactorContext, RefactorMatch } from '../types'

interface RenameMatch {
  /** The name the cursor is sitting on. */
  name: string
  /** What every occurrence becomes. */
  newName: string
  /** Every occurrence to rewrite, in source order, non-overlapping. */
  ranges: OffsetRange[]
}

/** The identifier the cursor is on, with the node that carries it. */
interface SymbolAtCursor {
  name: string
  start: number
  end: number
  /** The AST node the identifier belongs to — the anchor for scope analysis. */
  node: AnyNode
}

/** A bare ASCII identifier. Deliberately stricter than Python, which allows Unicode. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Every identifier the cursor could plausibly be on: bare `Name`s, the name
 * token of a `def`/`class`, and a plain parameter. An attribute is *not* here —
 * `obj.speed` has no `Name` node for `speed`, which is precisely why this rule
 * never renames one.
 */
function symbolCandidates(ctx: RefactorContext): SymbolAtCursor[] {
  const out: SymbolAtCursor[] = []
  walk(ctx.module as AnyNode, (node) => {
    switch (node.type) {
      case 'Name':
        out.push({ name: node.id, start: node.start, end: node.end, node })
        return
      case 'FunctionDef':
      case 'ClassDef':
        out.push({
          name: node.name,
          start: node.nameStart,
          end: node.nameStart + node.name.length,
          node
        })
        return
      case 'Param':
        // `*args`/`**kwargs` start at the star, and the markers `/` and `*` are
        // not names at all; only a plain parameter starts at its own name.
        if (node.kind === 'normal' && ctx.src.startsWith(node.name, node.start)) {
          out.push({ name: node.name, start: node.start, end: node.start + node.name.length, node })
        }
        return
      default:
        return
    }
  })
  return out
}

/**
 * The innermost identifier containing `offset`. Ties go to the identifier the
 * cursor is strictly inside, so a cursor wedged between two tokens picks the one
 * it is actually in rather than the one it merely touches.
 */
function symbolAt(ctx: RefactorContext, offset: number): SymbolAtCursor | null {
  let best: SymbolAtCursor | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const cand of symbolCandidates(ctx)) {
    if (offset < cand.start || offset > cand.end) continue
    const inside = offset < cand.end ? 0 : 1
    const score = inside * 1e6 + (cand.end - cand.start)
    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }
  return best
}

/** `motorSpeed` → `motor_speed`, `readADCValue` → `read_adc_value`. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * The better name, or null when there is no improvement we can *derive*.
 *
 * The bar is deliberately high: a rename the user did not ask for had better be
 * one they would have made themselves. Only the mixed-case → snake_case case
 * clears it.
 */
export function suggestedName(name: string): string | null {
  // A single letter carries no meaning to expand; `i`/`x` are conventional
  // anyway, and inventing `index` for someone else's `d` is a guess.
  if (name.length < 2) return null
  // `__init__`, `__x` — a protocol name and a mangled one, neither ours to touch.
  if (name.startsWith('__')) return null
  // `MAX_SPEED` is the constant convention, and constants get imported.
  if (!/[a-z]/.test(name)) return null
  // Already snake_case: nothing to offer.
  if (!/[A-Z]/.test(name)) return null
  const snake = toSnakeCase(name)
  if (snake === name || !IDENTIFIER.test(snake) || KEYWORDS.has(snake)) return null
  return snake
}

/** Does `scope` take `name` as a plain parameter? */
function parameterNamed(scope: Scope, name: string): Param | null {
  if (scope.type !== 'FunctionDef' && scope.type !== 'Lambda') return null
  for (const p of scope.params) {
    if (p.name === name) return p
  }
  return null
}

/** Is any `global`/`nonlocal` in the file about `name`? */
function isDeclaredNonLocal(ctx: RefactorContext, name: string): boolean {
  let found = false
  walk(ctx.module as AnyNode, (n) => {
    if ((n.type === 'Global' || n.type === 'Nonlocal') && n.names.includes(name)) found = true
    return undefined
  })
  return found
}

/**
 * Is `name` bound by an `import` in this scope? The reference set covers the
 * *uses* but the `import` line is not a `Name` node we can rewrite, so a rename
 * would leave the binding behind.
 */
function isImportBinding(scope: Scope, name: string): boolean {
  let found = false
  for (const root of bodyOf(scope)) {
    walk(root, (n) => {
      // A nested `def`/`class` binds its imports in its own scope, not ours.
      if (isScope(n)) return false
      if (n.type === 'Import' || n.type === 'ImportFrom') {
        for (const alias of n.names) {
          const bound = alias.asname ?? (n.type === 'Import' ? alias.name.split('.')[0] : alias.name)
          if (bound === name) found = true
        }
      }
      return undefined
    })
  }
  return found
}

/**
 * Does `name` appear as a whole word inside an f-string anywhere in this scope
 * — nested scopes included, since a closure reads the outer name too?
 *
 * The parser treats an f-string as one opaque `Constant`, so a name interpolated
 * in it is invisible to the reference set: the one place a rename could quietly
 * break the file.
 */
function appearsInFString(scope: Scope, name: string): boolean {
  const word = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`)
  let found = false
  for (const root of bodyOf(scope)) {
    walk(root, (n) => {
      if (n.type === 'Constant' && n.kind === 'string' && (n.prefix ?? '').includes('f')) {
        if (word.test(n.raw)) found = true
      }
      return undefined
    })
  }
  return found
}

/**
 * Does a comprehension anywhere in `scope` bind `name` as one of its `for`
 * targets?
 *
 * A comprehension is a scope in Python 3 — the `motor_speed` in
 * `[x for motor_speed in xs]` lives and dies inside the brackets — but it is not
 * one of the four node types {@link isScope} models, and that is a blind spot in
 * *both* collision checks: {@link isNameFree} deliberately shadows a
 * comprehension's targets, so it never sees the name, and
 * {@link shadowedOnTheWay} only walks scope nodes, so it steps straight past the
 * comprehension a reference is sitting in. The result is a silent behaviour
 * change: renaming `minSpeed` to `min_speed` in
 *
 * ```python
 * [min_speed for min_speed in readings if min_speed > minSpeed]
 * ```
 *
 * rewrites the test to `min_speed > min_speed`, which is never true and turns a
 * filter into an empty list. So any comprehension in the scope that already
 * binds the new spelling is a flat refusal — including one inside a nested
 * `def` or `lambda`, which costs us nothing and saves reasoning about which
 * comprehensions a reference could possibly be inside.
 */
function comprehensionBinds(scope: Scope, name: string): boolean {
  let found = false
  for (const root of bodyOf(scope)) {
    walk(root, (n) => {
      if (
        n.type === 'ListComp' ||
        n.type === 'SetComp' ||
        n.type === 'GeneratorExp' ||
        n.type === 'DictComp'
      ) {
        for (const gen of n.generators) {
          for (const use of nameUses([gen.target])) {
            if (use.name === name) found = true
          }
        }
      }
      return undefined
    })
  }
  return found
}

/**
 * Is `name` the target of a bare annotation — `motorSpeed: int` with no value —
 * in this scope?
 *
 * PEP 526 binds nothing there (the annotation is not even evaluated for a
 * local), so `nameUses` does not report it and it is not in the reference set.
 * Renaming would leave that one spelling behind, on a declaration that still
 * marks the name local to the function: a rename that visibly did not rename
 * everything. Decline instead.
 */
function isBareAnnotationTarget(scope: Scope, name: string): boolean {
  let found = false
  for (const root of bodyOf(scope)) {
    walk(root, (n) => {
      // A nested `def`/`class` annotates its own names, not ours.
      if (isScope(n)) return false
      if (n.type === 'AnnAssign' && !n.value) {
        const target = unwrap(n.target)
        if (target.type === 'Name' && target.id === name) found = true
      }
      return undefined
    })
  }
  return found
}

/**
 * Could this nested `def` be called from outside the function that contains it?
 *
 * This is the premise the parameter rule rests on. A closure whose name is only
 * ever the callee of a call inside its enclosing function has every one of its
 * call sites in front of us, so renaming a parameter is provable. The moment the
 * function object itself escapes — `return step`, `bot.handler = step`,
 * `run_later(step)`, or a decorator that registers it somewhere — a caller in
 * another file can write `step(stepSize=3)`, and the keyword-argument check
 * (which only sees this file) would not save them.
 */
function escapesEnclosingFunction(scope: FunctionDef): boolean {
  const outer = enclosingFunction(scope)
  // A module-level `def` is callable by name from anywhere that imports it.
  if (!outer) return true
  // A decorator can wrap, register or replace the function; where the result
  // ends up is not readable from this file.
  if (scope.decorators.length > 0) return true
  for (const use of referencesTo(outer, scope.name)) {
    // The `def` reports its own name through a synthesised, unlinked node.
    if (!use.node.parent) {
      if (use.node.start === scope.nameStart) continue
      return true
    }
    const parent = use.node.parent
    if (parent.type !== 'Call' || parent.func !== use.node) return true
  }
  return false
}

/** Is `name` used as a keyword argument anywhere in the file? */
function usedAsKeywordArgument(ctx: RefactorContext, name: string): boolean {
  let found = false
  walk(ctx.module as AnyNode, (n) => {
    if (n.type === 'Keyword' && n.arg === name) found = true
    return undefined
  })
  return found
}

/**
 * Would `newName` mean something else at this reference? Walks the scopes
 * between the reference and the binding scope: if any of them binds `newName`,
 * the renamed reference would resolve to *that* binding instead.
 */
function shadowedOnTheWay(node: AnyNode, scope: Scope, newName: string): boolean {
  for (const a of ancestors(node)) {
    if (!isScope(a)) continue
    if (a === scope) return false
    if (a.type === 'Module') return false
    if (parameterNamed(a, newName)) return true
    if (a.type !== 'Lambda' && localBindings(a.body).has(newName)) return true
  }
  return false
}

/** One occurrence to rewrite. `node` is absent for a synthesised binding node. */
interface Reference extends OffsetRange {
  /** The AST node the occurrence came from, when it is a real, linked one. */
  node: AnyNode | null
}

/**
 * Every range a rename of `name` in `scope` must rewrite, or null when the
 * reference set cannot be trusted.
 *
 * The exact-text check is the safety net for the bindings `nameUses` reports
 * through a synthesised node — `except OSError as e`, `from x import y as z` —
 * whose range is the whole clause rather than the identifier. If the range does
 * not spell the name, we do not know what rewriting it would do.
 */
function referenceRanges(ctx: RefactorContext, scope: Scope, name: string): Reference[] | null {
  const uses = referencesTo(scope, name)
  if (uses.length === 0) return null

  const ranges: Reference[] = []
  for (const use of uses) {
    const { start, end } = use.node
    if (ctx.src.slice(start, end) !== name) return null
    // A `def`/`class` reports its own name through a synthesised node with no
    // `parent`; it always sits in the scope's own statement nesting, so there
    // is nothing between it and the scope that could shadow the new name.
    ranges.push({ start, end, node: use.node.parent ? use.node : null })
  }

  // A parameter's own declaration is not part of the scope's body, so add it.
  const param = parameterNamed(scope, name)
  if (param) {
    if (param.kind !== 'normal') return null
    if (!ctx.src.startsWith(name, param.start)) return null
    ranges.push({ start: param.start, end: param.start + name.length, node: param })
  }

  // `x += 1` and `del x` each report a read and a write on the same node, so
  // the same range can arrive twice; two identical edits would be rejected as
  // overlapping.
  const seen = new Set<string>()
  const unique = ranges
    .filter((r) => {
      const key = `${r.start}:${r.end}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.start - b.start)

  for (let i = 1; i < unique.length; i++) {
    if (unique[i].start < unique[i - 1].end) return null
  }
  return unique
}

/**
 * The edits that rename `name` to `newName` throughout `scope`, or null when the
 * rename cannot be proved safe.
 *
 * Exported for the editor layer: an interactive rename (a name the user typed
 * into the rename box, rather than the one this rule derives) is this function
 * plus a prompt. It refuses a new name that is not an identifier, that is a
 * Python keyword, or that would collide with something already in scope.
 */
export function renameEdits(
  ctx: RefactorContext,
  scope: Scope,
  name: string,
  newName: string
): TextEdit[] | null {
  if (!IDENTIFIER.test(name) || !IDENTIFIER.test(newName)) return null
  if (newName === name) return null
  if (KEYWORDS.has(newName)) return null
  // `isNameFree` covers the scope's own body; `shadowedOnTheWay` below covers
  // the nested scopes a reference may sit in.
  if (!isNameFree(scope, newName)) return null
  if (parameterNamed(scope, newName)) return null
  if (isDeclaredNonLocal(ctx, name) || isDeclaredNonLocal(ctx, newName)) return null
  if (isImportBinding(scope, name)) return null
  // Both directions: the old spelling inside an f-string is a reference we
  // cannot rewrite, the new one is a reference we would silently repoint.
  if (appearsInFString(scope, name) || appearsInFString(scope, newName)) return null
  // The collision `isNameFree` and `shadowedOnTheWay` are both blind to.
  if (comprehensionBinds(scope, newName)) return null
  // A use of the old spelling that is not in the reference set.
  if (isBareAnnotationTarget(scope, name)) return null
  if (parameterNamed(scope, name) && usedAsKeywordArgument(ctx, name)) return null

  const ranges = referenceRanges(ctx, scope, name)
  if (!ranges) return null
  for (const ref of ranges) {
    if (ref.node && shadowedOnTheWay(ref.node, scope, newName)) return null
  }
  return ranges.map((r) => ({ start: r.start, end: r.end, newText: newName }))
}

export const renameSymbolRule = defineRule<RenameMatch>({
  id: 'rename-symbol',
  title: 'Rename this variable',
  message: 'This name is `camelCase`; the rest of Python (and this file) is `snake_case`',
  catalogue: 90,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-rename-symbol',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<RenameMatch>[] {
    // Selection-driven: the symbol is whatever the cursor is on. The whole-file
    // hint pass has no cursor, and a Problems entry per camelCase name would be
    // nagging rather than help.
    if (!ctx.selection) return []

    const symbol = symbolAt(ctx, ctx.selection.start)
    if (!symbol) return []
    // A class keeps its PascalCase — that IS the convention for a class.
    if (symbol.node.type === 'ClassDef') return []

    const name = symbol.name
    const newName = suggestedName(name)
    if (!newName) return []

    const scope = bindingScopeFor(symbol.node, name)
    // Only a name a `def` owns is provably invisible outside this file.
    if (scope.type !== 'FunctionDef') return []

    // A parameter is named by its callers, so it is renameable only when every
    // caller is in front of us: a closure that never leaves its enclosing `def`.
    if (parameterNamed(scope, name) && escapesEnclosingFunction(scope)) return []

    const edits = renameEdits(ctx, scope, name, newName)
    if (!edits) return []

    return [
      {
        ruleId: 'rename-symbol',
        start: symbol.start,
        end: symbol.end,
        title: `Rename '${name}' to '${newName}'`,
        message: `Rename \`${name}\` to \`${newName}\` — ${edits.length} occurrence${edits.length === 1 ? '' : 's'} in \`${scope.name}\``,
        data: { name, newName, ranges: edits.map((e) => ({ start: e.start, end: e.end })) }
      }
    ]
  },

  apply(match: RefactorMatch<RenameMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { name, newName, ranges } = match.data
    if (ranges.length === 0) return null
    if (!IDENTIFIER.test(newName) || KEYWORDS.has(newName)) return null
    // The ranges were computed against this exact source; if one of them no
    // longer spells the old name, the file moved under us.
    for (const range of ranges) {
      if (ctx.src.slice(range.start, range.end) !== name) return null
    }
    return ranges.map((r) => ({ start: r.start, end: r.end, newText: newName }))
  }
})

/** Exported for the tests that probe the cursor lookup and the heuristic directly. */
export const _internals: {
  symbolAt: typeof symbolAt
  suggestedName: typeof suggestedName
  referenceRanges: typeof referenceRanges
} = { symbolAt, suggestedName, referenceRanges }
