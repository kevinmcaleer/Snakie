import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { applyPinWarnings } from '../src/renderer/src/lib/blocks/pin-conflicts'
import {
  FALLBACK_PINS,
  PIN_ALIAS_BLOCK,
  setBoardPins,
  setPinAliases
} from '../src/renderer/src/lib/blocks/board-pins'

/**
 * WHAT A PIN DROPDOWN SAYS IT IS HOLDING.
 * =============================================================================
 *
 * ```
 *   toggle LED on ( GPled ▾ )     ← before
 *   toggle LED on ( led (GP25) ▾ ) ← what it is
 * ```
 *
 * `GPled` names no pin on any board. It was the label on the block a child had
 * just named themselves, and it came from two faults that each produced it on
 * their own:
 *
 *  1. **The fallback assumed a number.** `FieldPin.getText()` looks its value up
 *     in the live options and falls back to `GP<value>` — right for a pin this
 *     board has not got, nonsense since #1097 let the field hold a NAME.
 *  2. **Nothing redrew the field when the options arrived.** A field works out
 *     its label while Blockly draws the block and has no reason to do it again.
 *     Opening a file draws every block FIRST and only then reads the `name pin`
 *     blocks off the loaded workspace — so every pin dropdown in the program was
 *     rendered against an empty name list, and stayed that way.
 *
 * Fault 2 is the one with reach: the same staleness renames nothing on a board
 * swap, where `GP0` is `D1` on some boards and the dropdown keeps saying `GP0`.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
  // The module-level caches outlive a test file, and this suite is ABOUT what
  // happens before they are filled.
  setPinAliases([])
  setBoardPins([...FALLBACK_PINS])
})

const NAMED = ['from machine import Pin', '', 'led = Pin(25, Pin.OUT)', '', 'led.toggle()', ''].join(
  '\n'
)

/** The program, loaded into a workspace the way the canvas loads one. */
function open(source: string): Blockly.Workspace {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return ws
}

/** What the `PIN` dropdown of the one block of `type` is showing. */
function label(ws: Blockly.Workspace, type: string): string | undefined {
  return ws.getBlocksByType(type, false)[0]?.getField('PIN')?.getText()
}

describe('a pin dropdown holding a name', () => {
  it('never renders it as a GPIO', () => {
    // Before `applyPinWarnings` has run — which is the state every block is
    // drawn in while a file opens.
    const ws = open(NAMED)
    expect(label(ws, 'snakie_led_toggle')).not.toContain('GPled')
  })

  it('says the name and the pin it stands for, once the names are in', () => {
    const ws = open(NAMED)
    applyPinWarnings(ws)
    expect(label(ws, 'snakie_led_toggle')).toBe('led (GP25)')
  })

  it('falls back to the name itself, and nothing more, with no names pushed', () => {
    // The honest worst case: the field cannot say which GPIO `led` is until
    // something tells it, and a name is still what the learner wrote.
    const ws = open(NAMED)
    expect(label(ws, 'snakie_led_toggle')).toBe('led')
  })

  it('falls back to the name for one its own menu cannot offer', () => {
    // NOT STALENESS — the other road to the fallback, and the one a learner can
    // take deliberately. `sensor` names GP0, which has no ADC, so the analogue
    // block's dropdown does not list it; the field still HOLDS it, because a
    // field that rewrote the value would quietly move the reading to another
    // pin. `GPsensor` was the old label here too, and `pin-conflicts.ts` is
    // what says GP0 can't do adc.
    setPinAliases([{ name: 'sensor', gpio: 0, direction: 'IN' }])
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('snakie_adc_read')
    block.setFieldValue('sensor', 'PIN')
    expect(block.getField('PIN')!.getText()).toBe('sensor')
  })

  it('still prefixes a plain GPIO number, which is what GP is for', () => {
    const ws = open('from machine import Pin\n\npin_15 = Pin(15, Pin.OUT)\n\npin_15.toggle()\n')
    expect(label(ws, 'snakie_led_toggle')).toBe('GP15')
  })
})

describe('the redraw that makes it true', () => {
  it('reports whether the names really changed, so a drag does not redraw', () => {
    // `applyPinWarnings` runs on every frame of a debounce, and redrawing every
    // dropdown in the program that often would be waste — so the push answers.
    expect(setPinAliases([{ name: 'led', gpio: 25, direction: 'OUT' }])).toBe(true)
    expect(setPinAliases([{ name: 'led', gpio: 25, direction: 'OUT' }])).toBe(false)
    expect(setPinAliases([{ name: 'led', gpio: 26, direction: 'OUT' }])).toBe(true)
    expect(setPinAliases([])).toBe(true)
  })

  it('reports a board swap the same way, for the same reason', () => {
    expect(setBoardPins([{ gpio: 0, label: 'D1', capabilities: ['digital'] }])).toBe(true)
    expect(setBoardPins([{ gpio: 0, label: 'D1', capabilities: ['digital'] }])).toBe(false)
    expect(setBoardPins([{ gpio: 0, label: 'GP0', capabilities: ['digital'] }])).toBe(true)
  })

  it('a renamed board pin changes what an already-open block says', () => {
    const ws = open('from machine import Pin\n\npin_0 = Pin(0, Pin.OUT)\n\npin_0.toggle()\n')
    expect(label(ws, 'snakie_led_toggle')).toBe('GP0')
    setBoardPins([{ gpio: 0, label: 'D1', capabilities: ['digital'] }])
    expect(label(ws, 'snakie_led_toggle')).toBe('D1')
  })
})

describe('and the fields are really told', () => {
  /** The `PIN` dropdown itself, to watch rather than to read. */
  function field(ws: Blockly.Workspace, type: string): Blockly.Field {
    const block = ws.getBlocksByType(type, false)[0]
    expect(block, type).toBeDefined()
    return block.getField('PIN')!
  }

  // WHY A SPY AND NOT A LABEL. `getText()` reads the live options every time it
  // is called, so it is right in a test whether or not anything redrew the field
  // — the label assertions above pass against a canvas showing `GPled`. What was
  // broken is the redraw, and the only way to assert a redraw in a headless
  // workspace is to watch for the call that asks for one.
  it('tells a dropdown when the name it is showing moves to another pin', () => {
    const ws = open(NAMED)
    applyPinWarnings(ws)
    const pin = field(ws, 'snakie_led_toggle')
    const redrawn = vi.spyOn(pin, 'forceRerender')
    ws.getBlocksByType(PIN_ALIAS_BLOCK, false)[0].setFieldValue('16', 'PIN')
    applyPinWarnings(ws)
    expect(redrawn).toHaveBeenCalled()
    expect(pin.getText()).toBe('led (GP16)')
  })

  it('and leaves it alone when the names did not move', () => {
    // The other half of the push's answer, from the caller's side: a drag fires
    // `applyPinWarnings` again and again, and redrawing every dropdown in the
    // program each time would be waste.
    const ws = open(NAMED)
    applyPinWarnings(ws)
    const redrawn = vi.spyOn(field(ws, 'snakie_led_toggle'), 'forceRerender')
    applyPinWarnings(ws)
    expect(redrawn).not.toHaveBeenCalled()
  })
})
