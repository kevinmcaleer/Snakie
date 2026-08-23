/**
 * Rule 49 — **This is a job for PIO** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before — the bit pattern timed in Python    # after — clocked by hardware
 * for colour in pixels:                         import neopixel
 *     for bit in range(24):                     np = neopixel.NeoPixel(data, 8)
 *         data.value(1)                         np[0] = (32, 0, 0)
 *         sleep_us(1)                           np.write()
 *         data.value(0)
 *         sleep_us(1)
 *         colour <<= 1
 * ```
 *
 * Why it matters: a WS2812 reads a bit as "how long was the line high?", and the
 * two answers it accepts are about 0.4 µs and about 0.8 µs, with a tolerance of
 * roughly ±150 ns. A Python loop cannot hold that. Between two statements the
 * interpreter may dispatch bytecode, service an interrupt, or start a garbage
 * collection — jitter that is measured in tens or hundreds of microseconds,
 * which is not a slightly wrong bit period but hundreds of bit periods. That is
 * the real cause of the symptom everyone tries to fix by nudging the sleep
 * values: the first pixel is right, the rest are the wrong colour, and the whole
 * strip flickers when anything else on the board wakes up. No amount of tuning
 * fixes it, because the number you are tuning is not the number that varies.
 *
 * The RP2040 and RP2350 have a peripheral built for exactly this. A PIO state
 * machine runs its own tiny program at a clock you choose, cycle-exact, with the
 * CPU not involved at all — so the timing does not care what the rest of your
 * program is doing. Two ready-made starting points beat writing one from
 * scratch: MicroPython ships a stock `asm_pio` WS2812 example (it is in the
 * `rp2` examples, about a dozen instructions), and the built-in `neopixel`
 * module wraps the whole thing behind `np[i] = (r, g, b)` and `np.write()`. Take
 * either one and delete the sleeps.
 *
 * Deliberately narrow. "A loop that writes a pin and sleeps" also describes a
 * stepper pulse train and a piezo buzzer, and telling someone their buzzer is a
 * broken NeoPixel driver is exactly the sort of wrong hint that costs trust. So
 * this fires only when the loop is timing something a Python loop demonstrably
 * cannot time — a sub-10 µs literal delay — or when the code says in its own
 * names and comments that it is driving WS2812s.
 *
 * Hint only: the fix is "use a different driver", not a text substitution, so
 * this rule explains and links, and never rewrites your loop.
 *
 * Gated on `caps.pio`, so it is offered only when the connected board really has
 * a PIO block. On an ESP32 the advice would be wrong, and with no board attached
 * Snakie says nothing at all.
 */
