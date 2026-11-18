/**
 * Where a name in the user's own file is defined — for Go to Definition
 * (right-click, F12, Cmd/Ctrl+click) and the "defined on line N" hover.
 *
 * Like `micropython-intellisense.ts` this is a line-level reading of the file,
 * not a Python parser: it must work on half-written code, and in a MicroPython
 * script "the line that assigned `motor_a`" is nearly always unambiguous.
 *
 * Python's scoping is followed just far enough to pick the right line when a
 * name is bound more than once:
 *
 *   - inside a function, that function's own parameters and assignments win;
 *   - otherwise the module-level binding: at module level the latest one above
 *     the cursor (`speed = 10` … `speed = 20` … `print(speed)` → the 20), and
 *     from inside a function the first one (that is where it is introduced).
 *   - `self.x` goes to the first `self.x = …` in the same class.
 */

/** One place a name is bound. */
export interface Definition {
  name: string
  /** 1-based line. */
  line: number
  /** 1-based column where the name starts. */
  column: number
  kind: 'variable' | 'function' | 'class' | 'parameter' | 'import' | 'loop' | 'attribute'
  /** The line's code, trimmed — shown in the hover. */
  text: string
  /** Line of the enclosing `def`, or null at module/class level. */
  scope: number | null
  /** Line of the enclosing `class`, for `self.x` attributes. */
  cls: number | null
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'

/** Blank out comments and string contents, keeping columns. */
export function codeOnly(line: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') {
        out += '  '
        i++
        continue
      }
      if (c === quote) {
        quote = null
        out += c
      } else out += ' '
      continue
    }
    if (c === '#') break
    if (c === '"' || c === "'") quote = c
    out += c
  }
  return out
}

const indentOf = (line: string): number => line.length - line.trimStart().length

