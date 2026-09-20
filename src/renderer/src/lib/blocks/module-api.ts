import { logicalLines } from './python-tokens'

/**
 * WHAT A MODULE CONTAINS (#1048, epic #1007).
 * =============================================================================
 *
 * Open a real driver program in the Blocks workspace and it converts perfectly —
 * ten blocks, no warnings, byte-exact round trip — and offers you nothing. The
 * `oled.text("hello", 0, 0)` lines become raw Python blocks the learner can drag
 * but cannot author more of, except by typing a method name from memory into
 * #1018's generic call block. That is the right FLOOR and a poor CEILING.
 *
 * This reads the module's own source and says what is in it: classes, their
 * methods, module-level functions, and the constants worth having. From that,
 * `module-blocks.ts` builds real blocks with real parameter names.
 *
 * PARSING ONLY. NEVER IMPORTING. The one rule this file exists under: a module a
 * learner downloaded is a file of somebody else's code, and `import`ing it on
 * the host to introspect it would execute it. So this is the #1019 lexer and
 * nothing else — the same lexer the Python→blocks converter is built on, which
 * is already the answer to "why is there no AST here".
 *
 * It follows that everything below is a BEST EFFORT over text. A driver that
 * builds its API in a loop with `setattr` is invisible to it; that is what the
 * board-side `dir()` tier is for, and it is not this file.
 */

/** One parameter of a function or method. */
export interface ApiParam {
  name: string
  /** The default as written, e.g. `0x3C`. Absent means required. */
  default?: string
  /** `*args` / `**kwargs` — cannot become a socket. */
  variadic?: boolean
}

/** A function, or a method when it belongs to a class. */
export interface ApiFunction {
  name: string
  params: readonly ApiParam[]
  /**
   * It `return`s something, so it is a VALUE — `ping.distance()` goes in a
   * socket, `oled.show()` stands on a line of its own. Read off the body: a
   * `return` with an expression after it, anywhere in the function. Absent
   * means no such line was seen, which is the honest reading of a method that
   * only does things.
   */
  returns?: boolean
}

/** A class, with the methods worth offering. */
export interface ApiClass {
  name: string
  /** What it inherits, as written. Kept because it often names the real API. */
  bases: readonly string[]
  /** `__init__`'s parameters, `self` already dropped. Absent if it defines none. */
  init?: readonly ApiParam[]
  methods: readonly ApiFunction[]
  /**
   * The names read off the object without calling anything: a `@property`,
   * and every public `self.name = …` in `__init__`. `ping.unit` is one of these,
   * and it is not a method — a block that wrote `ping.unit()` would raise.
   */
  properties: readonly string[]
  /**
   * The subset of {@link ApiClass.properties} a program may ASSIGN to: an
   * `__init__` attribute, or a `@property` the class also gives a `.setter`.
   *
   * Kept apart because writing to a getter-only `@property` raises at runtime,
   * and a *set … to …* block offering one would be a block whose only outcome
   * is an `AttributeError`.
   */
  settable: readonly string[]
}

/** Everything a module offers, as far as reading it can tell. */
export interface ModuleApi {
  /** The importable name — `ssd1306`, not the file path. */
  module: string
  classes: readonly ApiClass[]
  functions: readonly ApiFunction[]
  /** Module-level `UPPER_CASE = …` names, which are the constants worth having. */
  constants: readonly string[]
  /**
   * Every OTHER public module-level assignment — `i2c = I2C(0)`, `_buf` aside.
   * Not offered as blocks (state is not an API), but the Modules shelf lists
   * them so a learner can see what a file on the board or in their folder holds.
   */
  variables: readonly string[]
}

/** Is this name part of the module's public face? */
function isPublic(name: string): boolean {
  return !name.startsWith('_')
}

/**
 * Split a parameter list as written, respecting nesting.
 *
 * `text(self, s, x, y, col=1)` is easy; `f(a, b=(1, 2), *rest)` is why this
 * counts brackets rather than splitting on commas.
 */
export function splitParams(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(from, i))
      from = i + 1
    }
  }
  out.push(text.slice(from))
  return out.map((p) => p.trim()).filter((p) => p !== '')
}

/**
 * One parameter, as the block needs to know it.
 *
 * A TYPE ANNOTATION IS DROPPED rather than kept, and that is deliberate: the
 * blocks cannot check types anyway (every socket is `any`), and `x: int = 0`
 * would otherwise arrive with the annotation glued to the name.
 */
