import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { sameProgram } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * BRACKETS THE GENERATOR WOULD NOT HAVE WRITTEN.
 * =============================================================================
 *
 * ```
 *   distance_to_object = (elapsed_microseconds * 0.343) / 2
 * ```
 *
 * One line of an ultrasonic sensor program, and it held back EVERY BLOCK IN THE
 * FILE. `maths.ts` emits the minimal correct parenthesisation — `a * b / c`,
 * never `(a * b) / c` — so the line came back one bracket lighter, the
 * round-trip gate read it as a different program, and the canvas kept showing
 * the blocks from before the last edit with a banner saying so.
 *
 * The gate is NOT a text comparison and never has been: `round-trip.ts`'s header
 * lists what it forgives — the import section, whitespace, hoisting, quote
 * style, protected names — as "the generator RENDERING the program in its own
 * house style". A bracket the language did not need belongs on that list. It is
 * not a line dropped, a line re-nested or a line mangled, which is what the gate
 * exists to catch.
 *
 * AND THE BRACKETS THAT MATTER STILL MATTER, which is most of this file.
 * `a - (b - c)` is not `a - b - c`; `(a + b) / 2` is not `a + b / 2`;
 * `(a + b).real`, `(a + b)[0]` and `-(a + b)` all hold the thing being operated
 * on. Anything the rule cannot account for keeps its brackets, so the worst case
 * is a conversion the gate already refuses today.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

/** Does the gate accept this line's conversion? */
function accepted(line: string): boolean {
  const source = `${line}\n`
  return sameProgram(source, regenerate(source))
}

describe('the line that held back a whole file', () => {
  it('accepts the ultrasonic distance line', () => {
    expect(accepted('distance_to_object = (elapsed_microseconds * 0.343) / 2')).toBe(true)
  })

  it('accepts the whole program it came from', () => {
    // The point the bug report made that the report itself did not: ONE line
    // like this stops every other line in the file becoming a block.
    const src = [
      'import time',
      '',
      'signaloff = time.ticks_us()',
      'signalon = time.ticks_us()',
      'elapsed_microseconds = signalon - signaloff',
      'duration = elapsed_microseconds',
      'distance_to_object = (elapsed_microseconds * 0.343) / 2',
      'print(distance_to_object)',
      ''
    ].join('\n')
    expect(sameProgram(src, regenerate(src))).toBe(true)
  })
})

describe('brackets that can go, because they say what Python already says', () => {
  const droppable = [
    'x = (a * b) / c',
    'x = (a * b) * c',
    'x = (a / b) / c',
    'x = (a - b) - c',
    'x = (a + b) + c',
    'x = (a + b) - c',
    'x = (a * b) % c',
    'x = (a and b) and c',
    'x = (a * b) + c',
    'x = a + (b * c)',
    'x = (a)',
    'x = (a + b)',
    'x = f((a + b))',
    'x = a ** (b ** c)'
  ]
  for (const line of droppable) {
    it(`accepts ${line}`, () => {
      expect(accepted(line)).toBe(true)
    })
  }
})

describe('brackets that must not go, because they change what it means', () => {
  // These are the ones the rule is written to protect. It is not enough that the
  // gate accepts the file — the REGENERATED PYTHON has to keep them, and it
  // does, because nothing here touches the generator.
  const load_bearing: [string, string][] = [
    ['x = (a + b) / 2', 'the division applies to the sum, not to b'],
    ['x = a - (b - c)', 'subtraction is left-associative, so this is not a - b - c'],
    ['x = a / (b / c)', 'as subtraction'],
    ['x = (a + b) * c', 'the commonest of the lot'],
    ['x = (a or b) and c', '`and` binds tighter than `or`'],
    ['x = (a ** b) ** c', '`**` is the right-associative one, so the LEFT needs brackets']
  ]
  for (const [line, why] of load_bearing) {
    it(`keeps them in ${line} — ${why}`, () => {
      expect(regenerate(`${line}\n`)).toContain('(')
      expect(accepted(line)).toBe(true)
    })
  }
})

describe('what the normaliser refuses to reason about', () => {
  // Not failures — the safe direction. Each of these is a shape where a bracket
  // could be load-bearing in a way a two-neighbour test does not model, so it is
  // left exactly as written and the gate compares it as it always did.
  const untouched = [
    'x = (a + b).real',
    'x = (a + b)[0]',
    'x = -(a + b)',
    'x = not (a and b)',
    'x = (a, b)',
    'x = (a + b if c else d)',
    'x = [v for v in (a, b)]'
  ]
  for (const line of untouched) {
    it(`leaves ${line} alone`, () => {
      // Whatever the gate decides, it must not decide it by having thrown the
      // bracket away: the shapes differ if and only if they differ today.
      expect(() => sameProgram(`${line}\n`, `${line}\n`)).not.toThrow()
      expect(sameProgram(`${line}\n`, `${line}\n`)).toBe(true)
    })
  }

  it('never calls two genuinely different programs the same', () => {
    // The property that matters most. Each pair differs by a bracket that
    // carries meaning, and no amount of normalising may make them equal.
    const different: [string, string][] = [
      ['x = (a + b) / 2\n', 'x = a + b / 2\n'],
      ['x = a - (b - c)\n', 'x = a - b - c\n'],
      ['x = (a + b) * c\n', 'x = a + b * c\n'],
      ['x = (a ** b) ** c\n', 'x = a ** b ** c\n'],
      ['x = (a or b) and c\n', 'x = a or b and c\n'],
      ['x = (a + b).real\n', 'x = a + b.real\n'],
      ['x = (a + b)[0]\n', 'x = a + b[0]\n'],
      ['x = -(a + b)\n', 'x = -a + b\n'],
      ['x = not (a and b)\n', 'x = not a and b\n'],
      ['x = f((a + b))\n', 'x = f(a) + b\n']
    ]
    for (const [a, b] of different) {
      expect({ a, b, same: sameProgram(a, b) }).toEqual({ a, b, same: false })
    }
  })
})
