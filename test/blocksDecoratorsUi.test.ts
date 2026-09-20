import { beforeEach, describe, expect, it } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  DECORATOR_ARG_BLOCK,
  DECORATOR_BADGE_FIELD,
  DECORATOR_SUGGESTIONS,
  DecoratorField,
  decoratorBadgeVisible,
  getDecorators,
  hasDecorators,
  setDecorators
} from '../src/renderer/src/lib/blocks/palette/functions'

/**
 * THE DECORATOR LIST'S UI (A3, #1217, epic #1206).
 * =============================================================================
 *
 * A1 (#1215) gave the `def` and method blocks a decorator list and the Python
 * it writes. This is the half a learner can touch: the Decorators section in
 * the block's cog, and the `@` badge that says a block has one without their
 * having to open it.
 *
 * WHAT THESE TESTS ARE REALLY ABOUT is the cog wrap. `decompose` and `compose`
 * are Blockly's own, carrying the parameter list and the bookkeeping that
 * renames every caller; ours are wrapped around them. The failure that would
 * matter is not a missing badge — it is opening the cog to add a decorator and
 * losing the function's parameters, which is why every round trip here checks
 * both.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The mutator hooks, as they hang off a block instance once mixed in. */
interface Mutating {
  decompose: (ws: Blockly.Workspace) => Blockly.Block
  compose: (container: Blockly.Block) => void
}

/** Open the block's cog: the container block its bubble would show. */
function openCog(block: Blockly.Block, ws: Blockly.Workspace): Blockly.Block {
  return (block as unknown as Mutating).decompose(ws)
}

/** Close it again, writing whatever is in the container back to the block. */
function closeCog(block: Blockly.Block, container: Blockly.Block): void {
  ;(block as unknown as Mutating).compose(container)
}

/** The decorator entry blocks in a container's section, in order. */
function containerEntries(container: Blockly.Block): string[] {
  const input = container.inputList
    .map((i) => i.connection?.targetBlock() ?? null)
    .find((b) => b?.type === DECORATOR_ARG_BLOCK)
  const entries: string[] = []
  for (let block = input; block; block = block.getNextBlock()) {
    entries.push(String(block.getFieldValue('NAME') ?? ''))
  }
  return entries
}

/** Add one decorator entry to the end of a container's section. */
function addEntry(container: Blockly.Block, name: string): void {
  const arg = container.workspace.newBlock(DECORATOR_ARG_BLOCK)
  arg.setFieldValue(name, 'NAME')
  const last = container.inputList
    .map((i) => i.connection?.targetBlock() ?? null)
    .find((b) => b?.type === DECORATOR_ARG_BLOCK)
  if (!last) {
    // The empty section: the statement input we appended, which is the last one
    // on the container in every case — Blockly's own inputs come first.
    const section = container.inputList[container.inputList.length - 1]
    section.connection?.connect(arg.previousConnection!)
    return
  }
  let tail = last
  while (tail.getNextBlock()) tail = tail.getNextBlock()!
  tail.nextConnection?.connect(arg.previousConnection!)
}

const DEFS = ['procedures_defnoreturn', 'procedures_defreturn']

describe('the Decorators section in the cog', () => {
  it.each(DEFS)('shows what the block already has — %s', (type) => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(type)
    setDecorators(block, ['micropython.native'])
    expect(containerEntries(openCog(block, ws))).toEqual(['micropython.native'])
  })

  it.each(DEFS)('writes a decorator added in it back to the block — %s', (type) => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(type)
    const container = openCog(block, ws)
    addEntry(container, 'micropython.viper')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['micropython.viper'])
  })

  it('keeps them in the order they were dragged in', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    const container = openCog(block, ws)
    addEntry(container, 'staticmethod')
    addEntry(container, 'micropython.native')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['staticmethod', 'micropython.native'])
  })

  it('drops an entry left blank rather than writing a bare @ line', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    const container = openCog(block, ws)
    addEntry(container, '   ')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual([])
  })

  it('removes the one that was taken out of the section', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    setDecorators(block, ['property', 'classmethod'])
    const container = openCog(block, ws)
    expect(containerEntries(container)).toEqual(['property', 'classmethod'])
    // The learner drags the second entry out to the bin. `true` heals the
    // stack, the way letting go over the trash does.
    const second = container.getInputTargetBlock('SNAKIE_DECORATORS')!.getNextBlock()!
    second.dispose(true)
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['property'])
  })

  // THE ONE THAT WOULD ACTUALLY HURT. Blockly's own `compose` is what rebuilds
  // the parameter list and every caller's sockets; ours runs around it, and a
  // wrap that swallowed the container would silently empty the signature.
  //
  // Checked through the container's OTHER control — the "allow statements"
  // checkbox, which only Blockly's `compose` acts on — because a parameter
  // cannot be built here: `procedures_mutatorarg`'s validator reaches for the
  // rendered workspace behind the bubble, and these tests are headless.
  it('hands the container on to Blockly, which still reads its own half', () => {
    const ws = new Blockly.Workspace()
    // The returning `def`: its container is the one that carries the checkbox.
    const block = ws.newBlock('procedures_defreturn')
    const container = openCog(block, ws)
    expect(container.getInput('STACK')).not.toBeNull()
    addEntry(container, 'micropython.native')
    container.setFieldValue('FALSE', 'STATEMENTS')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['micropython.native'])
    // Blockly's compose ran: it is the only thing that acts on that checkbox.
    expect(block.getInput('STACK')).toBeNull()
  })

  it('is on the method block too, with its own container', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('snakie_method')
    setDecorators(block, ['property'])
    const container = openCog(block, ws)
    expect(containerEntries(container)).toEqual(['property'])
    addEntry(container, 'staticmethod')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['property', 'staticmethod'])
  })
})

