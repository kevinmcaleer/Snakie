/**
 * Rule 27 — **This class could just be a function** (epic #634 §3.5, §3.8).
 *
 * ```python
 * # before — a class that holds nothing and does one thing
 * class Debouncer:
 *     def __init__(self):
 *         pass
 *
 *     def settled(self, pin, samples, gap_ms):
 *         ...
 *
 * reading = Debouncer().settled(button, 5, 10)
 *
 * # after
 * def settled(pin, samples, gap_ms):
 *     ...
 *
 * reading = settled(button, 5, 10)
 * ```
 *
 * A class with no state is a function wearing a costume. Every caller has to
 * build an instance that remembers nothing, purely so it can reach the one
 * method it wanted, and the reader has to check the whole class body before they
 * can be sure there is no hidden state to worry about.
 *
 * On a microcontroller the costume also has a price: the type object lives in
 * flash, every `Debouncer()` allocates an instance (and an instance dict, unless
 * you remembered `__slots__`), and the method lookup goes through the type on
 * each call. A module-level `def` costs one object, once. None of that matters
 * on a desktop, which is why this is worth saying out loud here.
 *
 * This is **hint only**: turning the method into a function moves it out of the
 * class's namespace, and every caller — including callers in files this engine
 * cannot see, on the board's filesystem or in a plugin — has to move with it.
 * `apply` returns null; the panel shows the explanation and the "Why?" article.
 *
 * Deliberately narrow, because "this class is pointless" is a rude thing to say
 * wrongly:
 *
 * - exactly **one** method besides `__init__`, and at most one `__init__`;
 * - no base other than `object`, no `metaclass=`, and **nothing in the file may
 *   subclass it** — an abstract base whose one method is `raise
 *   NotImplementedError` is the most stateless class there is, and also the one
 *   you must not delete;
 * - the body may hold nothing but methods, a docstring and `pass`; a class
 *   attribute, a nested class or a `__slots__` line all mean it is carrying
 *   something;
 * - **no decorator, on the class or on any method.** A decorator can register
 *   the class, wrap it, or replace it outright, and `@property` in particular
 *   makes the method part of the instance's *attribute* surface, so lifting it
 *   out turns `v.millivolts` into `millivolts()` at every call site;
 * - the one method is not a dunder. `__call__`, `__getitem__`, `__enter__` and
 *   friends are protocol slots: the class exists precisely so `obj(x)` or
 *   `obj[i]` or `with obj:` works, and a plain function cannot be any of those;
 * - no method touches the instance except to call itself recursively — a class
 *   that grows its state lazily on first use still has state, even though
 *   `__init__` never mentions it.
 *
 * The instance is found through each method's **first parameter**, not through
 * the literal name `self`. `self` is a convention rather than a keyword, and a
 * hard-coded name makes the whole state analysis blind to `def __init__(s,
 * pin): s.led = Pin(pin)` — a class that plainly holds a pin, which the rule
 * would otherwise announce as holding no state at all. A method with no
 * parameters (so no receiver to follow) is something we decline to reason about.
 */
