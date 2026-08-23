/**
 * Rule 26 — **Turn the getter and setter into a property** (epic #634 §3.5).
 *
 * ```python
 * class Servo:                     class Servo:
 *     def get_angle(self):             @property
 *         return self._angle           def angle(self):
 *                                          return self._angle
 *     def set_angle(self, value):
 *         self._angle = value          @angle.setter
 *                              →       def angle(self, value):
 * s.set_angle(90)                          self._angle = value
 * print(s.get_angle())
 *                                  s.angle = 90
 *                                  print(s.angle)
 * ```
 *
 * Java-style accessor pairs are the commonest thing people bring with them into
 * Python. A property gets the same encapsulation — the setter still runs, so it
 * can clamp the angle or kick the PWM — while the call site reads like the plain
 * attribute it conceptually is.
 *
 * **This rule is `safe: false`, and that is not a formality.** Renaming the two
 * methods breaks *every* caller: `s.get_angle()` has to become `s.angle`, and
 * `s.set_angle(90)` has to become `s.angle = 90`. The engine can only see one
 * file, so callers in another module — or on the board's filesystem, or in a
 * plugin — are invisible to it and will raise `AttributeError` the next time
 * they run. That is why "Tidy this file" never batches this one, and why the
 * match message says so out loud before anybody clicks it.
 *
 * Declined when: the class already has a member of the property's name (the
 * rewrite would shadow it); the setter is written *before* the getter (the
 * `@angle.setter` decorator needs `angle` to already exist at that point in the
 * class body); either method carries a decorator of its own; or the two are not
 * demonstrably a pair — the getter must return the attribute the setter writes,
 * and the setter must actually use its value parameter.
 */