/** Every binding in the file, top to bottom. */
export function findDefinitions(text: string): Definition[] {
  const lines = text.split('\n')
  const out: Definition[] = []
  // Open `def`/`class` blocks: [indent, line, kind]
  const stack: { indent: number; line: number; kind: 'def' | 'class' }[] = []
  let inTriple: string | null = null

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]
    // Skip the inside of triple-quoted strings (docstrings).
    if (inTriple) {
      if (raw.includes(inTriple)) inTriple = null
      continue
    }
    const tq = /("""|''')/.exec(raw)
    if (tq && raw.split(tq[1]).length === 2) {
      inTriple = tq[1]
      continue
    }
    if (!raw.trim() || raw.trim().startsWith('#')) continue

    const indent = indentOf(raw)
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const fn = [...stack].reverse().find((s) => s.kind === 'def')
    const klass = [...stack].reverse().find((s) => s.kind === 'class')
    const scope = fn ? fn.line : null
    const cls = klass ? klass.line : null
    const line = codeOnly(raw)
    const lineNo = n + 1
    const add = (name: string, col: number, kind: Definition['kind'], s = scope): void => {
      out.push({ name, line: lineNo, column: col + 1, kind, text: raw.trim(), scope: s, cls })
    }
    const at = (name: string, from = 0): number => {
      const m = new RegExp(`(?<![\\w.])${name}(?!\\w)`).exec(line.slice(from))
      return m ? from + m.index : indent
    }

    let m = new RegExp(`^\\s*(async\\s+)?def\\s+(${IDENT})\\s*\\((.*)`).exec(line)
    if (m) {
      add(m[2], at(m[2]), 'function')
      stack.push({ indent, line: lineNo, kind: 'def' })
      // Parameters belong to the function's own scope.
      const params = m[3].split(')')[0]
      const start = line.indexOf('(') + 1
      for (const p of params.split(',')) {
        const pm = new RegExp(`^\\s*\\**(${IDENT})`).exec(p)
        if (pm && pm[1] !== 'self' && pm[1] !== 'cls') add(pm[1], at(pm[1], start), 'parameter', lineNo)
      }
      continue
    }
    m = new RegExp(`^\\s*class\\s+(${IDENT})`).exec(line)
    if (m) {
      add(m[1], at(m[1]), 'class')
      stack.push({ indent, line: lineNo, kind: 'class' })
      continue
    }
    m = /^\s*import\s+(.+)$/.exec(line)
    if (m) {
      for (const part of m[1].split(',')) {
        const am = new RegExp(`^\\s*(${IDENT})(?:\\.${IDENT})*(?:\\s+as\\s+(${IDENT}))?\\s*$`).exec(part)
        if (am) add(am[2] ?? am[1], at(am[2] ?? am[1], line.indexOf('import') + 6), 'import')
      }
      continue
    }
    m = /^\s*from\s+\S+\s+import\s+\(?(.+?)\)?\s*$/.exec(line)
    if (m) {
      const from = line.indexOf(' import') + 7
      for (const part of m[1].split(',')) {
        const am = new RegExp(`^\\s*(${IDENT})(?:\\s+as\\s+(${IDENT}))?\\s*$`).exec(part)
        if (am) add(am[2] ?? am[1], at(am[2] ?? am[1], from), 'import')
      }
      continue
    }
    m = /^\s*(?:async\s+)?for\s+(.+?)\s+in\b/.exec(line)
    if (m) {
      for (const v of m[1].replace(/[()]/g, ' ').split(',')) {
        const name = v.trim()
        if (new RegExp(`^${IDENT}$`).test(name)) add(name, at(name), 'loop')
      }
      continue
    }
    // `with open(f) as fh:` / `except OSError as e:`
    for (const wm of line.matchAll(new RegExp(`\\bas\\s+(${IDENT})`, 'g'))) {
      if (/^\s*(with|except|async\s+with)\b/.test(line)) add(wm[1], (wm.index ?? 0) + wm[0].length - wm[1].length, 'variable')
    }
    // `self.speed = 0`
    m = new RegExp(`^\\s*self\\.(${IDENT})\\s*(?::[^=]+)?=(?!=)`).exec(line)
    if (m) {
      add(m[1], line.indexOf(m[1], line.indexOf('self.')), 'attribute')
      continue
    }
    // `a = …`, `a: int = …`, `a, b = …`, `a = b = …`, `a += 1` is NOT a binding site we show
    m = /^\s*([A-Za-z_][\w\s,()[\]]*?)\s*(?::\s*[^=]+?)?=(?!=)/.exec(line)
    if (m && !/^\s*(if|elif|while|return|assert|print)\b/.test(line)) {
      const targets = line.split(/(?<![=!<>+\-*/%&|^@:])=(?!=)/).slice(0, -1)
      let offset = 0
      for (const t of targets) {
        // `print(x, y=2)` and `Pin(2, mode=Pin.OUT)` are keyword arguments, not bindings.
        if (/[\w\])]\s*\(/.test(t) || /\(/.test(t.replace(/^\s*\(/, ''))) break
        for (const v of t.replace(/:.*$/, '').replace(/[()[\]]/g, ' ').split(',')) {
          const name = v.trim()
          if (new RegExp(`^${IDENT}$`).test(name) && !['self', 'global', 'nonlocal'].includes(name)) {
            add(name, at(name, offset), 'variable')
          }
        }
        offset += t.length + 1
      }
    }
  }
  return out
}

/** The `def` line enclosing `line` (1-based), or null. */
function enclosingScope(text: string, line: number): { fn: number | null; cls: number | null } {
  const lines = text.split('\n')
  const target = lines[line - 1] ?? ''
  let indent = target.trim() ? indentOf(target) : Infinity
  let fn: number | null = null
  let cls: number | null = null
  for (let n = Math.min(line - 2, lines.length - 1); n >= 0; n--) {
    const raw = lines[n]
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const i = indentOf(raw)
    if (i >= indent) continue
    if (fn === null && cls === null && /^\s*(async\s+)?def\s/.test(raw)) fn = n + 1
    else if (cls === null && /^\s*class\s/.test(raw)) cls = n + 1
    indent = i
    if (i === 0) break
  }
  return { fn, cls }
}

/**
 * Where `name`, used at `line`, was defined. `attribute` is true for `self.name`.
 * Null when the file never binds it (a builtin, or a module member).
 */
export function definitionOf(
  text: string,
  name: string,
  line: number,
  attribute = false,
  defs: Definition[] = findDefinitions(text)
): Definition | null {
  const { fn, cls } = enclosingScope(text, line)
  if (attribute) {
    const own = defs.filter((d) => d.kind === 'attribute' && d.name === name)
    return own.find((d) => d.cls === cls) ?? own[0] ?? null
  }
  const named = defs.filter((d) => d.name === name && d.kind !== 'attribute')
  if (!named.length) return null
  const latestBefore = (list: Definition[]): Definition | undefined =>
    [...list].reverse().find((d) => d.line <= line) ?? list[0]
  if (fn !== null) {
    const local = named.filter((d) => d.scope === fn)
    if (local.length) return latestBefore(local) ?? null
    const global = named.filter((d) => d.scope === null)
    return global[0] ?? named[0]
  }
  const global = named.filter((d) => d.scope === null)
  return latestBefore(global.length ? global : named) ?? null
}
