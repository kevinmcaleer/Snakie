/**
 * The reasoning behind MicroPython autocomplete, signature help and hovers —
 * kept free of Monaco so it can be unit-tested.
 *
 * Given the text of the file and the stub catalogue (`micropython-stubs.ts`)
 * it answers three questions:
 *
 *   1. What does this dotted name refer to? `machine.Pin`, `m.Pin` after
 *      `import machine as m`, `Pin` after `from machine import Pin`, `led`
 *      after `led = Pin(25, Pin.OUT)`, `self.pwm` after `self.pwm = PWM(…)`.
 *      → {@link scanScope} + {@link resolveExpr}
 *   2. What can follow its dot? → {@link membersOf}
 *   3. Which call is the cursor inside, and which argument? → {@link callContext}
 *
 * It is deliberately a light, regex-level reading of the file rather than a
 * Python parser: it has to answer within a keystroke, on half-typed code that
 * does not parse, and "the last thing assigned to `led` was a `Pin`" is the
 * right answer for nearly every MicroPython program.
 */
import {
  canonicalModule,
  stubModule,
  type StubCatalogue,
  type StubMember,
  type StubSignature
} from './micropython-stubs'

/** What the file has imported and assigned, by local name. */
export interface FileScope {
  /** Local name → module: `m` → `machine` (`import machine as m`). */
  modules: Map<string, string>
  /** Local name → module member: `P` → machine.Pin (`from machine import Pin as P`). */
  names: Map<string, { module: string; name: string }>
  /** Modules star-imported: `from machine import *`. */
  stars: string[]
  /** Variable → the expression it was last built from: `led` → `Pin`, `self.pwm` → `PWM`. */
  vars: Map<string, string>
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'
const DOTTED = `${IDENT}(?:\\.${IDENT})*`

/**
 * Read the imports and constructor assignments out of a file.
 *
 * Later assignments win, which matches what a reader expects at the bottom of
 * a script and costs nothing in the common case of one assignment per name.
 */
export function scanScope(text: string): FileScope {
  const scope: FileScope = { modules: new Map(), names: new Map(), stars: [], vars: new Map() }

  // `from x import (a,\n b)` → one line, so the line scan below sees it whole.
  const flat = text.replace(
    new RegExp(`(from\\s+${DOTTED}\\s+import\\s*)\\(([^)]*)\\)`, 'g'),
    (_m, head: string, body: string) => head + body.replace(/\s*\n\s*/g, ' ')
  )

  const importRe = new RegExp(`^\\s*import\\s+(.+)$`)
  const fromRe = new RegExp(`^\\s*from\\s+(${DOTTED})\\s+import\\s+(.+)$`)
  const assignRe = new RegExp(
    `^\\s*((?:self\\.)?${IDENT})\\s*(?::\\s*[^=]+?)?=\\s*(?:await\\s+)?(${DOTTED})\\s*\\(`
  )
  const annotRe = new RegExp(`^\\s*((?:self\\.)?${IDENT})\\s*:\\s*(${DOTTED})\\s*(?:=|$)`)
  const paramAnnotRe = new RegExp(`(${IDENT})\\s*:\\s*(${DOTTED})`, 'g')

  for (const raw of flat.split('\n')) {
    const line = raw.replace(/#.*$/, '')
    let m = importRe.exec(line)
    if (m) {
      for (const part of m[1].split(',')) {
        const am = new RegExp(`^\\s*(${DOTTED})(?:\\s+as\\s+(${IDENT}))?\\s*$`).exec(part)
        if (!am) continue
        const [, mod, alias] = am
        // `import a.b` binds `a`; `import a.b as c` binds c → a.b
        scope.modules.set(alias ?? mod.split('.')[0], alias ? mod : mod.split('.')[0])
      }
      continue
    }
    m = fromRe.exec(line)
    if (m) {
      const mod = m[1]
      for (const part of m[2].split(',')) {
        const p = part.trim()
        if (p === '*') {
          if (!scope.stars.includes(mod)) scope.stars.push(mod)
          continue
        }
        const am = new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`).exec(p)
        if (!am) continue
        const [, name, alias] = am
        // `from rp2 import asm_pio` names a member; `from os import path` might
        // name a submodule — either way record it as a member and let the
        // resolver decide.
        scope.names.set(alias ?? name, { module: mod, name })
      }
      continue
    }
    m = assignRe.exec(line)
    if (m) {
      scope.vars.set(m[1], m[2])
      continue
    }
    m = annotRe.exec(line)
    if (m) {
      scope.vars.set(m[1], m[2])
      continue
    }
    // `def __init__(self, pin: Pin)` — a parameter annotated with a class.
    if (/^\s*(?:async\s+)?def\s/.test(line)) {
      for (const pm of line.matchAll(paramAnnotRe)) {
        if (!scope.vars.has(pm[1])) scope.vars.set(pm[1], pm[2])
      }
    }
  }
  return scope
}

/** What a dotted name turned out to be. */
export type Resolved =
  | { kind: 'module'; module: string }
  | {
      kind: 'member'
      module: string
      /** Path inside the module: `['Pin']`, `['Pin', 'irq']`. */
      path: string[]
      member: StubMember
      /** True for `led` (a Pin object), false for `Pin` (the class itself). */
      instance: boolean
    }

/** A class's members, including what it inherits from base classes in the same module. */
export function classMembers(
  catalogue: StubCatalogue,
  module: string,
  cls: StubMember,
  seen: Set<StubMember> = new Set()
): Record<string, StubMember> {
  if (seen.has(cls)) return {}
  seen.add(cls)
  const out: Record<string, StubMember> = {}
  for (const base of cls.bases ?? []) {
    const b = stubModule(catalogue, module)?.members[base.split('.').pop() ?? base]
    if (b?.kind === 'class') Object.assign(out, classMembers(catalogue, module, b, seen))
  }
  return Object.assign(out, cls.members ?? {})
}

/** Find a class/function by bare name anywhere in the catalogue, `machine` first. */
function findBare(
  catalogue: StubCatalogue,
  name: string
): { module: string; member: StubMember } | null {
  const preferred = ['machine', 'network', 'time', 'neopixel', 'rp2', 'esp32', 'bluetooth', 'framebuf']
  const order = [...preferred, ...Object.keys(catalogue.modules).filter((m) => !preferred.includes(m))]
  for (const mod of order) {
    const member = catalogue.modules[mod]?.members[name]
    if (member && member.kind === 'class') return { module: mod, member }
  }
  return null
}

/** The class a function's return annotation names, if it is in the same module. */
function returnedClass(
  catalogue: StubCatalogue,
  module: string,
  fn: StubMember
): { name: string; member: StubMember } | null {
  for (const sig of fn.signatures ?? []) {
    const name = sig.returns?.replace(/\[.*$/, '').split('.').pop()
    if (!name) continue
    const member = stubModule(catalogue, module)?.members[name]
    if (member?.kind === 'class') return { name, member }
  }
  return null
}

/**
 * Resolve a dotted name (`led`, `machine.Pin`, `self.sm`, `Pin.board`) against
 * what the file imported and assigned.
 *
 * `allowBare` keeps the old behaviour of the curated catalogue: `machine.` and
 * `Pin.` complete even before the import line is written.
 */
export function resolveExpr(
  expr: string,
  scope: FileScope,
  catalogue: StubCatalogue,
  allowBare = true,
  depth = 0
): Resolved | null {
  if (depth > 4) return null
  const parts = expr.split('.').filter(Boolean)
  if (!parts.length) return null

  let current: Resolved | null = null
  let i = 1

  const instanceOf = (ctor: string): Resolved | null => {
    const r = resolveExpr(ctor, scope, catalogue, allowBare, depth + 1)
    if (r?.kind !== 'member') return null
    if (r.member.kind === 'class') return { ...r, instance: true }
    if (r.member.kind === 'function' || r.member.kind === 'method') {
      const ret = returnedClass(catalogue, r.module, r.member)
      if (ret) return { kind: 'member', module: r.module, path: [ret.name], member: ret.member, instance: true }
    }
    return null
  }

  if (parts[0] === 'self' && parts.length > 1 && scope.vars.has(`self.${parts[1]}`)) {
    current = instanceOf(scope.vars.get(`self.${parts[1]}`) as string)
    i = 2
  } else if (scope.vars.has(parts[0]) && !scope.modules.has(parts[0]) && !scope.names.has(parts[0])) {
    current = instanceOf(scope.vars.get(parts[0]) as string)
  } else if (scope.modules.has(parts[0])) {
    const mod = canonicalModule(catalogue, scope.modules.get(parts[0]) as string)
    if (catalogue.modules[mod]) current = { kind: 'module', module: mod }
  } else if (scope.names.has(parts[0])) {
    const { module, name } = scope.names.get(parts[0]) as { module: string; name: string }
    const mod = canonicalModule(catalogue, module)
    const member = catalogue.modules[mod]?.members[name]
    if (member) current = { kind: 'member', module: mod, path: [name], member, instance: false }
    else if (catalogue.modules[canonicalModule(catalogue, `${module}.${name}`)])
      current = { kind: 'module', module: canonicalModule(catalogue, `${module}.${name}`) }
  } else {
    for (const star of scope.stars) {
      const mod = canonicalModule(catalogue, star)
      const member = catalogue.modules[mod]?.members[parts[0]]
      if (member) {
        current = { kind: 'member', module: mod, path: [parts[0]], member, instance: false }
        break
      }
    }
    if (!current && allowBare) {
      const mod = canonicalModule(catalogue, parts[0])
      if (catalogue.modules[mod]) current = { kind: 'module', module: mod }
      else {
        const bare = findBare(catalogue, parts[0])
        if (bare)
          current = { kind: 'member', module: bare.module, path: [parts[0]], member: bare.member, instance: false }
      }
    }
  }

  for (; current && i < parts.length; i++) {
    const p = parts[i]
    if (current.kind === 'module') {
      const member: StubMember | undefined = catalogue.modules[current.module].members[p]
      current = member
        ? { kind: 'member', module: current.module, path: [p], member, instance: false }
        : null
    } else if (current.member.kind === 'class') {
      const member: StubMember | undefined = classMembers(catalogue, current.module, current.member)[p]
      current = member
        ? { kind: 'member', module: current.module, path: [...current.path, p], member, instance: current.instance && member.kind !== 'class' }
        : null
    } else {
      current = null
    }
  }
  return current
}

/** One suggestion after a dot, before it becomes a Monaco item. */
export interface MemberEntry {
  name: string
  member: StubMember
}

/** What can follow `<resolved>.` — sorted most-useful first. */
export function membersOf(catalogue: StubCatalogue, target: Resolved): MemberEntry[] {
  let table: Record<string, StubMember> = {}
  if (target.kind === 'module') table = catalogue.modules[target.module]?.members ?? {}
  else if (target.member.kind === 'class') table = classMembers(catalogue, target.module, target.member)
  else return []
  return Object.entries(table)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, member]) => ({ name, member }))
}

/** Where the members are being listed: `machine.`, `Pin.` or `led.`. */
export type MemberContext = 'module' | 'class' | 'instance'

/** The context a resolved owner lists its members in. */
export function memberContext(target: Resolved): MemberContext {
  if (target.kind === 'module') return 'module'
  return target.instance ? 'instance' : 'class'
}

const RANKS: Record<MemberContext, Record<StubMember['kind'], number>> = {
  // `machine.` / `from machine import` — the classes are what people want.
  module: { class: 0, function: 1, method: 1, constant: 2, variable: 3 },
  // `Pin.` — the constants (`Pin.OUT`).
  class: { constant: 0, class: 1, function: 2, method: 2, variable: 3 },
  // `led.` — the methods.
  instance: { method: 0, function: 0, variable: 1, class: 2, constant: 3 }
}

/**
 * Sort key for a member in its context. Members every port has sort before
 * the port-specific ones, so `Pin.` leads with `IN`/`OUT`, not `ALT_PIO0`.
 */
export function memberSortText(entry: MemberEntry, context: MemberContext): string {
  const rank = RANKS[context][entry.member.kind]
  return `${rank}${entry.member.ports ? 1 : 0}${entry.name.toLowerCase()}`
}

/** `from machine import Pin, |` → `machine`, with what is typed so far. */
export function fromImportContext(lineToCursor: string): { module: string; partial: string } | null {
  const m = new RegExp(
    `^\\s*from\\s+(${DOTTED})\\s+import\\s+\\(?\\s*(?:${IDENT}(?:\\s+as\\s+${IDENT})?\\s*,\\s*)*(${IDENT})?$`
  ).exec(lineToCursor)
  return m ? { module: m[1], partial: m[2] ?? '' } : null
}

/** The dotted chain right before a `.` at the cursor: `self.led.va|` → `self.led`. */
export function dottedOwner(lineToCursor: string): { owner: string; partial: string } | null {
  const m = new RegExp(`(?:^|[^A-Za-z0-9_.])(${DOTTED})\\.\\s*(${IDENT})?$`).exec(lineToCursor)
  return m ? { owner: m[1], partial: m[2] ?? '' } : null
}

/** The call around the cursor, for signature help. */
export interface CallContext {
  /** `machine.Pin`, `led.irq`, `PWM` */
  callee: string
  /** Zero-based index of the argument the cursor is in. */
  argIndex: number
  /** The keyword being typed, for `Pin(25, mode=|`. */
  keyword?: string
  /** Keywords already passed before this argument: `I2C(0, sda=sda, |` → `['sda']`. */
  used?: string[]
}

/**
 * Find the innermost open call before the cursor. Reads forward over the tail
 * of the text, skipping strings and comments, so a `(` inside `"a (b"` or a
 * `,` inside `[1, 2]` never counts.
 */
export function callContext(textBeforeCursor: string): CallContext | null {
  const text = textBeforeCursor.slice(-4000)
  const stack: { ch: string; pos: number; commas: number; lastComma: number; used: string[] }[] = []
  const kwRe = new RegExp(`^\\s*(${IDENT})\\s*=(?!=)`)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '#') {
      const nl = text.indexOf('\n', i)
      if (nl < 0) return null // the cursor is in a comment
      i = nl
      continue
    }
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      let j = i + q.length
      for (; j < text.length; j++) {
        if (text[j] === '\\') {
          j++
          continue
        }
        if (!triple && text[j] === '\n') break
        if (text.startsWith(q, j)) break
      }
      if (j >= text.length) return null // the cursor is inside a string
      i = j + q.length - 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, pos: i, commas: 0, lastComma: i, used: [] })
    else if (c === ')' || c === ']' || c === '}') stack.pop()
    else if (c === ',' && stack.length) {
      const top = stack[stack.length - 1]
      const done = kwRe.exec(text.slice(top.lastComma + 1, i))
      if (done) top.used.push(done[1])
      top.commas++
      top.lastComma = i
    }
  }
  const top = stack[stack.length - 1]
  if (!top || top.ch !== '(') return null
  const before = text.slice(0, top.pos)
  const m = new RegExp(`(${DOTTED})\\s*$`).exec(before)
  if (!m) return null
  // `def f(` and `class C(` are definitions, not calls.
  if (new RegExp(`\\b(?:def|class)\\s+${m[1]}\\s*$`).test(before)) return null
  const current = text.slice(top.lastComma + 1)
  const kw = kwRe.exec(current)
  return {
    callee: m[1],
    argIndex: top.commas,
    keyword: kw?.[1],
    ...(top.used.length ? { used: top.used } : {})
  }
}

/** A parameter's bare name: `mode: int = -1` → `mode`, `*args` → `args`. */
export function paramName(param: string): string {
  return param.replace(/^\*+/, '').split(/[:=]/)[0].trim()
}

/** The signatures to show for a callee, or none. */
export function signaturesFor(target: Resolved | null): StubSignature[] {
  if (!target || target.kind !== 'member') return []
  return target.member.signatures ?? []
}

/**
 * Which signature and parameter to highlight. A keyword argument picks its
 * parameter by name; otherwise the argument index does, and the first overload
 * long enough to have that many parameters is the one shown.
 */
export function activeSignature(
  signatures: StubSignature[],
  ctx: CallContext
): { signature: number; parameter: number } {
  if (!signatures.length) return { signature: 0, parameter: 0 }
  // Overloads that accept every keyword already written are the candidates:
  // after `I2C(id=0, sda=sda, ` the one without `sda` is not what is being called.
  const used = ctx.used ?? []
  const names = (i: number): string[] => signatures[i].params.map(paramName)
  const all = signatures.map((_, i) => i)
  const fitting = all.filter((i) => used.every((u) => names(i).includes(u)))
  const order = fitting.length ? fitting : all
  if (ctx.keyword) {
    for (const s of order) {
      const p = names(s).indexOf(ctx.keyword)
      if (p >= 0) return { signature: s, parameter: p }
    }
  }
  if (used.length) {
    // Keywords so far: point at the first parameter not yet given, past the
    // ones filled positionally.
    for (const s of order) {
      const positional = Math.max(0, ctx.argIndex - used.length)
      const p = signatures[s].params.findIndex(
        (x, i) => i >= positional && !x.startsWith('*') && !used.includes(paramName(x))
      )
      if (p >= 0) return { signature: s, parameter: p }
    }
  }
  let s = order.find((i) => signatures[i].params.length > ctx.argIndex) ?? -1
  if (s < 0) s = 0
  const params = signatures[s].params
  let p = ctx.argIndex
  if (p >= params.length) {
    const varargs = params.findIndex((x) => x.startsWith('*') && !x.startsWith('**'))
    p = varargs >= 0 ? varargs : params.length - 1
  }
  return { signature: s, parameter: Math.max(0, p) }
}

/** Human label for a port list: `['rp2']` → `rp2 only`. */
export function portsLabel(ports: string[] | undefined): string {
  if (!ports?.length) return ''
  const names = ports.map((p) => (p === 'rp2' ? 'RP2 (Pico)' : p === 'esp32' ? 'ESP32' : p))
  return `${names.join(' / ')} only`
}

/** One-line detail for a member: its first signature, else its type. */
export function memberDetail(name: string, member: StubMember): string {
  const sig = member.signatures?.[0]
  let base = sig ? sig.label : member.kind === 'class' ? `class ${name}` : name
  if (member.async) base = `async ${base}`
  if (member.signatures && member.signatures.length > 1) base += `  (+${member.signatures.length - 1} overload${member.signatures.length > 2 ? 's' : ''})`
  if (!sig && member.type) base += `: ${member.type}`
  const ports = portsLabel(member.ports)
  return ports ? `${ports} · ${base}` : base
}

/** Markdown for a hover or the completion details pane. */
export function memberMarkdown(qualified: string, member: StubMember): string {
  const out: string[] = []
  const sigs = member.signatures ?? []
  const prefix = qualified.includes('.') ? qualified.slice(0, qualified.lastIndexOf('.') + 1) : ''
  if (sigs.length) {
    out.push('```python', ...sigs.map((s) => `${member.async ? 'async ' : ''}${prefix}${s.label}`), '```')
  } else {
    const kind = member.kind === 'class' ? 'class ' : ''
    out.push('```python', `${kind}${qualified}${member.type ? `: ${member.type}` : ''}`, '```')
  }
  if (member.doc) out.push('', member.doc)
  for (const s of sigs) if (s.doc) out.push('', `\`${s.label}\` — ${s.doc}`)
  const ports = portsLabel(member.ports)
  if (ports) out.push('', `*${ports}.*`)
  return out.join('\n')
}
