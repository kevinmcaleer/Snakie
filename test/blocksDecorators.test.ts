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
  getDecorators,
  setDecorators
} from '../src/renderer/src/lib/blocks/palette/functions'

/**
 * DECORATORS ON THE DEFINITION BLOCKS (A1, #1215, epic #1206).
 * =============================================================================
 *
 * The list lives in the block's mutation, so the thing these tests are really
 * about is the ROUND TRIP: a `def` with no decorators, with one, and with three
 * has to generate the same Python after being saved and opened again. That is
 * the one failure the feature can have that a learner would only find out about
 * the next morning, with their file already written.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** Save `ws` and load it back, the way closing and reopening a file does. */
function roundTrip(ws: Blockly.Workspace): Blockly.Workspace {
  const saved = Blockly.serialization.workspaces.save(ws)
  const reopened = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(saved, reopened)
  return reopened
}

/** A `def` block named `blink`, with `decorators` on it. */
function defWith(type: string, decorators: readonly string[]): Blockly.Workspace {
  const ws = new Blockly.Workspace()
  const block = ws.newBlock(type)
  block.setFieldValue('blink', 'NAME')
  setDecorators(block, decorators)
  return ws
}

/** The one definition block on a workspace. */
function def(ws: Blockly.Workspace): Blockly.Block {
  const block = ws.getTopBlocks(false).find((b) => b.type.startsWith('procedures_def'))
  if (!block) throw new Error('no definition block')
  return block
}

describe('the decorator list', () => {
  it('is empty on a block dragged fresh out of the toolbox', () => {
    const ws = new Blockly.Workspace()
    expect(getDecorators(ws.newBlock('procedures_defnoreturn'))).toEqual([])
  })

  it('stores entries verbatim, without the leading @', () => {
    const ws = defWith('procedures_defnoreturn', ['@property', ' micropython.native ', ''])
    expect(getDecorators(def(ws))).toEqual(['property', 'micropython.native'])
  })

  it('keeps the parameter list working — the mutator is untouched', () => {
    // A `def` with a parameter, as Blockly's own procedure mutator saves one.
    // The decorators ride alongside it in the same extra state, which is the
    // whole risk this wrap runs: replacing the hooks rather than wrapping them
    // would lose `times` and leave every caller passing an argument to nothing.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        variables: [{ name: 'times', id: 'times_id' }],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'procedures_defnoreturn',
              fields: { NAME: 'blink' },
              extraState: { params: [{ name: 'times', id: 'times_id' }] }
            }
          ]
        }
      },
      ws
    )
    setDecorators(def(ws), ['property'])
    const reopened = roundTrip(ws)
    expect(generateProgram(reopened).code).toContain('@property\ndef blink(times):')
    expect(getDecorators(def(reopened))).toEqual(['property'])
  })
})

describe('what a decorated def generates', () => {
  for (const type of ['procedures_defnoreturn', 'procedures_defreturn']) {
    it(`writes no @ lines for ${type} with none`, () => {
      const code = generateProgram(defWith(type, [])).code
      expect(code).toContain('def blink():')
      expect(code).not.toContain('@')
    })

    it(`writes the entries in order above the def line for ${type}`, () => {
      const code = generateProgram(defWith(type, ['one', 'two', 'three'])).code
      expect(code).toContain('@one\n@two\n@three\ndef blink():')
    })
  }

  it('asks the import manager for `micropython` when a native decorator needs it', () => {
    const code = generateProgram(defWith('procedures_defnoreturn', ['micropython.native'])).code
    expect(code).toContain('import micropython')
    expect(code.indexOf('import micropython')).toBeLessThan(code.indexOf('@micropython.native'))
  })

  it('leaves the import out for a decorator that needs nothing', () => {
    const code = generateProgram(defWith('procedures_defnoreturn', ['property'])).code
    expect(code).not.toContain('import micropython')
  })
})

describe('the round trip — zero, one and three decorators', () => {
  for (const type of ['procedures_defnoreturn', 'procedures_defreturn']) {
    for (const decorators of [[], ['property'], ['micropython.native', 'foo', 'app.route("/")']]) {
      it(`generates identical Python for ${type} with ${decorators.length}`, () => {
        const ws = defWith(type, decorators)
        const before = generateProgram(ws).code
        expect(generateProgram(roundTrip(ws)).code).toBe(before)
        expect(getDecorators(def(roundTrip(ws)))).toEqual(decorators)
      })
    }
  }
})

describe('the method block’s decorators', () => {
  /** A `snakie_method` block, with a workspace of its own. */
  function method(): { ws: Blockly.Workspace; block: Blockly.Block } {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('snakie_method')
    block.setFieldValue('speed', 'NAME')
    return { ws, block }
  }

  it('reads the old DECORATOR dropdown as a list of one', () => {
    const { block } = method()
    block.setFieldValue('property', 'DECORATOR')
    expect(getDecorators(block)).toEqual(['property'])
  })

  it('prefers the list once the block has one', () => {
    const { block } = method()
    block.setFieldValue('property', 'DECORATOR')
    setDecorators(block, ['staticmethod', 'micropython.native'])
    expect(getDecorators(block)).toEqual(['staticmethod', 'micropython.native'])
  })

  it('writes the entries above the def line, in order', () => {
    const { ws, block } = method()
    setDecorators(block, ['property', 'app.route("/")'])
    expect(generateProgram(ws).code).toContain('@property\n@app.route("/")\ndef speed(self):')
  })

  it('still writes the migrated dropdown value', () => {
    const { ws, block } = method()
    block.setFieldValue('classmethod', 'DECORATOR')
    expect(generateProgram(ws).code).toContain('@classmethod\ndef speed(self):')
  })

  it('survives a round trip, dropdown and list alike', () => {
    const { ws, block } = method()
    block.setFieldValue('property', 'DECORATOR')
    setDecorators(block, ['property', 'micropython.viper'])
    const before = generateProgram(ws).code
    const reopened = roundTrip(ws)
    expect(generateProgram(reopened).code).toBe(before)
  })
})
