import { beforeEach, describe, expect, it } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  PYTHON_CALL,
  PYTHON_CALL_VALUE,
  argNamesHidden,
  hasArgNames,
  revealArgNames
} from '../src/renderer/src/lib/blocks/palette/python'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE KEYWORD-NAME BOX IS ONLY THERE WHEN IT HOLDS A NAME (#1163).
 * =============================================================================
 *
 * #1134 gave every argument socket on the two `call` blocks a text field for
 * the keyword name in front of it — `pixels.fill(colour=RED)` — and shipped it
 * VISIBLE. So every positional argument grew an empty white pill and an `=`
 * that is in no line of anybody's Python, which is what the reported
 * `pwm_motor_a.duty_u16(…)` block looked like: *call duty_u16 on
 * (pwm_motor_a) with ( ) = (…)*.
 *
 * The rule is the one the `def` block's extras row follows: hidden while
 * empty, there the moment it holds something. These tests hold BOTH halves —
 * the boxes' state, and the fact that their state never touches the Python,
 * which is what makes hiding them safe.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The name box for argument `i`, and the `=` that belongs to it. */
const shown = (block: Blockly.Block, i: number): boolean =>
  !!block.getField(`NAME${i}`)?.isVisible() && !!block.getField(`EQ${i}`)?.isVisible()

/** A workspace holding the blocks `python` reads back as. */
function load(python: string): Blockly.Workspace {
  const { workspace } = pythonToBlocks(python)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return ws
}

/** The one `call` block on a workspace. */
function call(ws: Blockly.Workspace): Blockly.Block {
  const block = ws.getAllBlocks(false).find((b) => b.type === PYTHON_CALL)
  if (!block) throw new Error('no call block')
  return block
}

/** The Python `source` regenerates as, through the blocks it reads back as. */
function regenerate(source: string): string {
  return generateProgram(load(source)).code
}

/** The one promise the reader makes: the program comes back the program. */
function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

/** A call block with `n` argument sockets, built the way the toolbox does. */
function fresh(ws: Blockly.Workspace, n = 1, type = PYTHON_CALL): Blockly.Block {
  const block = ws.newBlock(type)
  ;(block as unknown as { updateArgs_: (n: number) => void }).updateArgs_(n)
  return block
}

describe('the argument name boxes', () => {
  it('are installed on both call blocks and nothing else', () => {
    const ws = new Blockly.Workspace()
    expect(hasArgNames(ws.newBlock(PYTHON_CALL))).toBe(true)
    expect(hasArgNames(ws.newBlock(PYTHON_CALL_VALUE))).toBe(true)
    expect(hasArgNames(ws.newBlock('procedures_defnoreturn'))).toBe(false)
  })

  it('start put away on a block dragged fresh out of the toolbox', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(PYTHON_CALL)
    expect(shown(block, 0)).toBe(false)
    expect(block.getFieldValue('NAME0')).toBe('')
  })

  it('stay put away on a positional call read back from Python', () => {
    const block = call(load('sensor.configure(1, 2)\n'))
    expect(shown(block, 0)).toBe(false)
    expect(shown(block, 1)).toBe(false)
    expect(argNamesHidden(block)).toBe(true)
  })

  it('show themselves for a keyword argument read back from Python', () => {
    // The reader puts the name in the field, and the field's own validator
    // brings the box out as the value arrives — the same path a saved file
    // takes. See `keywordArgument` in `python-to-blocks.ts` (#1163).
    const block = call(load('pixels.fill(1, colour=2)\n'))
    expect(block.getFieldValue('NAME1')).toBe('colour')
    expect(shown(block, 1)).toBe(true)
    // And only that one: the positional argument beside it keeps its hole shut.
    expect(shown(block, 0)).toBe(false)
  })

  it('show themselves for the argument that has a name', () => {
    const ws = new Blockly.Workspace()
    const block = fresh(ws, 2)
    block.setFieldValue('colour', 'NAME1')
    expect(shown(block, 1)).toBe(true)
    // And only that one: the positional argument beside it keeps its hole shut.
    expect(shown(block, 0)).toBe(false)
    expect(argNamesHidden(block)).toBe(true)
  })

  it('are put away again on an argument the `−` button and `+` rebuild', () => {
    const ws = new Blockly.Workspace()
    const block = fresh(ws, 2)
    block.setFieldValue('colour', 'NAME1')
    expect(shown(block, 1)).toBe(true)
    const args = block as unknown as { updateArgs_: (n: number) => void }
    args.updateArgs_(1)
    args.updateArgs_(2)
    expect(shown(block, 1)).toBe(false)
  })

  it('all come out when the block is asked, as the context menu does', () => {
    const ws = new Blockly.Workspace()
    const block = fresh(ws, 3)
    const field = revealArgNames(block)
    expect(shown(block, 0)).toBe(true)
    expect(shown(block, 2)).toBe(true)
    expect(argNamesHidden(block)).toBe(false)
    // The editor opens on the first argument with no name on it.
    expect(field).toBe(block.getField('NAME0'))
  })

  it('opens on the first UNNAMED argument when some already have names', () => {
    const ws = new Blockly.Workspace()
    const block = fresh(ws, 3)
    block.setFieldValue('colour', 'NAME0')
    expect(revealArgNames(block)).toBe(block.getField('NAME1'))
  })

  it('lapse back to the empty ones once an editor closes', () => {
    // The reveal is not sticky: naming the second of three arguments leaves one
    // box on screen, not three.
    const ws = new Blockly.Workspace()
    const block = fresh(ws, 3)
    revealArgNames(block)
    block.setFieldValue('colour', 'NAME1')
    const field = block.getField('NAME1') as Blockly.Field & {
      onFinishEditing_: (value: string) => void
    }
    field.onFinishEditing_('colour')
    expect(shown(block, 0)).toBe(false)
    expect(shown(block, 1)).toBe(true)
    expect(shown(block, 2)).toBe(false)
  })
})

