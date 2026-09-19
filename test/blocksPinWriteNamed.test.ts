import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * SET A PIN YOU HAVE NAMED, BY DROPPING THE NAME IN.
 * =============================================================================
 *
 * ```
 *   set pin [GP15 ▾] to [high]     ← the block that has always been there
 *   set pin ( led ) to [high]      ← this one
 * ```
 *
 * The existing block asks for a pin off a menu of the board's twenty-nine. This
 * one takes a SOCKET, so the pin arrives as a value: usually the name a `name
 * pin` block gave it, but equally one held in a variable, picked out of a list,
 * or worked out by a loop — none of which a dropdown of hardware can express.
 *
 * TWO BLOCKS WRITE ONE LINE, which is the interesting part. `led.value(1)` and
 * `pin_15.value(1)` are the same shape, and only the NAME tells them apart:
 *
 *  - `led` is a name the learner gave a pin, so it opens as THIS block — that is
 *    how they wrote it, and it is what the canvas should show them back;
 *  - `pin_15` is an object the GENERATOR hoisted, whose pin lives in its name
 *    rather than in the line, so it stays with the block that has the pin field.
 *
 * They cannot race. An `onNamedPin` rule is only reachable in a pass of its own,
 * where the receiver has to be a bare name in the alias map, and every other
 * `on` rule sits that pass out — the generator's hoisted objects are kept out of
 * that map on purpose (#1097).
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const NAMED = 'snakie_pin_write_named'
const FIELDED = 'snakie_pin_write'
const IMPORT = 'from machine import Pin\n\n'

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

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
const one = (source: string, type: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === type)

describe('the block a learner drags', () => {
  it('writes the line they would have written', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: NAMED,
              id: 'w',
              fields: { VALUE: '1' },
              inputs: { PIN: { block: { type: 'variables_get', id: 'v', fields: { VAR: { id: 'led' } } } } }
            }
          ]
        },
        variables: [{ name: 'led', id: 'led' }]
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toContain('led.value(1)')
  })

  it('needs no import of its own', () => {
    // The `name pin` block declares the pin and brings `Pin` with it. This block
    // only calls a method on what that produced, so adding an import here would
    // put `from machine import Pin` in a program that may have no pin at all.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: NAMED,
              id: 'w',
              fields: { VALUE: '0' },
              inputs: { PIN: { block: { type: 'variables_get', id: 'v', fields: { VAR: { id: 'led' } } } } }
            }
          ]
        },
        variables: [{ name: 'led', id: 'led' }]
      } as never,
      ws
    )
    expect(generateProgram(ws).code).not.toContain('import')
  })
})

describe('what opens as this block', () => {
  it('a call on a pin the learner named', () => {
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(1)\n`
    expect(types(src)).toContain(NAMED)
    roundTrips(src)
  })

  it('reads high and low back into the setting', () => {
    for (const [line, value] of [
      ['led.value(1)', '1'],
      ['led.value(0)', '0']
    ]) {
      const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\n${line}\n`
      expect(one(src, NAMED)!.fields, line).toEqual({ VALUE: value })
      roundTrips(src)
    }
  })

  it('puts the name in the SOCKET, not in a field', () => {
    // The whole difference between the two blocks, asserted rather than implied.
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(1)\n`
    const block = one(src, NAMED)!
    expect(Object.keys(block.fields as object)).toEqual(['VALUE'])
    const pin = (block.inputs as Record<string, { block: Record<string, unknown> }>).PIN.block
    expect(pin.type).toBe('variables_get')
  })
})

describe('what does NOT, and why', () => {
  it('the generator’s own hoisted object keeps the pin-field block', () => {
    // `pin_15`'s pin is in its NAME, not in the line, so the block that holds a
    // pin field is the only one that can regenerate it. Reading it as a name
    // would give the file two objects on one pin (#1058).
    const src = `${IMPORT}pin_15 = Pin(15, Pin.OUT)\n\npin_15.value(1)\n`
    expect(types(src)).toContain(FIELDED)
    expect(types(src)).not.toContain(NAMED)
    roundTrips(src)
  })

  it('a value the setting cannot hold stays an ordinary line', () => {
    // `led.value(brightness)` is not *set pin to [high]* — the dropdown has
    // nowhere to put a variable — so it reads as the generic call it is, and
    // regenerates exactly.
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(brightness)\n`
    expect(types(src)).not.toContain(NAMED)
    roundTrips(src)
  })

  it('an attribute of something is not a pin this file declared', () => {
    // `self.led.value(1)` is a method on an attribute, and `self.led` is not a
    // name in the alias map however much it looks like one.
    const src = ['class Robot:', '    def go(self):', '        self.led.value(1)', ''].join('\n')
    expect(types(src)).not.toContain(NAMED)
    roundTrips(src)
  })

  it('leaves the Lists block alone, which shares the machinery', () => {
    // `snakie_list_append` is the other `on` rule, and it must not be dragged
    // into the named-pin pass — nor exclude itself from its own.
    expect(types('readings.append(value)\n')).toContain('snakie_list_append')
  })
})

describe('the blink program, end to end', () => {
  it('opens with no grey in it and regenerates unchanged', () => {
    // The import section in the generator's own order and grouping — `imports.ts`
    // owns those lines, which is why the round-trip gate forgives them and why a
    // test comparing exact text has to write them the way they come out.
    const src = [
      'import time',
      '',
      'from machine import Pin',
      '',
      'led = Pin(25, Pin.OUT)',
      '',
      'while True:',
      '    led.value(1)',
      '    time.sleep(0.5)',
      '    led.value(0)',
      '    time.sleep(0.5)',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect({ raw: report.raw, rawSockets: report.rawSockets }).toEqual({ raw: 0, rawSockets: 0 })
    expect(types(src)).toContain(NAMED)
    expect(types(src)).toContain('snakie_name_pin')
    roundTrips(src)
  })
})
