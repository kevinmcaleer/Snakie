import { describe, it, expect, beforeAll } from 'vitest'
import * as Blockly from 'blockly/core'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  blocksInCategory,
  installBlockDefinitions,
  registeredBlocks
} from '../src/renderer/src/lib/blocks/registry'
import { buildToolbox, categoryContents } from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import { unknownBlockTypes } from '../src/renderer/src/lib/blocks/workspace-check'
import type { Dialect } from '../src/shared/dialect'

/**
 * DIALECT SCOPE ON A BLOCK (#1039, epic #209 and epic #1007).
 * =============================================================================
 *
 * Two claims, and the second is the one that would hurt.
 *
 *  1. A CircuitPython board is not offered a block that goes through `machine`.
 *  2. It can still OPEN a program that already uses one.
 *
 * The second is why the filter is on the toolbox and not on the registry. If
 * scoping deregistered a block, `workspace-check.ts` — which refuses to mount a
 * canvas holding a type this build doesn't know, so it can never serialise an
 * empty workspace over somebody's file — would start refusing every hardware
 * program the moment a Feather was plugged in. The file would still be there,
 * and Snakie would decline to show it. That is a data-loss-shaped bug wearing a
 * feature's clothes, and the test below is what stops it being reintroduced.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

/** Every block type the toolbox offers on `dialect`, flattened out of the tree. */
function offered(dialect: Dialect): string[] {
  const out: string[] = []
  const walk = (items: readonly unknown[]): void => {
    for (const item of items as Record<string, unknown>[]) {
      if (item.kind === 'block' && typeof item.type === 'string') out.push(item.type)
      if (Array.isArray(item.contents)) walk(item.contents)
    }
  }
  const toolbox = buildToolbox(dialect) as { contents: unknown[] }
  walk(toolbox.contents)
  return out
}

describe('which blocks carry a scope', () => {
  it('marks every instrument block MicroPython', () => {
    // `instruments.py` is telemetry over `print()`, which CircuitPython runs —
    // but the sensor reads underneath it are `machine`-based, and #1038 made
    // those degrade rather than work. A block that draws an empty oscilloscope
    // is worse than a block the board never offered.
    const blocks = blocksInCategory('instruments')
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect([block.type, block.scope]).toEqual([block.type, 'micropython'])
  })

  it('scopes a hardware block by what it can GENERATE (#1040)', () => {
    // Derived, not written down twice — otherwise the copy that drifts is the
    // one hiding a working block from the board it works on.
    //
    // THE BUFFERS DRAWER IS NOT HARDWARE IN THIS SENSE (#1135). `bytes` and
    // `bytearray` are plain Python, core and identical in both runtimes; they
    // sit in this category for curriculum reasons — next to the I²C and SPI
    // blocks that ask for one — rather than because they reach `machine`. The
    // rule here is about emitters, and they have nothing to derive from, so
    // they stay unscoped like the rest of the plain-Python palette. The test
    // below still holds them to that.
    for (const block of blocksInCategory('hardware').filter((b) => b.group?.id !== 'buffers')) {
      expect([block.type, block.scope]).toEqual([
        block.type,
        block.circuitpython ? 'both' : 'micropython'
      ])
    }
  })

  it('leaves the plain-Python palette unscoped', () => {
    // Absent IS `both` — the default in `inScope` — so most of the palette needs
    // no annotation and shouldn't grow one.
    const scoped = registeredBlocks().filter((b) => b.scope && b.scope !== 'both')
    const categories = new Set(scoped.map((b) => b.category))
    expect([...categories].sort()).toEqual(['hardware', 'instruments'])
  })
})

