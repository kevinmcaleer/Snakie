import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE PROPERTY BLOCK (B3, #1222, epic #1206).
 * =============================================================================
 *
 * A settable property is two `def`s, two decorators and one idea: rename half
 * of it and the class quietly stops working. So one block holds both halves,
 * writes the name once, and keeps the setter behind a tick box — and the reader
 * folds the pair back into it.
 *
 * The centre of this file is the round trip, as everywhere else in the reader's
 * suite: what the block writes is what reading it gives back.
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

const roundTrips = (source: string): void => expect(regenerate(source)).toBe(source)

function blocks(source: string): Record<string, unknown>[] {
  const { workspace } = pythonToBlocks(source)
  const out: Record<string, unknown>[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

const types = (source: string): string[] => blocks(source).map((b) => b.type as string)
const property = (source: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === 'snakie_property')

const GETTER = [
  'class Motor:',
  '    @property',
  '    def running(self):',
  '        return True',
  ''
]

const PAIR = [
  'class Motor:',
  '    @property',
  '    def speed(self):',
  '        return self._speed',
  '',
  '    @speed.setter',
  '    def speed(self, value):',
  '        self._speed = value',
  ''
]

describe('reading a property back', () => {
  it('folds a lone `@property` into a property block with no setter', () => {
    const source = GETTER.join('\n')
    expect(types(source)).toContain('snakie_property')
    expect(types(source)).not.toContain('snakie_method')
    expect((property(source)!.fields as Record<string, unknown>).HAS_SETTER).toBe(false)
    roundTrips(source)
  })

  it('folds the getter and the `@name.setter` under it into ONE block', () => {
    const source = PAIR.join('\n')
    const found = property(source)!
    const fields = found.fields as Record<string, unknown>
    expect(fields.NAME).toBe('speed')
    expect(fields.HAS_SETTER).toBe(true)
    expect(fields.PARAM).toBe('value')
    // Both bodies are on the one block, and nothing was left behind as a method.
    expect(Object.keys(found.inputs as Record<string, unknown>).sort()).toEqual(['GET', 'SET'])
    expect(types(source)).not.toContain('snakie_method')
    roundTrips(source)
  })

  it('keeps the setter’s own word for the new value', () => {
    const source = PAIR.join('\n').replace(/value/g, 'rpm')
    expect((property(source)!.fields as Record<string, unknown>).PARAM).toBe('rpm')
    roundTrips(source)
  })

  it('leaves a lone `@name.setter` exactly as it was — there is no property to fold', () => {
    const source = [
      'class Motor:',
      '    @speed.setter',
      '    def speed(self, value):',
      '        self._speed = value',
      ''
    ].join('\n')
    expect(types(source)).not.toContain('snakie_property')
    roundTrips(source)
  })
})

describe('what it refuses, and still reads', () => {
  const stillRoundTrips = (lines: string[]): void => {
    const source = lines.join('\n')
    expect(types(source)).not.toContain('snakie_property')
    roundTrips(source)
  }

  it('refuses a getter that takes parameters', () => {
    stillRoundTrips([
      'class Motor:',
      '    @property',
      '    def speed(self, unit):',
      '        return 1',
      ''
    ])
  })

  it('refuses a setter whose `def` names something else', () => {
    const source = [
      'class Motor:',
      '    @property',
      '    def speed(self):',
      '        return 1',
      '',
      '    @speed.setter',
      '    def rate(self, value):',
      '        pass',
      ''
    ].join('\n')
    // `@speed.setter` over `def rate` binds `rate`, so it is not this
    // property's other half: the getter folds, the pair does not.
    expect((property(source)!.fields as Record<string, unknown>).HAS_SETTER).toBe(false)
    roundTrips(source)
  })

  it('refuses a setter with a signature the field cannot hold', () => {
    const source = [
      'class Motor:',
      '    @property',
      '    def speed(self):',
      '        return 1',
      '',
      '    @speed.setter',
      '    def speed(self, value=0):',
      '        pass',
      ''
    ].join('\n')
    // The GETTER still becomes a property block; the setter stays what it was.
    expect((property(source)!.fields as Record<string, unknown>).HAS_SETTER).toBe(false)
    roundTrips(source)
  })

  it('refuses a gap it has nowhere to record, rather than reflowing the file', () => {
    const source = [
      'class Motor:',
      '    @property',
      '    def speed(self):',
      '        return 1',
      '',
      '',
      '    @speed.setter',
      '    def speed(self, value):',
      '        pass',
      ''
    ].join('\n')
    expect((property(source)!.fields as Record<string, unknown>).HAS_SETTER).toBe(false)
    roundTrips(source)
  })
})

describe('what the block writes', () => {
  /** One property block on a workspace, with the fields given. */
  function generated(fields: Record<string, unknown>): string {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [{ type: 'snakie_property', id: 'p', fields }]
        }
      },
      ws
    )
    return generateProgram(ws).code
  }

  it('is a getter with `pass` in it, dragged straight out of the drawer', () => {
    expect(generated({ NAME: 'name', HAS_SETTER: false, PARAM: 'value' })).toBe(
      ['@property', 'def name(self):', '    pass', ''].join('\n')
    )
  })

  it('writes both halves, and the name in both, once the box is ticked', () => {
    expect(generated({ NAME: 'speed', HAS_SETTER: true, PARAM: 'value' })).toBe(
      [
        '@property',
        'def speed(self):',
        '    pass',
        '',
        '@speed.setter',
        'def speed(self, value):',
        '    pass',
        ''
      ].join('\n')
    )
  })

  it('hides the setter rows while the box is off, and shows them when it is on', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [{ type: 'snakie_property', id: 'p', fields: { NAME: 'speed' } }]
        }
      },
      ws
    )
    const block = ws.getBlockById('p')!
    expect(block.getInput('SET')!.isVisible()).toBe(false)
    block.setFieldValue(true, 'HAS_SETTER')
    expect(block.getInput('SET')!.isVisible()).toBe(true)
    expect(block.getInput('SETTER_ROW')!.isVisible()).toBe(true)
  })
})
