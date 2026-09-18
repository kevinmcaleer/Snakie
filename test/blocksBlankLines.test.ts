import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { logicalLines } from '../src/renderer/src/lib/blocks/python-tokens'

/**
 * BLANK LINES SURVIVE THE ROUND TRIP.
 * =============================================================================
 *
 * The code pane is editable, its text is turned back into blocks when the
 * learner pauses, and the file is regenerated FROM those blocks. So anything the
 * conversion does not carry is something that disappears a moment after it is
 * typed — and `logicalLines` used to drop every blank line on the floor.
 *
 * Which meant pressing Enter to make room to write, the ordinary way anybody
 * writes anything, opened a gap that closed itself again. Worse than losing
 * formatting: it moved the cursor out from under the thing being typed.
 *
 * TWO RULES, and the second is all the subtlety there is:
 *
 *  1. a blank line the learner typed comes back;
 *  2. except the one under a hoisted section — the imports, a top-level `def` —
 *     where the generator writes a separator of its own and a second would make
 *     the gap two lines deep every time the program went round.
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

/** THE property, as the rest of the decompiler states it: in is out. */
const roundTrips = (source: string): void => expect(regenerate(source)).toBe(source)

describe('logicalLines counts them', () => {
  it('against the line below, so a run arrives as a run', () => {
    expect(logicalLines('print(1)\n\n\nprint(2)\n').map((l) => l.blankBefore)).toEqual([0, 2])
  })

  it('and a line of nothing but spaces is still blank', () => {
    // Its indentation must NOT be measured, or an empty line in a loop body
    // reads as a dedent and ends the suite early.
    expect(logicalLines('while True:\n    print(1)\n   \n    print(2)\n').map((l) => l.indent)).toEqual([
      0, 4, 4
    ])
  })
})

describe('a gap the learner typed comes back', () => {
  it('between two statements', () => roundTrips('print(1)\n\nprint(2)\n'))
  it('two of them', () => roundTrips('print(1)\n\n\nprint(2)\n'))
  it('inside a loop body', () => roundTrips('while True:\n    print(1)\n\n    print(2)\n'))
  it('in front of a comment', () => roundTrips('print(1)\n\n# why\nprint(2)\n'))
  it('at the very top, where no section stands above it', () =>
    roundTrips('\nprint(1)\n'))
  it('and between two groups of real work', () =>
    roundTrips(
      [
        'from machine import Pin',
        '',
        'pin_15 = Pin(15, Pin.OUT)',
        '',
        'pin_15.value(1)',
        '',
        'print(1)',
        ''
      ].join('\n')
    ))
})

describe('the gap under a hoisted section is the generator’s', () => {
  it('under the imports, counted once and not twice', () =>
    roundTrips('import time\n\nprint(1)\n'))

  it('under SEVERAL imports — it is the last one that the separator follows', () =>
    // Already alphabetical: the import manager sorts its own section, which is
    // its job and not this one's, and an unsorted fixture would be testing that
    // instead of the gap under it.
    roundTrips('import math\nimport time\n\nprint(1)\n'))

  it('and an EXTRA gap there is still the learner’s', () =>
    roundTrips('import time\n\n\nprint(1)\n'))

  it('under a top-level def, which is a root of its own', () =>
    roundTrips('def hello():\n    print(1)\n\nhello()\n'))

  it('under an import AND a def together', () =>
    roundTrips('import time\n\ndef hello():\n    time.sleep(1)\n\nhello()\n'))
})

describe('the spacer block', () => {
  it('writes one empty line and nothing else', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_python_blank',
              id: 'b',
              next: { block: { type: 'snakie_python_statement', id: 's', fields: { CODE: 'go()' } } }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toBe('\ngo()\n')
  })

  it('and a gap in front of a line that vanishes goes with it', () => {
    // `pass` filling an empty suite is dropped — every emitter writes its own —
    // so a blank kept in front of it would be a gap before nothing.
    roundTrips('while True:\n    print(1)\n')
  })
})
