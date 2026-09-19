import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks, type BlockJson } from '../src/renderer/src/lib/blocks/python-to-blocks'
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
 *  2. except at the edge of a hoisted section — the imports, a top-level `def`,
 *     a `name pin` — where the generator writes a separator of its own and a
 *     second would make the gap two lines deep every time the program went
 *     round. #1164 is the other half of that: a gap ABOVE one of those lines is
 *     the same separator, and a spacer for it has nowhere in the file to be.
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

/**
 * The type of every block in a root's chain, in order.
 *
 * `BlocksWorkspace` is Blockly's own serialisation and is typed as loosely as
 * Blockly types it, so the shape is named here rather than asserted at each use.
 */
const chains = (source: string): string[][] => {
  const { workspace } = pythonToBlocks(source)
  const roots = (workspace as unknown as { blocks: { blocks: BlockJson[] } }).blocks.blocks
  return roots.map((root) => {
    const out: string[] = []
    for (let b: BlockJson | undefined = root; b; b = b.next?.block) out.push(b.type)
    return out
  })
}

/**
 * What the file settles on once it has been round the loop, and that it STAYS
 * there — the property that was actually broken. The old code moved a gap it
 * could not place rather than dropping it, so each trip found it somewhere new.
 */
const settlesOn = (source: string, settled: string): void => {
  expect(regenerate(source)).toBe(settled)
  expect(regenerate(settled)).toBe(settled)
}

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
  it('BETWEEN two comments, which are two paragraphs and not one', () =>
    // A run of comment siblings folds into ONE block (#1062), and a blank line
    // used not to break that run — which was harmless while blank lines were
    // dropped and silently ate this one once they were not.
    roundTrips('# one\n\n# two\nprint(1)\n'))
  it('and a run of comments with no gap is still one block', () =>
    roundTrips('# one\n# two\nprint(1)\n'))
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

/**
 * THE GAP ABOVE A `def` CANNOT BE A BLOCK (#1164).
 * ===========================================================================
 *
 * The rule above holds because a spacer block sits in the chain where it was
 * typed and the generator writes that chain out in order. A blank standing
 * directly above a TOP-LEVEL `def` has no such chain: #1145 cuts the chain
 * there and the `def` becomes a hat of its own, so the spacer rides on with the
 * blocks above it — and those are the imports, which generate nothing where
 * they stand. The gap surfaced at the top of the BODY instead, a section and
 * several hats away from where it was typed.
 *
 * Reported as a grey `blank line` block hanging under the imports with a hole
 * beneath it. The same mistake compounded down the file: `spacers` concedes one
 * blank per gap to the generator only while the body has not started, and a
 * spacer was itself counted as the body starting — so the FIRST gap in a file
 * switched the rule off for every gap after it, and every `def` boundary added
 * another grey note to the pile.
 */
