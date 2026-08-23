/**
 * Rule 57 — **Read into a buffer you already own** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                                # after
 * with open(path, "rb") as f:             with open(path, "rb") as f:
 *     for _ in range(blocks):                 block = bytearray(64)
 *         block = f.read(64)                  for _ in range(blocks):
 *         total += checksum(block)                f.readinto(block)
 *                                                 total += checksum(block)
 * ```
 *
 * Why it matters: `read(n)` **allocates a fresh `bytes` object every call**. It
 * asks the heap for n bytes, copies the data in, hands it to you — and the
 * moment the next pass overwrites the variable, that object becomes garbage.
 * A sampling loop reading 64 bytes at 200 Hz is asking the allocator for 12 KB
 * a second, all of it rubbish a millisecond later.
 *
 * `readinto(buf)` writes into memory **you** allocated once, before the loop
 * started. Same bytes, same code shape, no allocation and nothing for the
 * collector to sweep. In a sampling loop that is the difference between a steady
 * rate and a stall every time the collector runs — and the stall is the sort that
 * shows up as a dropped sample or a missed encoder edge, which looks exactly like
 * a hardware fault and is not one.
 *
 * Two things change, which is why this is an assisted rewrite and never a silent
 * one. `readinto()` returns **the number of bytes it actually read**, not the
 * data, so a short read no longer shortens the buffer — the tail simply keeps
 * last pass's bytes. And the buffer is now one object reused every iteration, so
 * anything that *keeps* it — appending it to a list, filing it in a dict, handing
 * it to another name — would end up with a pile of references to the same
 * bytearray, every one of them showing the final read. The rule refuses in all of
 * those cases: it only fires when the buffer plainly lives and dies inside one
 * pass of the loop, and when the loop is not already inspecting it for a short
 * read.
 *
 * It refuses one more, quieter case for the same reason: code *after* the loop
 * that still reads the buffer. `read()` binds that name inside the loop, so zero
 * iterations means `UnboundLocalError` — a loud, first-run failure. Allocating
 * the buffer above the loop binds it either way, and the same code then carries
 * on with a bufferful of zeros. Trading a crash for silently plausible data is
 * the worst thing a refactoring can do, so it does not.
 *
 * Gated on a board being connected at all. This is on-device advice about the
 * heap on the chip in front of you, and Snakie says nothing about a board it
 * cannot see.
 */
