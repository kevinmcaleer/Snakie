import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { categoryContents } from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * `try` AND `raise` IN THE TOOLBOX (#1131, epic #1119).
 * =============================================================================
 *
 * W7 (#1094) built both blocks and registered them `hidden: true`, on the rule
 * §4.5 states: the reader is comprehensive, the toolbox is curated, and mostly
 * the answer is no. #1119 re-takes that decision, and `try` is the strongest
 * candidate in the hidden set — error handling is not an advanced topic on
 * hardware, it is the difference between a robot that stops dead when a sensor
 * is unplugged and one that carries on.
 *
 * FLIPPING THE FIELD WAS NOT THE WORK. The wording was, the placement was, and
 * so was the safety default: a bare `except:` catches `KeyboardInterrupt`,
 * which makes a program you cannot Ctrl-C out of.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** Build a workspace from serialised JSON and generate it. */
function generate(blocks: unknown[]): string {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code
}

/** The Control drawer's entries, as the flyout builds them. */
function control(): Record<string, unknown>[] {
  return categoryContents(BLOCK_CATEGORIES.find((c) => c.id === 'control')!, 'micropython')
}

describe('they can be reached', () => {
  it('is no longer hidden', () => {
    expect(blockDefinition('snakie_try')!.hidden).toBeUndefined()
    expect(blockDefinition('snakie_raise')!.hidden).toBeUndefined()
  })

  it('sits on a shelf, so Control still opens on `forever`', () => {
    const contents = control()
    const loose = contents.filter((c) => c.kind === 'block').map((c) => c.type)
    expect(loose[0]).toBe('snakie_forever')
    expect(loose).not.toContain('snakie_try')
    const shelves = contents.filter((c) => c.kind === 'category') as {
      name: string
      contents: { kind: string; type?: string }[]
    }[]
    const shelf = shelves.find((c) => c.name === 'When things go wrong')!
    expect(shelf).toBeTruthy()
    // Both are advanced, so the shelf opens on the `Advanced` marker (#1211).
    expect(shelf.contents.filter((c) => c.kind === 'block').map((c) => c.type)).toEqual([
      'snakie_try',
      'snakie_raise'
    ])
  })
})

describe('the flyout copy is safe to run', () => {
  it('arrives with one arm, naming a kind rather than catching everything', () => {
    // A bare `except:` catches KeyboardInterrupt, which makes a program you
    // cannot Ctrl-C out of — the worst possible first experience of this block.
    const state = blockDefinition('snakie_try')!.toolbox!.extraState as {
      excepts: string[]
      hasElse: boolean
      hasFinally: boolean
    }
    expect(state.excepts).toEqual(['OSError'])
    expect(state.hasElse).toBe(false)
    expect(state.hasFinally).toBe(false)
  })

  it('generates a runnable `try` straight out of the flyout', () => {
    expect(
      generate([
        {
          type: 'snakie_try',
          id: 't',
          extraState: { excepts: ['OSError'], hasElse: false, hasFinally: false },
          fields: { EXCEPT0: 'OSError' }
        }
      ])
    ).toBe('try:\n    pass\nexcept OSError:\n    pass\n')
  })
})

describe('the arms are reachable now', () => {
  it('has buttons for another arm and for the other two', () => {
    // W7 built `updateShape_` for the READER, which knows how many arms a file
    // has. A learner dragging one out had no way to ask for a second `except`
    // or for a `finally`, which is most of what makes the block worth having.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_try',
              id: 't',
              extraState: { excepts: ['OSError'], hasElse: false, hasFinally: false }
            }
          ]
        }
      },
      ws
    )
    const block = ws.getBlockById('t')!
    for (const field of ['ADD_EXCEPT', 'REMOVE_EXCEPT', 'TOGGLE_ELSE', 'TOGGLE_FINALLY']) {
      expect(block.getField(field), field).toBeTruthy()
    }
  })
})

describe('existing programs are untouched', () => {
  it('still reads every arm back, with the kind it named', () => {
    const source = [
      'try:',
      '    print(1)',
      'except OSError as error:',
      '    print(error)',
      'except ValueError:',
      '    print(3)',
      'else:',
      '    print(4)',
      'finally:',
      '    print(5)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
    expect(root.type).toBe('snakie_try')
    expect(root.fields).toMatchObject({ EXCEPT0: 'OSError as error', EXCEPT1: 'ValueError' })
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    expect(generateProgram(ws).code).toBe(source)
  })

  it('opens a workspace saved while the block was hidden', () => {
    // The serialisation did not change, only the wording and the flyout.
    expect(
      generate([
        {
          type: 'snakie_try',
          id: 't',
          extraState: { excepts: [''], hasElse: false, hasFinally: true },
          fields: { EXCEPT0: '' }
        }
      ])
    ).toBe('try:\n    pass\nexcept:\n    pass\nfinally:\n    pass\n')
  })
})