describe('the @ badge', () => {
  it.each([...DEFS, 'snakie_method'])('is off a block with no decorators — %s', (type) => {
    const ws = new Blockly.Workspace()
    expect(decoratorBadgeVisible(ws.newBlock(type))).toBe(false)
  })

  it.each([...DEFS, 'snakie_method'])('names the first decorator — %s', (type) => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(type)
    setDecorators(block, ['micropython.native'])
    expect(decoratorBadgeVisible(block)).toBe(true)
    expect(block.getFieldValue(DECORATOR_BADGE_FIELD)).toBe('@micropython.native')
  })

  it('counts the rest', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defreturn')
    setDecorators(block, ['property', 'staticmethod', 'classmethod'])
    expect(block.getFieldValue(DECORATOR_BADGE_FIELD)).toBe('@property  +2')
  })

  it('goes away again when the last decorator is removed', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    setDecorators(block, ['property'])
    setDecorators(block, [])
    expect(decoratorBadgeVisible(block)).toBe(false)
    expect(block.getFieldValue(DECORATOR_BADGE_FIELD)).toBe('')
  })

  it('comes back with a file that was saved with decorators on it', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    setDecorators(block, ['property'])
    const reopened = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(Blockly.serialization.workspaces.save(ws), reopened)
    const def = reopened.getTopBlocks(false)[0]
    expect(decoratorBadgeVisible(def)).toBe(true)
    expect(def.getFieldValue(DECORATOR_BADGE_FIELD)).toBe('@property')
  })
})

describe('an entry in the section', () => {
  it('strips a pasted-in @, so the line is not @@property', () => {
    const ws = new Blockly.Workspace()
    const arg = ws.newBlock(DECORATOR_ARG_BLOCK)
    arg.setFieldValue('@property', 'NAME')
    expect(arg.getFieldValue('NAME')).toBe('property')
  })

  it('offers the MicroPython decorators as suggestions, and no assembler', () => {
    expect(DECORATOR_SUGGESTIONS).toContain('property')
    expect(DECORATOR_SUGGESTIONS).toContain('micropython.native')
    expect(DECORATOR_SUGGESTIONS).toContain('micropython.viper')
    // Deliberate: its body is not Python, so nothing in the blocks editor could
    // fill one in. Typing it still works — the field is text, not a choice.
    expect(DECORATOR_SUGGESTIONS).not.toContain('micropython.asm_thumb')
  })

  it('takes any decorator at all, not only the suggested ones', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    const container = openCog(block, ws)
    addEntry(container, 'app.route("/")')
    closeCog(block, container)
    expect(getDecorators(block)).toEqual(['app.route("/")'])
  })

  it('is a text field, not a closed dropdown', () => {
    expect(new DecoratorField()).toBeInstanceOf(Blockly.FieldTextInput)
  })
})

describe('which blocks the right-click Add decorator… offers itself on', () => {
  it.each([...DEFS, 'snakie_method'])('the ones that can take one — %s', (type) => {
    expect(hasDecorators(new Blockly.Workspace().newBlock(type))).toBe(true)
  })

  it.each(['snakie_return', 'controls_if', 'snakie_class'])('and no others — %s', (type) => {
    expect(hasDecorators(new Blockly.Workspace().newBlock(type))).toBe(false)
  })
})
