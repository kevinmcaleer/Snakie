/**
 * Rule 28 — **Generate a `__repr__`** (epic #634 §3.5).
 *
 * ```python
 * class Waypoint:                  class Waypoint:
 *     def __init__(self, x, y):        def __init__(self, x, y):
 *         self.x = x                       self.x = x
 *         self.y = y                       self.y = y
 *                              →
 *                                      def __repr__(self):
 *                                          return f"Waypoint(x={self.x!r}, y={self.y!r})"
 * ```
 *
 * Without one, `print(waypoint)` over the REPL prints
 * `<Waypoint object at 20003f10>` — an address that tells a beginner nothing and
 * changes every reset. Debugging a robot mostly happens through that serial
 * console, so a class that can describe itself is worth more here than on a
 * desktop where a debugger is a keystroke away.
 *
 * The generated line uses `!r` so a string attribute keeps its quotes and an
 * empty one is visible at all. MicroPython compiles an f-string down to the
 * `str.format` call it is equivalent to, and its `format` implements the `!r`
 * conversion, so this runs on the board exactly as it does on the desktop.
 *
 * Only attributes assigned **directly** in `__init__` are listed, and only when
 * the value assigned is a pure expression — a parameter, a literal, another
 * attribute, arithmetic over those. `self.pwm = PWM(Pin(16))` is skipped: the
 * interesting part of a hardware handle is not its `repr`, and a class whose
 * `__init__` only wires up peripherals gets no offer at all. Dunder-prefixed
 * names (`self.__secret`) are skipped too, since name mangling means
 * `self.__secret` inside the class is really `self._Class__secret`.
 *
 * Declines when the class already has a `__repr__` (nothing to add), when
 * nothing qualifies, or when the generated line would run past 100 characters —
 * a `__repr__` you have to scroll sideways to read is not an improvement, and
 * choosing which attributes to drop is a judgement call the rule will not make
 * on the user's behalf.
 */
import type { AnyNode, ClassDef, FunctionDef, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { isPureExpression } from '../expr'
import type { TextEdit } from '../text'
import { indentAt, lineEnd, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ReprMatch {
  cls: ClassDef
  /** Attribute names, in the order `__init__` assigns them. */
  attrs: string[]
}

/** The widest generated line we are willing to write. */
const MAX_LINE = 100

/** A direct child method of the class with this name. */
function methodNamed(cls: ClassDef, name: string): FunctionDef | null {
  for (const stmt of cls.body) {
    if (stmt.type === 'FunctionDef' && stmt.name === name) return stmt
  }
  return null
}

/**
 * Attribute names `__init__` assigns to `self` at the top level of its body.
 *
 * Deliberately not recursive: an assignment inside an `if` or a `for` may never
 * run, and a `__repr__` that raises `AttributeError` is worse than none.
 */
function initialisedAttributes(init: FunctionDef): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const stmt of init.body as Stmt[]) {
    if (stmt.type !== 'Assign') continue
    // A call may return a peripheral, a socket or a buffer; none of those read
    // well in a repr, and evaluating one is not what a repr is for.
    if (!isPureExpression(stmt.value)) continue
    for (const target of stmt.targets) {
      const e = unwrap(target)
      if (e.type !== 'Attribute') continue
      const base = unwrap(e.value)
      if (base.type !== 'Name' || base.id !== 'self') continue
      // Name mangling makes `self.__x` a different attribute outside the class.
      if (e.attr.startsWith('__')) continue
      if (seen.has(e.attr)) continue
      seen.add(e.attr)
      out.push(e.attr)
    }
  }
  return out
}

/**
 * How many blank lines the class already puts between two methods, so the
 * generated one is spaced like its neighbours rather than to our taste.
 */
function blankLinesBetweenMethods(ctx: RefactorContext, cls: ClassDef): number {
  for (let i = cls.body.length - 1; i > 0; i--) {
    if (cls.body[i].type !== 'FunctionDef') continue
    const gapStart = lineEnd(ctx.src, cls.body[i - 1].end)
    const gapEnd = lineStart(ctx.src, cls.body[i].start)
    if (gapStart >= gapEnd) return 0
    const lines = ctx.src.slice(gapStart, gapEnd).split('\n')
    // The split's last element is the empty tail after the final newline.
    let blank = 0
    for (let k = 0; k < lines.length - 1; k++) {
      if (/^[ \t\r]*$/.test(lines[k])) blank++
    }
    return Math.min(blank, 2)
  }
  return 1
}

/** The `return f"…"` line the rewrite would add, for the length check and the edit. */
function reprLine(ctx: RefactorContext, cls: ClassDef, attrs: readonly string[]): string {
  const bodyIndent = indentAt(ctx.src, cls.body[0].start) + ctx.indentUnit
  const fields = attrs.map((a) => `${a}={self.${a}!r}`).join(', ')
  return `${bodyIndent}return f"${cls.name}(${fields})"`
}

export const generateReprRule = defineRule<ReprMatch>({
  id: 'generate-repr',
  title: 'Generate a __repr__',
  message: 'This class has no `__repr__`, so printing one shows only a memory address',
  catalogue: 28,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-generate-repr',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ReprMatch>[] {
    const out: RefactorMatch<ReprMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'ClassDef') return
      if (node.body.length === 0) return
      if (methodNamed(node, '__repr__')) return
      const init = methodNamed(node, '__init__')
      if (!init) return

      const attrs = initialisedAttributes(init)
      if (attrs.length === 0) return
      // A line nobody can read on a 100-column terminal is not a tidy-up.
      if (reprLine(ctx, node, attrs).length > MAX_LINE) return

      out.push({
        ruleId: 'generate-repr',
        start: node.defStart,
        end: node.nameStart + node.name.length,
        data: { cls: node, attrs }
      })
    })

    return out
  },

  apply(match: RefactorMatch<ReprMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { cls, attrs } = match.data
    if (cls.body.length === 0 || attrs.length === 0) return null

    const defIndent = indentAt(ctx.src, cls.body[0].start)
    const line = reprLine(ctx, cls, attrs)
    if (line.length > MAX_LINE) return null

    const at = lineEnd(ctx.src, cls.end)
    // A file with no trailing newline would otherwise glue the new `def` onto
    // the last line of the class.
    const lead = at > 0 && ctx.src[at - 1] !== '\n' ? ctx.eol : ''
    const gap = ctx.eol.repeat(blankLinesBetweenMethods(ctx, cls))

    return [
      {
        start: at,
        end: at,
        newText: `${lead}${gap}${defIndent}def __repr__(self):${ctx.eol}${line}${ctx.eol}`
      }
    ]
  }
})

/** Exported for the tests that probe the attribute scan directly. */
export const _internals: { initialisedAttributes: typeof initialisedAttributes } = {
  initialisedAttributes
}
