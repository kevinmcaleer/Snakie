/**
 * Rule 25 — **Group these parameters into an object** (epic #634 §3.5, §3.8).
 *
 * ```python
 * # before — the call site is a row of anonymous numbers
 * def configure_drive(left_pin, right_pin, freq, min_duty, max_duty, deadband):
 *     ...
 *
 * configure_drive(14, 15, 50, 1638, 8192, 40)
 *
 * # after — one thing, with names on its parts
 * class DriveConfig:
 *     __slots__ = ("left_pin", "right_pin", "freq", "min_duty", "max_duty", "deadband")
 *
 *     def __init__(self, left_pin, right_pin, freq, min_duty, max_duty, deadband):
 *         self.left_pin = left_pin
 *         ...
 *
 * def configure_drive(config):
 *     ...
 * ```
 *
 * A long parameter list is a memory test. `configure_drive(14, 15, 50, 1638,
 * 8192, 40)` cannot be read without opening the `def`, and swapping two of those
 * numbers is a bug the interpreter will never catch — it just drives wrong.
 * Parameters that always travel together are usually one idea that has not been
 * given a name yet, and naming it shortens every call and every future signature
 * change.
 *
 * **The MicroPython answer is not a dataclass.** Every desktop-Python article
 * ends this refactoring with `@dataclass`, and that advice does not survive the
 * trip to a board: `dataclasses` is not in the firmware, it is a micropython-lib
 * package you have to install onto the device, and importing it costs RAM you
 * were probably short of already. What fits here is a small plain class with
 * `__slots__` — the slots are the point, since they replace the per-instance
 * dict with a fixed set of fields and save the bytes that made the class look
 * expensive in the first place — or, when the group really is just a handful of
 * values, a plain tuple unpacked at the top of the function. That gap between
 * the desktop advice and what actually runs on the board is exactly the kind of
 * thing this catalogue exists to teach.
 *
 * This one is **hint only**. *Which* parameters belong together, what the object
 * is called, and whether it is a config, a pose or a pin bundle are design
 * decisions about this program, and picking one silently would rewrite every
 * call site on a guess. `apply` returns null — the panel shows the explanation
 * and the "Why?" article, never a diff.
 *
 * The threshold is `ctx.settings.maxParameters` (5 by default), and what counts
 * is exactly what the epic's example makes unreadable: **the values the caller
 * has to type, in order, with no name attached.** So the count leaves out
 *
 * - `*args` / `**kwargs`, one idea each however many values they carry, and the
 *   `/` and `*` separators, which are punctuation rather than parameters;
 * - anything after `*` or `*args`, because a keyword-only argument arrives at
 *   the call site already labelled — `publish(t, p, qos=1, retain=True)` is the
 *   opposite of the row of anonymous numbers this rule is about;
 * - anything with a default, because the caller can simply leave it out. A
 *   driver whose `__init__` ends in six optional tuning knobs is called
 *   `SSD1306(i2c)`, and telling its author to bundle the knobs into an object
 *   would be answering a question nobody asked;
 * - the implicit receiver of a method — `self`, `cls`, or whatever the author
 *   happened to call it — which is bound by the call rather than written at it.
 *
 * That receiver is found **by position, not by name**: the first parameter of a
 * `def` sitting directly in a `class` body, unless the method is a
 * `@staticmethod` and therefore has no receiver at all. `self` is a convention,
 * not a keyword, and a name test gets it wrong in both directions — it drops a
 * real parameter from a module-level `def draw(self, …)` and it keeps the
 * receiver of `def reach(s, …)`, which then gets underlined as something to
 * bundle into an object.
 */