import type { AnyNode, Assign, ClassDef, FunctionDef, Return, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { KEYWORDS } from '../lexer'
import type { TextEdit } from '../text'
import { indentAt, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface PropertyMatch {
  getter: FunctionDef
  setter: FunctionDef
  /** The property name — the getter's name without its `get_` prefix. */
  prop: string
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A plain `def name(...)` with no decorators of its own, and not `async`. */
function isPlainMethod(fn: Stmt): fn is FunctionDef {
  return fn.type === 'FunctionDef' && fn.decorators.length === 0 && !fn.isAsync
}

/** Parameter names, when every parameter is an ordinary positional one. */
function positionalParams(fn: FunctionDef): string[] | null {
  if (fn.params.some((p) => p.kind !== 'normal' || p.default || p.annotation)) return null
  return fn.params.map((p) => p.name)
}

/** Every attribute of `self` read anywhere in this subtree. */
function selfAttributesIn(node: AnyNode): Set<string> {
  const out = new Set<string>()
  walk(node, (n) => {
    if (n.type !== 'Attribute') return
    const base = unwrap(n.value)
    if (base.type === 'Name' && base.id === 'self') out.add(n.attr)
  })
  return out
}

/** Is `name` read anywhere in this subtree? */
function readsName(node: AnyNode, name: string): boolean {
  let found = false
  walk(node, (n) => {
    if (n.type === 'Name' && n.id === name) found = true
  })
  return found
}

/** How many times each method name appears in the class body. */
function methodCounts(cls: ClassDef): Map<string, number> {
  const out = new Map<string, number>()
  for (const stmt of cls.body) {
    if (stmt.type === 'FunctionDef') out.set(stmt.name, (out.get(stmt.name) ?? 0) + 1)
  }
  return out
}

/** Every name the class body already binds: methods, class attributes, nested classes. */
function classMembers(cls: ClassDef): Set<string> {
  const out = new Set<string>()
  for (const stmt of cls.body) {
    if (stmt.type === 'FunctionDef' || stmt.type === 'ClassDef') out.add(stmt.name)
    else if (stmt.type === 'Assign') {
      for (const t of stmt.targets) {
        const e = unwrap(t)
        if (e.type === 'Name') out.add(e.id)
      }
    } else if (stmt.type === 'AnnAssign') {
      const e = unwrap(stmt.target)
      if (e.type === 'Name') out.add(e.id)
    }
  }
  return out
}

/** `def get_x(self): return <expr containing self.attr>` — the attribute, or null. */
function getterShape(fn: FunctionDef): { ret: Return; attrs: Set<string> } | null {
  const params = positionalParams(fn)
  if (!params || params.length !== 1 || params[0] !== 'self') return null
  if (fn.body.length !== 1) return null
  const only = fn.body[0]
  if (only.type !== 'Return' || !only.value) return null
  return { ret: only, attrs: selfAttributesIn(only.value) }
}

/** `def set_x(self, value): self.<attr> = <expr using value>` — the attribute, or null. */
function setterShape(fn: FunctionDef): { assign: Assign; attr: string } | null {
  const params = positionalParams(fn)
  if (!params || params.length !== 2 || params[0] !== 'self') return null
  if (fn.body.length !== 1) return null
  const only = fn.body[0]
  if (only.type !== 'Assign' || only.targets.length !== 1) return null
  const target = unwrap(only.targets[0])
  if (target.type !== 'Attribute') return null
  const base = unwrap(target.value)
  if (base.type !== 'Name' || base.id !== 'self') return null
  // The stored value has to come from the parameter, or these two methods are
  // not the accessor pair they look like.
  if (!readsName(only.value, params[1])) return null
  return { assign: only, attr: target.attr }
}

export const usePropertyRule = defineRule<PropertyMatch>({
  id: 'use-property',
  title: 'Turn the getter and setter into a property',
  message:
    'A `get_`/`set_` pair reads better as a property — but every caller must change too, ' +
    'from `obj.get_x()` to `obj.x`',
  catalogue: 26,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-property',
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<PropertyMatch>[] {
    const out: RefactorMatch<PropertyMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'ClassDef') return
      const members = classMembers(node)
      const counts = methodCounts(node)

      for (let i = 0; i < node.body.length; i++) {
        const getter = node.body[i]
        if (!isPlainMethod(getter)) continue
        const prefix = /^get_(.+)$/.exec(getter.name)
        if (!prefix) continue
        const prop = prefix[1]
        // `get_2nd` would yield `2nd`, and `get_class` a keyword — neither can
        // be a method name.
        if (!IDENTIFIER.test(prop) || KEYWORDS.has(prop)) continue
        // Shadowing an existing member would change what the class exposes.
        if (members.has(prop)) continue

        const got = getterShape(getter)
        if (!got) continue

        // The setter must come LATER in the body: `@<prop>.setter` refers to the
        // property object the getter's `@property` just created.
        for (let j = i + 1; j < node.body.length; j++) {
          const setter = node.body[j]
          if (!isPlainMethod(setter) || setter.name !== `set_${prop}`) continue
          const set = setterShape(setter)
          if (!set) break
          if (!got.attrs.has(set.attr)) break
          // A name defined twice in one class body means a later `def` wins.
          // Rewriting only one of them would silently change which code runs.
          if ((counts.get(getter.name) ?? 0) > 1 || (counts.get(setter.name) ?? 0) > 1) break
          out.push({
            ruleId: 'use-property',
            start: getter.nameStart,
            end: getter.nameStart + getter.name.length,
            data: { getter, setter, prop }
          })
          break
        }
      }
    })

    return out
  },

  apply(match: RefactorMatch<PropertyMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { getter, setter, prop } = match.data
    const getterLine = lineStart(ctx.src, getter.start)
    const setterLine = lineStart(ctx.src, setter.start)
    if (setterLine <= getter.nameStart) return null

    const getIndent = indentAt(ctx.src, getter.start)
    const setIndent = indentAt(ctx.src, setter.start)

    return [
      { start: getterLine, end: getterLine, newText: `${getIndent}@property${ctx.eol}` },
      { start: getter.nameStart, end: getter.nameStart + getter.name.length, newText: prop },
      { start: setterLine, end: setterLine, newText: `${setIndent}@${prop}.setter${ctx.eol}` },
      { start: setter.nameStart, end: setter.nameStart + setter.name.length, newText: prop }
    ]
  }
})

/** Exported for the tests that probe the accessor-shape matchers directly. */
export const _internals: {
  getterShape: typeof getterShape
  setterShape: typeof setterShape
} = { getterShape, setterShape }