import type { AnyNode, Call, ForStmt, WhileStmt } from '../ast'
import { enclosingFunction, unwrap, walk } from '../ast'
import { callName, literalNumber } from '../expr'
import { lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

type Loop = ForStmt | WhileStmt

/** Zero-argument pin methods that drive the line rather than read it. */
const PIN_WRITE_METHODS = new Set(['on', 'off', 'high', 'low', 'toggle'])

/**
 * Below this many microseconds a Python-level delay is fiction: the
 * interpreter's own dispatch jitter is larger than the delay being asked for.
 */
const SUB_MICROSECOND_US = 10

/** Names and comments that say "this is a WS2812 driver" out loud. */
const ADDRESSABLE_LED = /ws2811|ws2812|sk6812|apa10[26]|neo_?pixel|neopix\b/i

interface NeopixelMatch {
  /** Smallest literal microsecond delay in the loop, when there is one. */
  shortest: number | null
  /** The loop's own text says WS2812/NeoPixel. */
  named: boolean
  /** Pin writes counted in the loop body. */
  writes: number
}

/** `pin.value(1)`, `led.on()` — a write to the line, not a read of it. */
function isPinWrite(node: AnyNode): boolean {
  if (node.type !== 'Call') return false
  const func = unwrap(node.func)
  if (func.type !== 'Attribute') return false
  // `value()` with no argument reads; `value(1)` drives.
  if (func.attr === 'value') return node.args.length >= 1
  return PIN_WRITE_METHODS.has(func.attr) && node.args.length === 0
}

/** `sleep_us(1)` / `time.sleep_us(1)` / `utime.sleep_us(1)`. */
function isMicrosecondSleep(node: AnyNode): node is Call {
  return node.type === 'Call' && callName(node.func) === 'sleep_us'
}

/** Start of the run of comment lines sitting directly above `offset`'s line. */
function commentBlockStart(ctx: RefactorContext, offset: number): number {
  let start = lineStart(ctx.src, offset)
  while (start > 0) {
    const previous = lineStart(ctx.src, start - 1)
    if (!ctx.src.slice(previous, start).trim().startsWith('#')) break
    start = previous
  }
  return start
}

/**
 * Does this loop say, in its own text, that it drives an addressable LED strip?
 *
 * The evidence has to be *at the loop*: its own body (which is where the pin it
 * writes and the `T0H`/`T1H` constants it sleeps for live), the comment block
 * directly above it, or the name of the function it belongs to. Reading the
 * whole enclosing function instead finds the word "neopixel" in code that has
 * nothing to do with this loop — a function that updates a `neopixel` bar (the
 * very module this rule recommends) and then chirps a buzzer in a `sleep_us`
 * loop would be told its buzzer is a hand-rolled WS2812 driver, which is exactly
 * the wrong hint this rule's narrowness exists to avoid.
 */
function mentionsAddressableLed(ctx: RefactorContext, loop: Loop): boolean {
  const from = commentBlockStart(ctx, loop.start)
  if (ADDRESSABLE_LED.test(ctx.src.slice(from, loop.end))) return true
  const fn = enclosingFunction(loop)
  return fn != null && fn.type === 'FunctionDef' && ADDRESSABLE_LED.test(fn.name)
}

/**
 * Count the pin writes and microsecond sleeps in a loop body, ignoring anything
 * inside a nested `def`/`lambda`/`class` — that code runs when it is called, not
 * when the loop spins, so it is not part of this loop's timing.
 */
function analyseLoop(ctx: RefactorContext, loop: Loop): NeopixelMatch | null {
  let writes = 0
  let sleeps = 0
  let shortest: number | null = null

  for (const stmt of loop.body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
        return false
      }
      if (isPinWrite(node)) {
        writes++
      } else if (isMicrosecondSleep(node)) {
        sleeps++
        const us = node.args.length === 1 ? literalNumber(node.args[0]) : null
        if (us != null && us >= 0 && (shortest == null || us < shortest)) shortest = us
      }
      return undefined
    })
  }

  if (writes === 0 || sleeps === 0) return null
  return { shortest, named: mentionsAddressableLed(ctx, loop), writes }
}

export const pioNeopixelRule = defineRule<NeopixelMatch>({
  id: 'pio-neopixel',
  title: 'This is a job for PIO',
  message: 'This loop bit-bangs a timed pulse train — a PIO state machine clocks it in hardware',
  catalogue: 49,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-pio-neopixel',
  // Moving to PIO (or to the `neopixel` module) is a change of driver, not a
  // behaviour-preserving tidy-up.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.pio,

  detect(ctx: RefactorContext): RefactorMatch<NeopixelMatch>[] {
    const out: RefactorMatch<NeopixelMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return undefined
      const found = analyseLoop(ctx, node)
      if (!found) return undefined

      const tight = found.shortest != null && found.shortest < SUB_MICROSECOND_US
      // Every loop that writes a pin and sleeps is NOT a broken NeoPixel driver
      // — a stepper pulse train looks identical. Only claim it when the timing
      // is provably beyond Python, or when the code says so itself.
      if (!tight && !found.named) return undefined

      const hedged = ctx.capabilities?.inferred === true
      const board = hedged ? 'your board probably has' : 'your board has'
      const why = tight
        ? `a ${found.shortest} µs delay written in Python is jitter, not timing`
        : 'this is a hand-rolled WS2812 driver'
      out.push({
        ruleId: 'pio-neopixel',
        start: node.start,
        end: node.end,
        message: `${why} — ${board} a PIO block that can clock this exactly, and MicroPython ships a stock WS2812 program and a \`neopixel\` module built on it`,
        data: found
      })
      // One hint per bit-bang: the inner loop of a nested pair is the same
      // problem as the outer one, reported twice.
      return false
    })

    return out
  },

  // Hint only. The answer is a different driver — the stock `asm_pio` WS2812
  // program or the `neopixel` module — not an edit to these sleep values.
  apply(): TextEdit[] | null {
    return null
  }
})