export function readParam(text: string): ApiParam | null {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '/' || trimmed === '*') return null
  const variadic = trimmed.startsWith('*')
  const bare = trimmed.replace(/^\**/, '')
  const eq = splitOnDefault(bare)
  const name = eq.name.split(':')[0].trim()
  if (!/^[A-Za-z_]\w*$/.test(name)) return null
  const param: ApiParam = { name }
  if (variadic) param.variadic = true
  if (eq.value !== null) param.default = eq.value.trim()
  return param
}

/** `addr: int = 0x3C` → name `addr: int`, value `0x3C`. Nesting-aware. */
function splitOnDefault(text: string): { name: string; value: string | null } {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    else if (ch === '=' && depth === 0 && text[i - 1] !== '=' && text[i + 1] !== '=') {
      return { name: text.slice(0, i), value: text.slice(i + 1) }
    }
  }
  return { name: text, value: null }
}

/** `def text(self, s, x, y, col=1):` → the function, or null. */
function readDef(text: string): ApiFunction | null {
  const m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*(?:->[^:]*)?:$/.exec(text)
  if (!m) return null
  const params = splitParams(m[2])
    .map(readParam)
    .filter((p): p is ApiParam => p !== null)
  return { name: m[1], params }
}

/**
 * Read a module's public API out of its source.
 *
 * The indent tells us what belongs to what, exactly as it does in
 * `python-to-blocks.ts`: a `def` at column 0 is a module function, and a `def`
 * indented under a `class` is one of its methods.
 *
 * `_private` names are skipped throughout — except `__init__`, which is not
 * private at all, it is how the class is built, and it is the single most useful
 * thing in the file.
 *
 * THE BODY IS READ TOO, for two facts a signature cannot give: a method with a
 * `return <expr>` in it is a VALUE, and a `self.name = …` in `__init__` is a
 * PROPERTY — as is a `@property` def. Both matter to the shape of the block:
 * `ping.distance()` has to fit inside a `print`, and `ping.unit` must not
 * come out as `ping.unit()`.
 */
export function readModuleApi(module: string, source: string): ModuleApi {
  const classes: ApiClass[] = []
  const functions: ApiFunction[] = []
  const constants: string[] = []
  const variables: string[] = []
  const lines = logicalLines(source)

  let current: {
    def: ApiClass
    methods: ApiFunction[]
    properties: string[]
    settable: string[]
    indent: number
  } | null = null
  // The function whose body we are inside, for the two things a body tells us:
  // whether it returns a value, and — in `__init__` — which attributes it sets.
  let inside: { fn: ApiFunction; indent: number; init: boolean } | null = null
  // Decorator lines seen since the last statement. `@property` is the one that
  // matters; a `@name.setter` says the def is not a method either.
  let decorators: string[] = []

  for (const line of lines) {
    // A line back at the class's own indent, or further out, ends it.
    if (current && line.indent <= current.indent) current = null
    if (inside && line.indent <= inside.indent) inside = null

    if (inside && line.indent > inside.indent) {
      if (/^return\s+\S/.test(line.text)) inside.fn.returns = true
      const attr = inside.init ? /^self\.([A-Za-z_]\w*)\s*=[^=]/.exec(line.text) : null
      if (attr && current && isPublic(attr[1])) {
        if (!current.properties.includes(attr[1])) current.properties.push(attr[1])
        // An `__init__` attribute is a plain slot on the object, so it is
        // settable by definition — `ping.unit = 'in'` is a line somebody writes.
        if (!current.settable.includes(attr[1])) current.settable.push(attr[1])
      }
    }

    if (line.text.startsWith('@')) {
      decorators.push(line.text.slice(1).trim())
      continue
    }
    const seen = decorators
    decorators = []

    const klass = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:$/.exec(line.text)
    if (klass && line.indent === 0) {
      if (!isPublic(klass[1])) {
        current = null
        continue
      }
      const def: ApiClass = {
        name: klass[1],
        bases: splitParams(klass[2] ?? '').filter((b) => /^[A-Za-z_][\w.]*$/.test(b)),
        methods: [],
        properties: [],
        settable: []
      }
      current = {
        def,
        methods: [],
        properties: def.properties as string[],
        settable: def.settable as string[],
        indent: line.indent
      }
      classes.push(def)
      continue
    }

    const fn = readDef(line.text)
    if (fn) {
      if (current && line.indent > current.indent) {
        // A METHOD. `self` is the object the block already has, so it never
        // becomes a socket.
        const params = fn.params[0]?.name === 'self' ? fn.params.slice(1) : fn.params
        if (fn.name === '__init__') {
          ;(current.def as { init?: readonly ApiParam[] }).init = params
          inside = { fn, indent: line.indent, init: true }
        } else if (seen.some((d) => /\.(setter|deleter)$/.test(d))) {
          // The other half of a property. No block of its own — the getter
          // already made one — but a `.setter` is the thing that says the
          // property may be ASSIGNED to, which nothing else in the file does.
          for (const decorator of seen) {
            const owner = /^([A-Za-z_]\w*)\.setter$/.exec(decorator)
            if (!owner || !current.properties.includes(owner[1])) continue
            if (!current.settable.includes(owner[1])) current.settable.push(owner[1])
          }
        } else if (seen.includes('property')) {
          if (isPublic(fn.name) && !current.properties.includes(fn.name)) {
            current.properties.push(fn.name)
          }
        } else if (isPublic(fn.name)) {
          const method: ApiFunction = { name: fn.name, params }
          current.methods.push(method)
          ;(current.def as { methods: readonly ApiFunction[] }).methods = current.methods
          inside = { fn: method, indent: line.indent, init: false }
        }
        continue
      }
      if (line.indent === 0 && isPublic(fn.name)) {
        functions.push(fn)
        inside = { fn, indent: line.indent, init: false }
      }
      continue
    }

    // A CONSTANT is an upper-case module-level name. Lower-case module state is
    // deliberately skipped: it is nearly always a private cache or a singleton,
    // and a block that reads one would be a block about the driver's insides.
    const assign = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line.text)
    if (assign && line.indent === 0 && !constants.includes(assign[1])) constants.push(assign[1])
    else if (line.indent === 0) {
      // Any other public module-level name — `i2c = I2C(0)`, `x: int = 0`,
      // `a, b = 1, 2` — is a VARIABLE. Recorded for the shelf, never for blocks.
      // `==` is a comparison, not an assignment, hence the lookahead.
      const stmt = /^([A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]*)?=(?!=)/.exec(line.text)
      if (stmt) {
        for (const raw of stmt[1].split(',')) {
          const name = raw.trim()
          if (
            isPublic(name) &&
            !constants.includes(name) &&
            !variables.includes(name) &&
            !/^(?:[A-Z][A-Z0-9_]*)$/.test(name)
          ) {
            variables.push(name)
          }
        }
      }
    }
  }

  return { module, classes, functions, constants, variables }
}