import type { AnyNode, Expr, FunctionDef, Param } from '../ast'
import { unwrap, walk } from '../ast'
import type { TextEdit } from '../text'
import { DEFAULT_SETTINGS, defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ParameterObjectMatch {
  fn: FunctionDef
  /** The parameters the caller actually has to supply, in source order. */
  counted: Param[]
}

/**
 * True when the nearest enclosing *scope* is a class, so this `def` is a method
 * and its first parameter is the receiver.
 *
 * The climb matters: a driver that picks an implementation per board writes the
 * `def` inside an `if` in the class body, and that method's parent is the `if`.
 * Stopping at the first scope-forming node keeps a `def` nested inside another
 * `def` — where the first parameter is an ordinary argument — out of it.
 */
function isMethod(fn: FunctionDef): boolean {
  let cur = fn.parent
  while (cur) {
    if (cur.type === 'ClassDef') return true
    if (cur.type === 'FunctionDef' || cur.type === 'Lambda' || cur.type === 'Module') return false
    cur = cur.parent
  }
  return false
}

/**
 * True when a `@staticmethod` decorator is present — the one kind of method
 * whose first parameter really is the caller's to supply.
 *
 * `staticmethod` and `builtins.staticmethod` are both spellings we understand;
 * anything else leaves the receiver where it is, which is the safe direction.
 */
function isStaticMethod(fn: FunctionDef): boolean {
  return fn.decorators.some((d: Expr) => {
    const e = unwrap(d)
    if (e.type === 'Name') return e.id === 'staticmethod'
    if (e.type === 'Attribute') return e.attr === 'staticmethod'
    return false
  })
}

/**
 * The parameters that make a call site hard to read: the required, positional,
 * unlabelled ones the caller must type in the right order.
 *
 * See the module docstring for why each exclusion is there. The loop walks the
 * list in order because "keyword-only" is a *position* — everything after a `*`
 * or a `*args` — rather than a property the parser records on the parameter.
 */
function countedParams(fn: FunctionDef): Param[] {
  const out: Param[] = []
  const dropsReceiver = isMethod(fn) && !isStaticMethod(fn)
  let keywordOnly = false

  fn.params.forEach((p: Param, index: number) => {
    // `*` and `*args` both open the keyword-only section; `**kwargs` closes the
    // list. None of the three is a value typed positionally at the call site.
    if (p.kind === 'vararg' || p.kind === 'kwonly-marker') {
      keywordOnly = true
      return
    }
    if (p.kind !== 'normal') return
    if (keywordOnly) return
    // A default makes the parameter optional, so it is not on the row of
    // numbers the caller has to get right.
    if (p.default) return
    // The receiver can only be the very first entry: Python does not allow a
    // marker before it.
    if (index === 0 && dropsReceiver) return
    out.push(p)
  })

  return out
}

export const parameterObjectRule = defineRule<ParameterObjectMatch>({
  id: 'parameter-object',
  title: 'Group these parameters into an object',
  message:
    'This function takes a lot of parameters — the ones that travel together could be one object',
  catalogue: 25,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-parameter-object',
  // Not batchable by "Tidy this file": there is no rewrite to batch.
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<ParameterObjectMatch>[] {
    const out: RefactorMatch<ParameterObjectMatch>[] = []
    // A threshold of zero would flag every function in the file, which teaches
    // nobody anything; one parameter is the smallest list worth mentioning.
    // A non-number gets the default rather than propagating: `Math.max(1, NaN)`
    // is NaN, every `length <= NaN` is false, and the rule would then underline
    // the parameters of every function in the file.
    const configured = ctx.settings.maxParameters
    const threshold = Number.isFinite(configured)
      ? Math.max(1, Math.floor(configured))
      : DEFAULT_SETTINGS.maxParameters

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      const counted = countedParams(node)
      if (counted.length <= threshold) return
      out.push({
        ruleId: 'parameter-object',
        // Underline the parameter list itself: that is the thing to change, and
        // it keeps the marker off the body the reader is trying to read.
        start: counted[0].start,
        end: counted[counted.length - 1].end,
        message: `\`${node.name}\` takes ${counted.length} parameters — the ones that travel together could be one object`,
        data: { fn: node, counted }
      })
    })

    return out
  },

  /**
   * There is no automatic rewrite (§2.6.6). Choosing what the object *is* — and
   * therefore what every call site becomes — is a design decision, and a tool
   * that guessed it would be reshaping an API on the user's behalf.
   */
  apply(): TextEdit[] | null {
    return null
  }
})

/** Exported for the tests that probe the parameter count directly. */
export const _internals: { countedParams: typeof countedParams } = { countedParams }