describe('the toolbox follows the dialect', () => {
  it('offers everything on MicroPython', () => {
    const types = offered('micropython')
    expect(types).toContain('snakie_led_set')
    expect(types).toContain('controls_if')
  })

  it('offers the hardware blocks that speak CircuitPython, and withholds the rest', () => {
    const types = offered('circuitpython')
    // #1040 taught these to generate `digitalio`/`pwmio`/`analogio`.
    expect(types).toContain('snakie_led_set')
    expect(types).toContain('snakie_pwm_duty')
    expect(types).toContain('snakie_adc_read')
    // Servo and buzzer have no CircuitPython CORE equivalent — they want
    // `adafruit_motor` and `simpleio`, which is a different promise.
    expect(types).not.toContain('snakie_servo_angle')
    expect(types).not.toContain('snakie_buzzer_tone')
    // Instruments go through `machine` underneath, so none of them.
    expect(types).not.toContain('snakie_inst_read_adc')
    // …and every block that is just Python is there as always.
    expect(types).toContain('controls_if')
    expect(types).toContain('snakie_turtle_forward')
  })

  it('offers everything when the dialect is unknown', () => {
    // No board, or a board that wouldn't say. The Blocks workspace is meant to
    // work on a Chromebook with nothing plugged in (epic #267), and hiding the
    // hardware blocks from somebody who simply hasn't connected yet would make
    // the palette look broken.
    expect(offered('unknown')).toEqual(offered('micropython'))
  })
})

describe('a drawer the dialect emptied', () => {
  // Instruments, not Hardware: since #1040 the hardware drawer keeps nine of
  // its twelve on CircuitPython, so it is no longer the emptied one.
  const instruments = BLOCK_CATEGORIES.find((c) => c.id === 'instruments')!

  it('says which runtime its blocks are for, and which one you are on', () => {
    const contents = categoryContents(instruments, 'circuitpython')
    expect(contents).toEqual([
      { kind: 'label', text: 'These blocks are MicroPython. Your board is running CircuitPython.' }
    ])
  })

  it('does not say it on a dialect that can see them', () => {
    const labels = categoryContents(instruments, 'micropython').filter((c) => c.kind === 'label')
    expect(labels).toEqual([])
  })

  it('a drawer that only LOST some blocks is not an emptied drawer', () => {
    // Hardware keeps its CircuitPython-capable blocks, so it shows blocks
    // rather than an explanation.
    const hardware = BLOCK_CATEGORIES.find((c) => c.id === 'hardware')!
    const contents = categoryContents(hardware, 'circuitpython')
    expect(contents.filter((c) => c.kind === 'label')).toEqual([])
    expect(contents.length).toBeGreaterThan(0)
  })

  it('leaves a genuinely empty category its own hint', () => {
    // `My parts` is empty because nothing is on the breadboard, not because of
    // the dialect — so it keeps the hint that says how to fill it.
    const parts = BLOCK_CATEGORIES.find((c) => c.id === 'parts')!
    expect(categoryContents(parts, 'circuitpython')).toEqual([
      { kind: 'label', text: 'Wire a part up in Electronics and its blocks appear here.' }
    ])
  })
})

describe('hide, never deregister', () => {
  it('keeps an out-of-dialect block in the registry', () => {
    // The whole rule, in one assertion: filtering is a fact about the flyout.
    expect(registeredBlocks().map((b) => b.type)).toContain('snakie_led_set')
  })

  it('still opens a hardware program with a CircuitPython board plugged in', () => {
    const doc = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'snakie_led_set', id: 'a', fields: { PIN: 15, STATE: 'ON' } }]
      }
    }
    // `unknownBlockTypes` is what the canvas guard asks before it mounts. It
    // reads the REGISTRY, which the dialect never touches — so this is empty on
    // every dialect, and the guard lets the file through.
    expect(unknownBlockTypes(doc, (type) => Boolean(blockDefinition(type)))).toEqual([])

    // And it really loads: a workspace built from it has the block in it.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(doc, ws)
    expect(ws.getAllBlocks(false).map((b) => b.type)).toEqual(['snakie_led_set'])
    ws.dispose()
  })
})
