/**
 * Rule 85 — **Pack into a pre-allocated buffer** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                                  # after (by hand)
 * def stream(n):                            frame = bytearray(8)
 *     for i in range(n):                    def stream(n):
 *         link.write(                           for i in range(n):
 *             struct.pack("<Hhhh", i, *imu())       struct.pack_into(
 *         )                                             "<Hhhh", frame, 0, i, *imu())
 *                                                   link.write(frame)
 * ```
 *
 * Why it matters: `struct.pack()` **returns a new `bytes` object**. Every call
 * asks the allocator for memory, and every result becomes garbage as soon as it
 * has been written. Do that once and nobody notices; do it two hundred times a
 * second in a sampling loop and the heap fills with short-lived objects until
 * the garbage collector stops the world to sweep them up. On a Pico that pause
 * is measured in milliseconds — long enough to miss an encoder edge, drop a
 * sample, or make a 200 Hz loop stutter in a way that looks like a hardware
 * fault and is not.
 *
 * `struct.pack_into(fmt, buffer, offset, *values)` writes the same bytes
 * *into a `bytearray` you allocated once*, before the loop started. Same
 * format string, same output, no allocation, no garbage, no collector pause.
 * It is the single cheapest fix in the catalogue for a loop that stalls.
 *
 * This one is `hintOnly`. Turning `pack` into `pack_into` means choosing where
 * the buffer lives, how big it is, what offset each write lands at, and whether
 * anything downstream held on to the old `bytes` object — decisions about your
 * framing that a rewrite cannot make for you. So the rule points at the call and
 * explains, and leaves the code exactly as it found it.
 */
import type { AnyNode, Call, ForStmt, WhileStmt } from '../ast'
import { enclosingLoop, walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The module under both its spellings. */
const STRUCT_MODULES = ['struct', 'ustruct']

interface PackMatch {
  call: Call
  /** 'for' or 'while', for the message. */
  loopKind: 'for' | 'while'
}

/** Is `name` bound to `struct`/`ustruct` by an `import` in this file? */
function isStructAlias(ctx: RefactorContext, name: string): boolean {
  if (STRUCT_MODULES.includes(name)) return true
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return
    for (const alias of node.names) {
      const bound = alias.asname ?? alias.name.split('.')[0]
      if (bound === name && STRUCT_MODULES.includes(alias.name)) found = true
    }
  })
  return found
}

/**
 * Did a bare `pack` come from `from struct import pack`?
 *
 * A bare `pack(...)` is far too common a name to claim on sight — a codec, a
 * GUI layout helper and a dozen driver libraries all have one. Without an
 * import we can point at, the rule says nothing.
 */
function hasBarePackImport(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return
    if (node.level !== 0 || !node.module || !STRUCT_MODULES.includes(node.module)) return
    if (node.names.some((a) => a.name === 'pack' && !a.asname)) found = true
  })
  return found
}

/** Is this call `struct.pack(…)` — under any of its import spellings? */
function isStructPack(ctx: RefactorContext, call: Call, bareIsPack: boolean): boolean {
  const dotted = dottedName(call.func)
  if (!dotted) return false
  const parts = dotted.split('.')
  if (parts.length === 1) return bareIsPack && parts[0] === 'pack'
  if (parts.length !== 2) return false
  return parts[1] === 'pack' && isStructAlias(ctx, parts[0])
}

/** How to describe the loop this call sits in. */
function loopKindOf(loop: ForStmt | WhileStmt): 'for' | 'while' {
  return loop.type === 'For' ? 'for' : 'while'
}

export const packIntoBufferRule = defineRule<PackMatch>({
  id: 'pack-into-buffer',
  title: 'Pack into a pre-allocated buffer',
  message: '`struct.pack()` allocates a new bytes object every time round the loop',
  catalogue: 85,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pack-into-buffer',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<PackMatch>[] {
    const out: RefactorMatch<PackMatch>[] = []
    const bareIsPack = hasBarePackImport(ctx)

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Call') return
      if (!isStructPack(ctx, node, bareIsPack)) return
      // `enclosingLoop` stops at a function boundary, so a `pack()` inside a
      // helper `def` that a loop happens to call is not reported — how often
      // that helper runs is not something this file can tell us.
      const loop = enclosingLoop(node)
      if (!loop) return

      out.push({
        ruleId: 'pack-into-buffer',
        start: node.start,
        end: node.end,
        message: `\`pack()\` allocates a fresh bytes object on every pass of this \`${loopKindOf(loop)}\` — \`pack_into()\` writes into a bytearray you allocate once`,
        data: { call: node, loopKind: loopKindOf(loop) }
      })
    })

    return out
  },

  // Hint only. Where the buffer lives, how big it is and which offset each
  // write lands at are decisions about the caller's framing, not a mechanical
  // substitution — so the rule explains and changes nothing.
  apply(): TextEdit[] | null {
    return null
  }
})