describe('the gap above a top-level def is the generator’s too (#1164)', () => {
  it('leaves no spacer hanging under the imports', () =>
    // PEP 8's two blank lines before a `def` — which is to say, most real files.
    expect(chains('import time\n\n\ndef go():\n    pass\n')[0]).toEqual([
      'snakie_python_import'
    ]))

  it('and normalises that gap to the one line the generator can write', () =>
    // `sectionsOf` joins the imports, the functions, the setup and the body with
    // exactly one blank line each. There is no way to ask it for two, so the
    // second is not the learner's to keep — it is a copy of a separator.
    settlesOn(
      'import time\n\n\ndef go():\n    pass\n',
      'import time\n\ndef go():\n    pass\n'
    ))

  it('does not pile the gaps up where a run of defs was lifted out', () => {
    // Two `def`s with PEP 8 spacing around them, and a body under the last one.
    const source = [
      'import time',
      '',
      '',
      'def a():',
      '    pass',
      '',
      '',
      'def b():',
      '    pass',
      '',
      '',
      'print(1)',
      ''
    ].join('\n')
    // Six blank lines in the source; one spacer block out of them. Five stood at
    // a `def` boundary and are the separators `sectionsOf` writes. The sixth is
    // the second of the two under the last `def`, and THAT one is the learner's:
    // it opens the body, which is a chain that generates where it stands.
    //
    // The pile it used to make: the body root opened with four grey notes, and
    // the canvas had a column of them where the `def`s had been lifted out.
    expect(chains(source).map((c) => c.filter((t) => t === 'snakie_python_blank').length)).toEqual([
      0, 0, 0, 1
    ])
  })

  it('because a blank line is not the body starting', () =>
    // THE LATCH, in the smallest file that shows it. Two hoisted boundaries: the
    // gap above the `def` and the gap below it. With a spacer counted as the
    // body starting, the first one turned the separator rule off and the second
    // kept BOTH its blanks on top of the separator the generator writes — three
    // blank lines above `go()`, and another every time round.
    //
    // The gap below the `def` is still the learner's two, because that one does
    // sit in a chain that generates where it stands.
    settlesOn(
      'import time\n\n\ndef go():\n    pass\n\n\ngo()\n',
      'import time\n\ndef go():\n    pass\n\n\ngo()\n'
    ))

  it('and a gap between two statements is still the learner’s', () =>
    // The guard on the change: only the boundaries a section separator lands on
    // are the generator's. An ordinary gap in the body is untouched.
    roundTrips('print(1)\n\n\nprint(2)\n'))
})

/**
 * AND THE GAP ABOVE A `name pin` IS THE GENERATOR'S TOO (#1164).
 * ===========================================================================
 *
 * The same argument one line earlier. A `name pin` — and a `name PWM` — does not
 * generate where it stands either: its assignment goes into the SETUP section.
 * So a spacer standing above one in the chain does not stand above it in the
 * file. It surfaced at the top of the BODY, which is to say BELOW the line it
 * was written above, and the gap came back one line wider than it went in:
 *
 *     in:   import Pin ⏎⏎ motor_a = Pin(4, …) ⏎ print(1)
 *     out:  import Pin ⏎ motor_a = Pin(4, …) ⏎⏎ print(1)
 *
 * On the canvas that was a grey note floating over the `name pin` block.
 */
describe('the gap above a hoisted setup line is the generator’s (#1164)', () => {
  it('leaves no spacer over a name pin block', () =>
    expect(chains('from machine import Pin\n\n\nmotor_a = Pin(4, Pin.OUT)\n\nprint(1)\n')).toEqual([
      ['snakie_python_from_import', 'snakie_name_pin', 'text_print']
    ]))

  it('and does not move the gap to the far side of the line', () =>
    // The gap stays ABOVE the assignment, where it was typed, and settles on the
    // one blank line `sectionsOf` puts between the imports and the setup.
    settlesOn(
      'from machine import Pin\n\n\nmotor_a = Pin(4, Pin.OUT)\n\nprint(1)\n',
      'from machine import Pin\n\nmotor_a = Pin(4, Pin.OUT)\n\nprint(1)\n'
    ))

  it('which is already what a single gap there does, and still is', () =>
    roundTrips('from machine import Pin\n\nmotor_a = Pin(4, Pin.OUT)\n\nprint(1)\n'))

  it('and the same under a def, where the pile used to land', () =>
    settlesOn(
      [
        'from machine import Pin',
        '',
        '',
        'def go():',
        '    pass',
        '',
        '',
        'motor_a = Pin(4, Pin.OUT)',
        '',
        'while True:',
        '    go()',
        ''
      ].join('\n'),
      [
        'from machine import Pin',
        '',
        'def go():',
        '    pass',
        '',
        'motor_a = Pin(4, Pin.OUT)',
        '',
        'while True:',
        '    go()',
        ''
      ].join('\n')
    ))

  it('but a gap above a line that DOES stand where it is stays put', () =>
    // The guard. `pin_15 = Pin(15, Pin.OUT)` is the generator's own constructor
    // and is consumed, so `pin_15.value(1)` is an ordinary body line — the gap
    // above it is the learner's and comes back untouched.
    roundTrips('from machine import Pin\n\npin_15 = Pin(15, Pin.OUT)\n\npin_15.value(1)\n\nprint(1)\n'))
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