import type { AnyNode, Assign, Call, Expr, ForStmt, Name, WhileStmt } from '../ast'
import { enclosingLoop, unwrap, walk } from '../ast'
import { dottedName, literalNumber, textOf } from '../expr'
import { bindingScopeFor, bodyOf, isReadAfter, nameUses, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The two loop forms this rule hoists a buffer out of. */
type Loop = ForStmt | WhileStmt

interface ReadIntoMatch {
  loop: Loop
  stmt: Assign
  /** Source text of the thing being read from — `f`, `uart`, `spi`. */
  stream: string
  /** The buffer variable the loop already uses. */
  name: string
  /** The size exactly as written, so `0x40` and `1_024` survive. */
  sizeText: string
}

/**
 * Factories whose objects have both `read(n)` and `readinto(buf)`.
 *
 * `open` is here for files; the rest are the `machine` peripherals people
 * actually poll in a loop. Anything else — a driver class of the user's own, a
 * stream that arrived as a parameter — is not something this file can vouch for,
 * so the rule says nothing about it.
 */
const STREAM_FACTORIES = new Set(['open', 'UART', 'SPI', 'I2C', 'SoftSPI', 'SoftI2C'])

/** Methods that file a reference away where it will outlive the iteration. */
const KEEPING_METHODS = new Set(['append', 'extend', 'insert', 'add', 'put'])

/** Is the node the only thing on its line, bar a trailing comment? */
function ownsItsLine(ctx: RefactorContext, node: { start: number; end: number }): boolean {
  if (ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line) return false
  if (ctx.src.slice(lineStart(ctx.src, node.start), node.start).trim() !== '') return false
  const tail = ctx.src.slice(node.end, lineEnd(ctx.src, node.end)).replace(/\r?\n$/, '')
  return tail.trim() === '' || tail.trimStart().startsWith('#')
}

/** The single plain `Name` an assignment binds, or null for anything else. */
function singleNameTarget(stmt: Assign): Name | null {
  if (stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  return target.type === 'Name' ? target : null
}

/**
 * Every expression this file binds to `name` inside the scope that owns it.
 *
 * Anything that binds the name some other way — a `for` target, a parameter, an
 * `import`, an augmented assignment — deliberately poisons the answer with a
 * `null`, because then we cannot say what the object is.
 *
 * Shared with rule 58 (`memoryview-slice`), which asks the same question of the
 * same kind of name: "can this file tell me what that object actually is?"
 */
export function bindingValues(root: AnyNode, name: string): Expr[] | null {
  const out: Expr[] = []
  let opaque = false
  walk(root, (n) => {
    switch (n.type) {
      case 'Assign':
        for (const t of n.targets) {
          const e = unwrap(t)
          if (e.type === 'Name' && e.id === name) out.push(n.value)
        }
        return undefined
      case 'WithItem': {
        const v = n.optionalVars ? unwrap(n.optionalVars) : null
        if (v && v.type === 'Name' && v.id === name) out.push(n.context)
        return undefined
      }
      case 'For': {
        const t = unwrap(n.target)
        if (t.type === 'Name' && t.id === name) opaque = true
        return undefined
      }
      case 'AugAssign':
      case 'AnnAssign': {
        const t = unwrap(n.target)
        if (t.type === 'Name' && t.id === name) opaque = true
        return undefined
      }
      case 'FunctionDef':
        if (n.params.some((p) => p.name === name)) opaque = true
        return undefined
      case 'Import':
        if (n.names.some((a) => (a.asname ?? a.name.split('.')[0]) === name)) opaque = true
        return undefined
      case 'ImportFrom':
        if (n.names.some((a) => (a.asname ?? a.name) === name)) opaque = true
        return undefined
      default:
        return undefined
    }
  })
  return opaque ? null : out
}

/** Was this `open(...)` call opened in binary mode? Text mode has no `readinto`. */
function opensBinary(call: Call): boolean {
  const modeArg = call.args[1] ?? call.keywords.find((k) => k.arg === 'mode')?.value
  if (!modeArg) return false
  const mode = unwrap(modeArg)
  if (mode.type !== 'Constant' || mode.kind !== 'string') return false
  return mode.raw.includes('b')
}

/**
 * Does `name` provably refer to a file or peripheral with a `readinto`?
 *
 * Exactly one binding, to exactly one factory we recognise. Two bindings (`f =
 * open(...)` and a later `f = None`) is already a guess, and a guess here would
 * rewrite a call that does not exist on the object.
 */
function isReadIntoStream(node: AnyNode, name: string): boolean {
  const scope = bindingScopeFor(node, name)
  const values = bindingValues(scope as AnyNode, name)
  if (!values || values.length !== 1) return false
  const value = unwrap(values[0])
  if (value.type !== 'Call') return false
  const factory = dottedName(value.func)?.split('.').pop()
  if (!factory || !STREAM_FACTORIES.has(factory)) return false
  // A text-mode file hands back `str`, and `str` has no `readinto` at all.
  if (factory === 'open') return opensBinary(value)
  return true
}

/** Every reference to `name` inside `loop` that is not part of `stmt`. */
function referencesInLoop(loop: Loop, name: string, stmt: Assign): Name[] {
  const out: Name[] = []
  walk(loop as AnyNode, (n) => {
    if (n.type !== 'Name' || n.id !== name) return undefined
    if (n.start >= stmt.start && n.end <= stmt.end) return undefined
    out.push(n)
    return undefined
  })
  return out
}

/** True when `expr` *is* `node`, ignoring any parentheses around it. */
function isTheWholeOf(expr: Expr, node: AnyNode): boolean {
  return unwrap(expr) === node
}

/**
 * Does the loop keep hold of the buffer past the end of the iteration?
 *
 * This is the one case where reusing a buffer is flatly wrong: every stored
 * reference would alias the same bytearray, so a list of a hundred "samples"
 * would be a hundred views of the last one.
 */
function keepsAReference(loop: Loop, name: string, stmt: Assign): boolean {
  for (const ref of referencesInLoop(loop, name, stmt)) {
    const parent = ref.parent
    if (!parent) continue
    switch (parent.type) {
      case 'Assign':
        // `frames[i] = buf`, `latest = buf` — the buffer outlives the pass.
        if (isTheWholeOf(parent.value, ref)) return true
        break
      case 'AugAssign':
        if (isTheWholeOf(parent.value, ref)) return true
        break
      case 'List':
      case 'Set':
      case 'Tuple':
      case 'Dict':
        // A display holds whatever you put in it.
        return true
      case 'Return':
      case 'Yield':
        return true
      case 'Call': {
        const method = dottedName(parent.func)?.split('.').pop()
        if (method && KEEPING_METHODS.has(method) && parent.args.some((a) => isTheWholeOf(a, ref))) {
          return true
        }
        break
      }
      default:
        break
    }
  }
  return false
}

/**
 * Does the loop test the buffer itself — `if not chunk:`, `if len(chunk) < 64:`?
 *
 * That is short-read handling, and it is exactly what changes: `read()` hands
 * back a shorter object at the end of the stream, `readinto()` hands back a
 * count and leaves the tail of the buffer holding last pass's bytes. Leave that
 * code alone.
 */
function inspectedForShortRead(loop: Loop, name: string): boolean {
  let found = false
  const scanTest = (test: Expr): void => {
    walk(test as AnyNode, (t) => {
      if (t.type === 'Name' && t.id === name) found = true
    })
  }
  walk(loop as AnyNode, (n) => {
    if (n.type === 'If' || n.type === 'While') scanTest(n.test)
    if (n.type === 'Compare') {
      const parts = [n.left, ...n.comparators]
      const mentionsName = parts.some((p) => {
        const e = unwrap(p)
        return e.type === 'Name' && e.id === name
      })
      const mentionsNone = parts.some((p) => {
        const e = unwrap(p)
        return e.type === 'Constant' && e.kind === 'none'
      })
      if (mentionsName && mentionsNone) found = true
    }
    return undefined
  })
  return found
}

/**
 * Is the buffer still being read once the loop body has finished with it — in a
 * `for … else`, or anywhere later in the scope?
 *
 * This is the case the "does it escape?" check above cannot see, because it only
 * looks inside the loop, and it is the one that turns a crash into silently wrong
 * data. `read()` binds the name **inside** the loop, so a loop that runs zero
 * times leaves it unbound and the code after it raises `UnboundLocalError` —
 * loudly, on the first run, pointing straight at the bug. Hoisting
 * `buf = bytearray(n)` above the loop binds the name whether the loop runs or
 * not, so the same code sails on with twelve zero bytes and reports a reading of
 * nothing as a reading of zero. A robot that stops is debuggable; a robot that
 * confidently drives on bad data is not.
 *
 * The type changes underneath it too: the trailing use now sees a `bytearray`
 * rather than the `bytes` `read()` returned, so anything that hashed it — a dict
 * key, a set member — starts raising `TypeError` instead.
 *
 * Both are invisible at the call site, so the rule simply refuses. Reusing a
 * buffer is only safe while the buffer never outlives the pass that filled it.
 */
function readAfterTheLoop(loop: Loop, name: string): boolean {
  const body = loop.body
  // Past the last statement of the body: that covers the `else` clause of a
  // `for`/`while` as well as every statement after the loop.
  const after = body.length > 0 ? body[body.length - 1].end : loop.end
  return isReadAfter(scopeOf(loop), name, after)
}

/**
 * Is this statement the *only* thing that binds the buffer name in its scope?
 *
 * The rewrite reuses the name the loop already uses — that is the whole point,
 * since the body reads it. So a `freshName` has nothing to offer here: a new
 * name would have to be threaded through every use in the body, which is a
 * rename, not this refactoring. Instead we simply refuse when the name is
 * already carrying something else, rather than quietly stamping on it.
 */
function nameIsOursAlone(stmt: Assign, name: string): boolean {
  const scope = scopeOf(stmt)
  for (const use of nameUses(bodyOf(scope))) {
    if (use.name !== name || use.kind !== 'write') continue
    if (use.node.start >= stmt.start && use.node.end <= stmt.end) continue
    return false
  }
  return true
}

export const readIntoBufferRule = defineRule<ReadIntoMatch>({
  id: 'readinto-buffer',
  title: 'Read into a buffer you already own',
  message: '`read()` allocates a new bytes object every pass — `readinto()` reuses one',
  catalogue: 57,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-readinto-buffer',
  // `readinto()` returns a count, not the data, and the buffer is now shared
  // between passes. Both are worth a human's eye, so never batch this.
  safe: false,
  // On-device advice about the heap on the chip in front of you: no board, no hint.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<ReadIntoMatch>[] {
    const out: RefactorMatch<ReadIntoMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Assign') return undefined
      const target = singleNameTarget(node)
      if (!target) return undefined

      const value = unwrap(node.value)
      if (value.type !== 'Call' || value.keywords.length > 0 || value.args.length !== 1) {
        return undefined
      }
      const func = unwrap(value.func)
      if (func.type !== 'Attribute' || func.attr !== 'read') return undefined
      const receiver = unwrap(func.value)
      if (receiver.type !== 'Name') return undefined

      // A fixed size is what makes a reusable buffer possible in the first place.
      const sizeExpr = unwrap(value.args[0])
      if (sizeExpr.type !== 'Constant' || sizeExpr.kind !== 'number') return undefined
      const size = literalNumber(sizeExpr)
      if (size == null || !Number.isInteger(size) || size < 1) return undefined

      // `enclosingLoop` stops at a function boundary, so a read inside a helper
      // that a loop happens to call is left alone — how often it runs is not
      // something this file can tell us.
      const loop = enclosingLoop(node)
      if (!loop) return undefined

      if (!isReadIntoStream(node, receiver.id)) return undefined
      if (keepsAReference(loop, target.id, node)) return undefined
      if (readAfterTheLoop(loop, target.id)) return undefined
      if (inspectedForShortRead(loop, target.id)) return undefined
      if (!nameIsOursAlone(node, target.id)) return undefined
      if (!ownsItsLine(ctx, node)) return undefined
      // The buffer has to go on a line of its own above the loop header.
      if (ctx.src.slice(lineStart(ctx.src, loop.start), loop.start).trim() !== '') return undefined

      out.push({
        ruleId: 'readinto-buffer',
        start: node.start,
        end: node.end,
        message: `\`${receiver.id}.read(${textOf(ctx, sizeExpr)})\` allocates a new bytes object on every pass — allocate \`${target.id}\` once and \`readinto()\` it`,
        data: {
          loop,
          stmt: node,
          stream: receiver.id,
          name: target.id,
          sizeText: textOf(ctx, sizeExpr)
        }
      })
      return undefined
    })

    return out
  },

  apply(match: RefactorMatch<ReadIntoMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, stmt, stream, name, sizeText } = match.data
    const insertAt = lineStart(ctx.src, loop.start)
    if (insertAt >= stmt.start) return null
    const indent = indentAt(ctx.src, loop.start)
    return [
      { start: insertAt, end: insertAt, newText: `${indent}${name} = bytearray(${sizeText})${ctx.eol}` },
      { start: stmt.start, end: stmt.end, newText: `${stream}.readinto(${name})` }
    ]
  }
})
