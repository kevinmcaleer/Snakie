/**
 * Rule 60 — **Name this register** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                                # after (by hand)
 * import machine                          from micropython import const
 *                                         import machine
 * def pulse(count):
 *     for _ in range(count):              SIO_GPIO_OUT_XOR = const(0xD000001C)
 *         machine.mem32[0xD000001C] = 1 << 25   LED_MASK = const(1 << 25)
 *
 *                                         def pulse(count):
 *                                             for _ in range(count):
 *                                                 machine.mem32[SIO_GPIO_OUT_XOR] = LED_MASK
 * ```
 *
 * Why it matters: `mem32[0xD000001C]` tells the next reader nothing. It does not
 * say which peripheral, which register, or what the write is supposed to do —
 * and in six months, when you come back to work out why the encoder stopped, it
 * will not tell *you* either. `SIO_GPIO_OUT_XOR` says all three, and it is the
 * name printed in the datasheet, so a reader can look it up. Register banging is
 * already the least forgiving code in the file; the least it can do is say what
 * it is touching.
 *
 * There is a second, quieter reason to use `const()` rather than a plain
 * assignment. `SIO = 0xD0000000` creates a module-level global: the compiler
 * emits a dictionary lookup at every use, and the value sits in RAM for the life
 * of the program. `SIO = const(0xD0000000)` is substituted **at compile time** —
 * the number is baked straight into the bytecode, there is no global, no lookup
 * and no RAM cost. On the hot path where you are hand-writing register accesses,
 * that is exactly the trade you wanted.
 *
 * ```python
 * from micropython import const
 *
 * SIO_BASE = const(0xD0000000)
 * GPIO_OUT = const(SIO_BASE + 0x10)   # const() folds this too
 * ```
 *
 * A name that starts with an underscore goes further: MicroPython drops
 * `_PRIVATE = const(…)` from the module's globals dict entirely once it has been
 * folded, so it costs nothing at all.
 *
 * This is a hint and stays a hint. Only you know which register `0x4001C00C` is
 * — the rule can see that a bare address is being poked, but inventing a name
 * for it would mean inventing the datasheet, and a *wrong* name is far worse
 * than a bare number. So it points at the address and leaves the naming to you.
 *
 * **Note what this rule does not do:** it says nothing about which chip you are
 * on, and it never infers an architecture from the address. Two boards can put
 * completely different peripherals at the same number.
 *
 * Gated on a board being connected at all — this is advice about the silicon in
 * front of you, and Snakie says nothing about a board it cannot see.
 */
import type { AnyNode, Subscript } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, literalNumber, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The three raw-memory windows `machine` exposes. */
const MEM_WINDOWS = new Set(['mem8', 'mem16', 'mem32'])

/**
 * Below this, a bare number is far more likely to be an index than a peripheral
 * address. 0x1000 is where the memory maps of every port we care about start
 * putting things.
 */
const LOWEST_ADDRESS = 0x1000

interface RegisterMatch {
  node: Subscript
  /** `mem8` / `mem16` / `mem32`, for the message. */
  window: string
  /** The address exactly as written, so `0xD000001C` survives. */
  address: string
}

/** Is `name` bound to the `machine` module by an import in this file? */
function isMachineAlias(ctx: RefactorContext, name: string): boolean {
  if (name === 'machine') return true
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return undefined
    for (const alias of node.names) {
      const bound = alias.asname ?? alias.name.split('.')[0]
      if (bound === name && alias.name === 'machine') found = true
    }
    return undefined
  })
  return found
}

/**
 * Did a bare `mem32` come from `from machine import mem32`?
 *
 * Without an import to point at, a bare `mem32[…]` is just a subscript of some
 * name that happens to look familiar — a dict, a list, a driver's own register
 * cache. Claiming it would be guessing.
 */
function barePorts(ctx: RefactorContext): Set<string> {
  const out = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return undefined
    if (node.level !== 0 || node.module !== 'machine') return undefined
    for (const alias of node.names) {
      if (!alias.asname && MEM_WINDOWS.has(alias.name)) out.add(alias.name)
    }
    return undefined
  })
  return out
}

/** Which `mem*` window this subscript reads, or null if it is not one. */
function memWindow(ctx: RefactorContext, node: Subscript, bare: Set<string>): string | null {
  const dotted = dottedName(node.value)
  if (!dotted) return null
  const parts = dotted.split('.')
  const window = parts[parts.length - 1]
  if (!MEM_WINDOWS.has(window)) return null
  if (parts.length === 1) return bare.has(window) ? window : null
  if (parts.length !== 2) return null
  return isMachineAlias(ctx, parts[0]) ? window : null
}

export const nameTheRegisterRule = defineRule<RegisterMatch>({
  id: 'name-the-register',
  title: 'Name this register',
  message: 'A bare address says nothing — pull it into a named const()',
  catalogue: 60,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-name-the-register',
  // Naming a register is documentation the file does not contain; only its
  // author can supply it.
  safe: false,
  hintOnly: true,
  // Advice about the silicon in front of you: no board, no hint.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<RegisterMatch>[] {
    const out: RefactorMatch<RegisterMatch>[] = []
    const bare = barePorts(ctx)

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Subscript') return undefined
      const window = memWindow(ctx, node, bare)
      if (!window) return undefined

      // Only a naked literal. `mem32[SIO_BASE + 0x10]` has already been named —
      // the offset next to a named base is exactly how the datasheet reads.
      const address = unwrap(node.slice)
      if (address.type !== 'Constant' || address.kind !== 'number') return undefined
      const raw = address.raw.replace(/_/g, '')
      if (/[.jJ]/.test(raw)) return undefined
      const value = literalNumber(address)
      if (value == null || !Number.isInteger(value)) return undefined
      const isHex = /^0[xX]/.test(raw)
      if (!isHex && value < LOWEST_ADDRESS) return undefined

      out.push({
        ruleId: 'name-the-register',
        start: node.start,
        end: node.end,
        message: `\`${window}[${textOf(ctx, address)}]\` — give this address the name the datasheet uses, as a \`const()\`, so the next reader knows which register it is`,
        data: { node, window, address: textOf(ctx, address) }
      })
      return undefined
    })

    return out
  },

  // Hint only. The rule can see that a bare address is being poked; it cannot
  // know which peripheral lives there, and a wrong name is worse than a number.
  apply(): TextEdit[] | null {
    return null
  }
})
