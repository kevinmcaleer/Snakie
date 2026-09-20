import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { conversionShape, sameProgram } from '../src/renderer/src/lib/blocks/round-trip'
import { buildToolbox } from '../src/renderer/src/lib/blocks/toolbox'
import {
  advancedBlockTypes,
  collectBlockTypes
} from '../src/renderer/src/lib/blocks/workspace-check'
import type { BlockLevel } from '../src/renderer/src/lib/blocks/registry'

/**
 * READING NEVER DEPENDS ON THE LEVEL (#1212, epic #1206).
 * =============================================================================
 *
 * §4.5 of `docs/blocks-coverage-epic.md`: the toolbox is curated, the reader is
 * comprehensive. #1210 gave the toolbox a level to filter on, and the failure
 * mode that invites is the quiet one — a beginner opens a file full of classes
 * and gets a wall of grey `snakie_python_*` blocks, because the blocks that
 * would have read it are "not for them yet". Their file would still run, and
 * they would have no idea anything had been taken away.
 *
 * So the level is tested from the other side here: the conversion takes no
 * level, and this pins that it cannot start to. A class-heavy fixture converts
 * to the SAME blocks whichever tier the learner is in, and the advanced blocks
 * it produces are exactly the ones the simple drawer does not offer — which is
 * the whole point. They are on the canvas; they are not in the drawer.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** A fixture that is advanced from top to bottom: a class, a try, a comprehension. */
const ADVANCED_SOURCE = `class Robot:
    def __init__(self, name):
        self.name = name

    def greet(self):
        print(self.name)


def run():
    robot = Robot("Snakie")
    robot.greet()
    try:
        squares = [n * n for n in range(4)]
        print(squares)
    except ValueError:
        print("no")


run()
`

/** Convert, load, generate — the round trip the reader is judged on. */
function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

/** Every block type a toolbox offers at `level`, flattened out of the tree. */
function offered(level: BlockLevel): Set<string> {
  const out = new Set<string>()
  const walk = (items: readonly unknown[]): void => {
    for (const item of items as Record<string, unknown>[]) {
      if (item.kind === 'block' && typeof item.type === 'string') out.add(item.type)
      if (Array.isArray(item.contents)) walk(item.contents)
    }
  }
  walk((buildToolbox('micropython', level) as { contents: unknown[] }).contents)
  return out
}

describe('the reader ignores the level (#1212)', () => {
  it('gives the same blocks for advanced code however the toolbox is filtered', () => {
    // The toolbox is built at BOTH levels around the conversions, because the
    // only plausible way a level could leak into the reader is a rule registry
    // that a toolbox build had narrowed on its way past.
    buildToolbox('micropython', 'simple')
    const inSimple = pythonToBlocks(ADVANCED_SOURCE)
    buildToolbox('micropython', 'advanced')
    const inAdvanced = pythonToBlocks(ADVANCED_SOURCE)
    expect(inSimple.workspace).toEqual(inAdvanced.workspace)
    expect(inSimple.report).toEqual(inAdvanced.report)
    // And the shape the round-trip gate compares against is the same question
    // asked of the same conversion, so it cannot diverge either.
    expect(conversionShape(ADVANCED_SOURCE)).toEqual(conversionShape(ADVANCED_SOURCE))
  })

  it('still writes the advanced fixture back as the same program', () => {
    // `sameProgram` rather than string equality, because the reader hoists the
    // functions and normalises quotes — the gate's own notion of "unchanged".
    expect(sameProgram(ADVANCED_SOURCE, regenerate(ADVANCED_SOURCE))).toBe(true)
  })

  it('produces real advanced blocks, and no extra grey fallback in simple mode', () => {
    buildToolbox('micropython', 'simple')
    const simple = collectBlockTypes(pythonToBlocks(ADVANCED_SOURCE).workspace)
    buildToolbox('micropython', 'advanced')
    const advanced = collectBlockTypes(pythonToBlocks(ADVANCED_SOURCE).workspace)
    // The class and the try made blocks of their own...
    expect(simple).toContain('snakie_class')
    expect(simple).toContain('snakie_try')
    // ...and whatever DID fall back to a grey Python block is the same set
    // either way. No line is downgraded because of the level.
    const grey = (types: string[]): string[] => types.filter((t) => t.startsWith('snakie_python_'))
    expect(grey(simple)).toEqual(grey(advanced))
  })

  it('puts advanced blocks on the canvas that the simple drawer does not offer', () => {
    const { workspace } = pythonToBlocks(ADVANCED_SOURCE)
    const advanced = advancedBlockTypes(workspace, (t) => blockDefinition(t)?.level)
    expect(advanced.length).toBeGreaterThan(0)
    // Which is the state the offer exists for: on the canvas, not in the
    // drawer. (`hidden` blocks such as `class` are in neither drawer until
    // #1220 un-hides them — the reader builds them regardless, which is §4.5.)
    const simple = offered('simple')
    for (const type of advanced) {
      expect(simple.has(type), `${type} should not be in the beginner drawer`).toBe(false)
    }
  })
})

describe('advancedBlockTypes (#1212)', () => {
  const levelOf = (t: string): BlockLevel | undefined =>
    t === 'snakie_class' || t === 'snakie_try' ? 'advanced' : undefined

  it('finds advanced blocks wherever they are nested', () => {
    const ws = {
      blocks: {
        blocks: [
          {
            type: 'controls_repeat_ext',
            inputs: { DO: { block: { type: 'snakie_try', next: { block: { type: 'text' } } } } }
          }
        ]
      }
    }
    expect(advancedBlockTypes(ws, levelOf)).toEqual(['snakie_try'])
  })

  it('is empty for a beginner file, and deduplicates a type used twice', () => {
    expect(advancedBlockTypes({ blocks: { blocks: [{ type: 'text' }] } }, levelOf)).toEqual([])
    expect(
      advancedBlockTypes(
        { blocks: { blocks: [{ type: 'snakie_class' }, { type: 'snakie_class' }] } },
        levelOf
      )
    ).toEqual(['snakie_class'])
  })

  it('says nothing about a type the registry has never heard of', () => {
    // An unknown type is `unknownBlockTypes`' business (#1009), and that check
    // runs first — a file this one cannot read never reaches the offer.
    expect(advancedBlockTypes({ blocks: { blocks: [{ type: 'mystery' }] } }, levelOf)).toEqual([])
  })
})