import type { AnyNode, ClassDef, Expr, FunctionDef, Module, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { isDocstring } from './guard-clause'

interface StatelessClassMatch {
  cls: ClassDef
  /** The one method that is not `__init__` — the function hiding in there. */
  method: FunctionDef
  /** The `__init__`, when the class bothers to have one. */
  init: FunctionDef | null
}

/** `class Thing:` and `class Thing(object):` are the same class. */
function inheritsNothing(cls: ClassDef): boolean {
  if (cls.keywords.length > 0) return false
  return cls.bases.every((base: Expr) => {
    const e = unwrap(base)
    return e.type === 'Name' && e.id === 'object'
  })
}

/**
 * True when the body holds nothing but methods (plus a docstring and `pass`).
 *
 * Anything else — `LIMIT = 40`, `__slots__ = ()`, a nested class, an `if` that
 * picks between two implementations — is the class carrying something, which is
 * the opposite of the smell.
 */
function bodyIsMethodsOnly(cls: ClassDef): boolean {
  return cls.body.every(
    (stmt: Stmt) => stmt.type === 'FunctionDef' || stmt.type === 'Pass' || isDocstring(stmt)
  )
}

/** `__call__`, `__getitem__`, `__enter__`… — a protocol slot, not a method. */
function isDunder(name: string): boolean {
  return name.length > 4 && name.startsWith('__') && name.endsWith('__')
}

/**
 * The name this method binds the instance to — its first parameter, whatever
 * the author called it. Null when there is nothing to follow.
 */
function receiverName(fn: FunctionDef): string | null {
  const first = fn.params[0]
  if (!first || first.kind !== 'normal') return null
  return first.name
}

/** What a class does with its own instance. */
interface SelfUses {
  /**
   * Attributes reached through the receiver in any way other than calling
   * them: `self.total = …` writes state, `self.limit` reads it, and
   * `cb = self.step` hands the bound method somewhere else. All disqualifying.
   */
  touched: Set<string>
  /** Attributes that were only ever *called*: `self.step(dt)`. */
  called: Set<string>
  /** The receiver used as a value in its own right — `return self`, `f(self)`. */
  bare: boolean
  /** A method we could not follow, because it has no receiver parameter. */
  opaque: boolean
}

/**
 * Everything the class does with its instance, one method at a time.
 *
 * Split into *touched* and *called* because the single use we forgive is the
 * method calling itself, and `self.step(dt)` is that whereas `self.step = 5` —
 * the lazy-cache trick, where the first call replaces the method with its own
 * answer — is state wearing the method's name.
 */
function selfUses(cls: ClassDef): SelfUses {
  const out: SelfUses = { touched: new Set(), called: new Set(), bare: false, opaque: false }

  for (const stmt of cls.body) {
    if (stmt.type !== 'FunctionDef') continue
    const receiver = receiverName(stmt)
    if (receiver == null) {
      out.opaque = true
      continue
    }

    const visit = (node: AnyNode): void | false => {
      if (node.type === 'Call') {
        const fn = unwrap(node.func)
        if (fn.type === 'Attribute') {
          const base = unwrap(fn.value)
          if (base.type === 'Name' && base.id === receiver) {
            out.called.add(fn.attr)
            // Account for `self.step` here, then carry on into the arguments —
            // `self.step(self.other)` must still see the inner read.
            for (const arg of node.args) walk(arg, visit)
            for (const kw of node.keywords) walk(kw, visit)
            return false
          }
        }
        return undefined
      }
      if (node.type === 'Attribute') {
        const base = unwrap(node.value)
        if (base.type === 'Name' && base.id === receiver) {
          out.touched.add(node.attr)
          // Counted here, so the Name below is not also a bare use.
          return false
        }
        return undefined
      }
      if (node.type === 'Name' && node.id === receiver) out.bare = true
      return undefined
    }

    walk(stmt as AnyNode, visit)
  }

  return out
}

/**
 * Every name this module inherits from, however it is spelled. A class that
 * something else subclasses is load-bearing even when it holds nothing.
 */
function subclassedNames(module: Module): Set<string> {
  const out = new Set<string>()
  walk(module as AnyNode, (node) => {
    if (node.type !== 'ClassDef') return
    const record = (expr: Expr): void => {
      const e = unwrap(expr)
      if (e.type === 'Name') out.add(e.id)
      else if (e.type === 'Attribute') out.add(e.attr)
    }
    for (const base of node.bases) record(base)
    // `metaclass=Meta` and friends name a class too.
    for (const kw of node.keywords) record(kw.value)
  })
  return out
}

export const statelessClassRule = defineRule<StatelessClassMatch>({
  id: 'stateless-class',
  title: 'This class could just be a function',
  message: 'This class holds no state — its one method would read better as a plain function',
  catalogue: 27,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-stateless-class',
  // Not batchable by "Tidy this file": there is no rewrite to batch.
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<StatelessClassMatch>[] {
    const out: RefactorMatch<StatelessClassMatch>[] = []
    const subclassed = subclassedNames(ctx.module)

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'ClassDef') return
      // A decorator can register the class, wrap it, or replace it outright, so
      // we have no idea any more what removing it would mean.
      if (node.decorators.length > 0) return
      if (!inheritsNothing(node)) return
      if (!bodyIsMethodsOnly(node)) return
      // Something in this file inherits from it, so it is a base class doing its
      // job — the emptier it is, the more likely that is the whole point.
      if (subclassed.has(node.name)) return

      const methods = node.body.filter((s: Stmt): s is FunctionDef => s.type === 'FunctionDef')
      const inits = methods.filter((m) => m.name === '__init__')
      const others = methods.filter((m) => m.name !== '__init__')
      // Exactly one job besides construction. Two methods that share nothing are
      // still worth splitting up, but that is a different conversation.
      if (others.length !== 1) return
      // A second `__init__` means a later `def` silently wins; we would be
      // reasoning about code that is already surprising.
      if (inits.length > 1) return
      // Same argument as the class decorator, one level down: `@property`,
      // `@classmethod`, `@staticmethod` and every registration decorator change
      // what the method *is*, and therefore what lifting it out would mean.
      if (methods.some((m) => m.decorators.length > 0)) return

      const method = others[0]
      // A protocol slot only works from inside a class; `obj[i]` cannot call a
      // module-level `__getitem__`.
      if (isDunder(method.name)) return

      const { touched, called, bare, opaque } = selfUses(node)
      if (bare || opaque) return
      // Nothing may be read from or written to the instance at all…
      if (touched.size > 0) return
      // …and the only thing that may be *called* on it is the method itself.
      for (const name of called) {
        if (name !== method.name) return
      }

      out.push({
        ruleId: 'stateless-class',
        // Point at `class Thing` — the header, not the whole body, which would
        // paint a marker over every line the reader is trying to read.
        start: node.defStart,
        end: node.nameStart + node.name.length,
        message: `\`${node.name}\` holds no state — \`${method.name}\` would read better as a plain function`,
        data: { cls: node, method, init: inits.length === 1 ? inits[0] : null }
      })
    })

    return out
  },

  /**
   * There is no automatic rewrite (§2.6.6). Lifting the method out of the class
   * renames it for every caller, including the ones in files the engine cannot
   * see, so the move stays with the person who knows who calls it.
   */
  apply(): TextEdit[] | null {
    return null
  }
})

/** Exported for the tests that probe the state analysis directly. */
export const _internals: { selfUses: typeof selfUses } = { selfUses }