/**
 * THE CURATED TIER (#1048).
 * ---------------------------------------------------------------------------
 *
 * `micropython-symbols.ts` and `circuitpython-symbols.ts` already carry kinds,
 * one-line details and docs for about thirty-nine modules — and are wired only
 * to Monaco's completions. Nothing in the blocks stack had ever imported them.
 *
 * So `machine`, `time`, `neopixel` and `framebuf` get blocks with **no parsing
 * at all**, which matters because they are exactly the modules whose source we
 * will never have: they are frozen into the firmware.
 *
 * The `detail` field turns out to be a signature — `time.ticks_diff(a, b)` —
 * so this tier yields real parameter names too, not just a method list. A
 * `detail` with no brackets (`machine.Pin`) says nothing about arguments, and
 * an empty parameter list is the honest reading of that.
 */

/** `time.ticks_diff(a, b)` → `[a, b]`. Empty when the detail names no call. */
export function paramsFromDetail(detail: string | undefined): ApiParam[] {
  const m = /\(([^)]*)\)/.exec(detail ?? '')
  if (!m) return []
  return splitParams(m[1])
    .map(readParam)
    .filter((p): p is ApiParam => p !== null)
}

/** Just enough of a `ModuleSymbol` member to read, without importing Monaco's. */
export interface CuratedMember {
  name: string
  kind: 'class' | 'function' | 'constant' | 'variable'
  detail?: string
}

/**
 * A curated module entry → the same shape the parser produces.
 *
 * A `variable` is deliberately dropped: module state is not an API, and a block
 * reading one would be a block about the module's insides.
 */
export function apiFromCurated(module: string, members: readonly CuratedMember[]): ModuleApi {
  const classes: ApiClass[] = []
  const functions: ApiFunction[] = []
  const constants: string[] = []
  for (const member of members) {
    if (!isPublic(member.name)) continue
    if (member.kind === 'class') {
      // No `init` and no methods: `detail` for a class is just its name, and
      // inventing a constructor signature is exactly the guessing this file
      // refuses to do. The class still earns a drawer entry through its
      // constants and the module's functions around it.
      classes.push({ name: member.name, bases: [], methods: [], properties: [], settable: [] })
    } else if (member.kind === 'function') {
      functions.push({ name: member.name, params: paramsFromDetail(member.detail) })
    } else if (member.kind === 'constant') {
      constants.push(member.name)
    }
  }
  return { module, classes, functions, constants, variables: [] }
}
