import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { CLASSES } from '../src/renderer/src/lib/blocks/palette/structure'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { functionsFlyout } from '../src/renderer/src/lib/blocks/functions-drawer'
import type { BlockLevel } from '../src/renderer/src/lib/blocks/registry'

/**
 * THE CLASSES DRAWER (B1, #1220, epic #1206).
 * =============================================================================
 *
 * `class`, `self` and `super()` were registered, generated and read back, and
 * were in no drawer at all — `hidden` on the first two, and a Functions
 * category whose `custom` callback returned only Blockly's procedure blocks for
 * the third. B1 puts all three on a `Functions ▸ Classes` shelf, at the
 * advanced level: offered to a learner who has turned the advanced blocks on,
 * and absent for the one who has not.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The Functions drawer as the flyout builds it, for a fresh workspace. */
function functions(level: BlockLevel): Record<string, unknown>[] {
  const ws = new Blockly.Workspace()
  return functionsFlyout(ws as unknown as Blockly.WorkspaceSvg, 'micropython', level)
}

/** The Classes shelf out of a Functions drawer, if it is there. */
function classesShelf(
  level: BlockLevel
): { name: string; contents: Record<string, unknown>[] } | undefined {
  return functions(level).find((c) => c.toolboxitemid === CLASSES.id) as
    | { name: string; contents: Record<string, unknown>[] }
    | undefined
}

describe('the three blocks can be reached', () => {
  it('is no longer hidden, and is advanced', () => {
    for (const type of ['snakie_class', 'snakie_self', 'snakie_super']) {
      const def = blockDefinition(type)!
      expect(def.hidden, type).toBeUndefined()
      expect(def.level, type).toBe('advanced')
      expect(def.group?.id, type).toBe(CLASSES.id)
    }
  })

  it('sits on a Classes shelf in advanced mode, under a line saying what it is for', () => {
    const shelf = classesShelf('advanced')!
    expect(shelf).toBeTruthy()
    expect(shelf.name).toBe('Classes')
    expect(shelf.contents[0]).toEqual({ kind: 'label', text: CLASSES.hint })
    expect(shelf.contents.filter((c) => c.kind === 'block').map((c) => c.type)).toEqual([
      'snakie_class',
      'snakie_self',
      'snakie_super'
    ])
  })

  it('is not in the drawer at all in simple mode', () => {
    expect(classesShelf('simple')).toBeUndefined()
    const flat = JSON.stringify(functions('simple'))
    for (const type of ['snakie_class', 'snakie_self', 'snakie_super'])
      expect(flat, type).not.toContain(type)
  })

  it('keeps the method block hidden — B2 rebuilds its signature first', () => {
    expect(blockDefinition('snakie_method')!.hidden).toBe(true)
  })
})

describe('the drawer still opens on Blockly’s own list (#1045)', () => {
  it('offers the `def` blocks first, then the registry’s own', () => {
    const items = functions('advanced')
    const types = items.filter((c) => c.kind === 'block').map((c) => c.type)
    expect(types[0]).toBe('procedures_defnoreturn')
    expect(types).toContain('procedures_defreturn')
    // Reachable since #1220 — the reason the drawer stopped being Blockly's.
    expect(types).toContain('snakie_return')
    // And exactly once: the nameless originals of the blocks Blockly issues
    // stand down, as they do in the Variables drawer.
    expect(types.filter((t) => t === 'procedures_defnoreturn')).toHaveLength(1)
  })
})

describe('what the class block writes is unchanged', () => {
  it('keeps the BASES bracket convention — `(Base, Mixin)`, verbatim', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            { type: 'snakie_class', id: 'c', fields: { NAME: 'Robot', BASES: '(Base, Mixin)' } }
          ]
        }
      },
      ws
    )
    const block = ws.getBlockById('c')!
    expect(block.getFieldValue('BASES')).toBe('(Base, Mixin)')
    // The flyout copy carries no bases, so a first class is `class Thing:`.
    expect(blockDefinition('snakie_class')!.toolbox?.fields).toBeUndefined()
  })
})