describe('what a box’s visibility does to the Python — nothing', () => {
  it('writes the same positional call whether the empty boxes are shown', () => {
    const ws = load('sensor.configure(1, 2)\n')
    const before = generateProgram(ws).code
    revealArgNames(call(ws))
    expect(generateProgram(ws).code).toBe(before)
    expect(before).toContain('sensor.configure(1, 2)')
  })

  it('keeps writing the keyword argument a box that is off screen holds', () => {
    const ws = load('sensor.configure(1, 2)\n')
    const block = call(ws)
    block.setFieldValue('colour', 'NAME1')
    block.getField('NAME1')?.setVisible(false)
    expect(generateProgram(ws).code).toContain('sensor.configure(1, colour=2)')
  })

  it('brings a saved name’s box back on reopen', () => {
    const ws = load('sensor.configure(1, 2)\n')
    call(ws).setFieldValue('colour', 'NAME1')
    const saved = Blockly.serialization.workspaces.save(ws)
    const reopened = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(saved, reopened)
    const block = call(reopened)
    expect(block.getFieldValue('NAME1')).toBe('colour')
    // The value is what decides, not the state the workspace was saved in —
    // `updateArgs_` builds the boxes away, and the value brings this one back.
    expect(shown(block, 1)).toBe(true)
    expect(shown(block, 0)).toBe(false)
  })
})

/**
 * THE OTHER HALF OF #1134, read back (#1163).
 *
 * A call block writes `${sanitise(name)}=${value}` when its name box holds
 * something. Until now reading that line back put the whole `colour=2` in a
 * grey value block inside the socket — so a block the learner had just built
 * came back as something they could not have built.
 */
describe('a keyword argument comes back as a name and a value', () => {
  it('splits the name off the socket', () => {
    const block = call(load('pixels.fill(1, colour=2)\n'))
    expect(block.getFieldValue('NAME1')).toBe('colour')
    // The socket holds the VALUE, as a real block — not the whole `colour=2`.
    expect(block.getInputTargetBlock('ARG1')?.type).toBe('math_number')
    roundTrips('pixels.fill(1, colour=2)\n')
  })

  it('takes the name however it was spaced, and writes it back one way', () => {
    // The gate compares a line's SHAPE, so `colour = 2` and `colour=2` are the
    // same program and a learner who spaces theirs still gets a real block.
    const block = call(load('pixels.fill(colour = 2)\n'))
    expect(block.getFieldValue('NAME0')).toBe('colour')
    expect(regenerate('pixels.fill(colour = 2)\n')).toBe('pixels.fill(colour=2)\n')
  })

  it('keeps a value the reader cannot model, in the socket', () => {
    const block = call(load('xs.sort(key=lambda v: v)\n'))
    expect(block.getFieldValue('NAME0')).toBe('key')
    expect(block.getInputTargetBlock('ARG0')?.getFieldValue('CODE')).toBe('lambda v: v')
    roundTrips('xs.sort(key=lambda v: v)\n')
  })

  it('is not fooled by the operators that merely contain an `=`', () => {
    // The tokenizer takes its operators longest first, so none of these is an
    // `=` and none of them is claimed.
    for (const line of ['obj.go(a == b)\n', 'obj.go(a != b)\n', 'obj.go(a <= b)\n']) {
      const block = call(load(line))
      expect(block.getFieldValue('NAME0')).toBe('')
      roundTrips(line)
    }
  })

  it('claims the name of a comparison that really is a keyword argument', () => {
    const block = call(load('obj.go(a=b == c)\n'))
    expect(block.getFieldValue('NAME0')).toBe('a')
    expect(block.getInputTargetBlock('ARG0')?.type).toBe('logic_compare')
    roundTrips('obj.go(a=b == c)\n')
  })

  it('leaves a walrus alone', () => {
    // `x := 5` lexes as `:` then `=`, so the token after the name is not the
    // one this wants — and the line stays the learner's own.
    roundTrips('obj.go(x := 5)\n')
  })
})
