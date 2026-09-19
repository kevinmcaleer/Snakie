import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { PIN_ALIAS_BLOCK, PWM_ALIAS_BLOCK } from '../src/renderer/src/lib/blocks/board-pins'
import { syncHardwareVariables } from '../src/renderer/src/lib/blocks/hardware-names'
import { applyPinWarnings } from '../src/renderer/src/lib/blocks/pin-conflicts'

/**
 * A DECLARED PWM YOU COULD NOT POINT AT.
 * =============================================================================
 *
 * ```
 *   motor_a_speed = PWM(Pin(6))
 *   motor_b_speed = PWM(Pin(7))
 * ```
 *
 * `set power of ( ) to [50] %` takes its PWM in a socket, and the block that
 * goes in the socket is `variables_get` — so its dropdown lists WORKSPACE
 * VARIABLES. A declaration is not one: it is a text field on the naming block.
 * The reader declares a variable for a name it finds BEING USED, so
 * `motor_a_speed` — already driven somewhere in the file — was on the menu and
 * `motor_b_speed`, declared on the very next line and not yet used, was not.
 *
 * Which is a trap with no way out: to get the name on the menu you had to use
 * it, and to use it you needed the menu.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The untyped variable names on a workspace — the dropdown's own list. */
function names(ws: Blockly.Workspace): string[] {
  return ws
    .getVariableMap()
    .getVariablesOfType('')
    .map((v) => v.getName())
    .sort()
}

/** A `name PWM` block declaring `name` on `pin`. */
function namePwm(ws: Blockly.Workspace, pin: string, name: string): Blockly.Block {
  const block = ws.newBlock(PWM_ALIAS_BLOCK)
  block.setFieldValue(pin, 'PIN')
  block.setFieldValue(name, 'NAME')
  return block
}

describe('the names a declaration gives out', () => {
  it('puts a declared PWM on the variable dropdown before anything uses it', () => {
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', 'motor_b_speed')
    expect(names(ws)).toEqual([])
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual(['motor_b_speed'])
  })

  it('does the same for a named pin, whose blocks have the same socket', () => {
    const ws = new Blockly.Workspace()
    const pin = ws.newBlock(PIN_ALIAS_BLOCK)
    pin.setFieldValue('0', 'PIN')
    pin.setFieldValue('echo', 'NAME')
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual(['echo'])
  })

  it('declares nothing for a name that is still being typed', () => {
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', '')
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual([])
  })

  it('makes one variable however often it runs', () => {
    // It runs on every workspace change, including every frame of a drag.
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', 'motor_b_speed')
    syncHardwareVariables(ws)
    const id = ws.getVariableMap().getVariable('motor_b_speed', '')!.getId()
    expect(syncHardwareVariables(ws)).toBe(false)
    expect(ws.getVariableMap().getVariablesOfType('')).toHaveLength(1)
    // The SAME variable, so the blocks already pointing at it still are.
    expect(ws.getVariableMap().getVariable('motor_b_speed', '')!.getId()).toBe(id)
  })

  it('reuses a variable the program already had of that name', () => {
    // The reader made one because a line in the file used the name. Declaring a
    // second of the same name would give the socket two entries reading
    // `motor_b_speed`, one of which drove nothing.
    const ws = new Blockly.Workspace()
    const existing = ws.getVariableMap().createVariable('motor_b_speed', '')
    namePwm(ws, '7', 'motor_b_speed')
    syncHardwareVariables(ws)
    expect(ws.getVariableMap().getVariablesOfType('')).toHaveLength(1)
    expect(ws.getVariableMap().getVariable('motor_b_speed', '')!.getId()).toBe(existing.getId())
  })

  it('generates the learner’s own identifier, not a renamed twin', () => {
    // The collision this whole thing walks into: the declaration writes
    // `motor_b_speed = PWM(Pin(7))` into the setup section, and a variable of
    // that name renamed `motor_b_speed_` would leave the two halves pointing at
    // different objects. `declaredPins` in the generator is what holds it.
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', 'motor_b_speed')
    syncHardwareVariables(ws)
    const duty = ws.newBlock('snakie_pwm_duty_named')
    const getter = ws.newBlock('variables_get')
    getter.setFieldValue(ws.getVariableMap().getVariable('motor_b_speed', '')!.getId(), 'VAR')
    duty.getInput('PWM')!.connection!.connect(getter.outputConnection!)
    const code = generateProgram(ws).code
    expect(code).toContain('motor_b_speed = PWM(Pin(7))')
    expect(code).toContain('motor_b_speed.duty_u16(')
    expect(code).not.toContain('motor_b_speed_')
  })
})

describe('and what it takes back', () => {
  it('leaves no ghost behind a name being retyped', () => {
    // A text field fires a change per keystroke, so without this every letter of
    // `motor_b_speed` would leave a variable behind it in every dropdown.
    const ws = new Blockly.Workspace()
    const block = namePwm(ws, '7', 'm')
    syncHardwareVariables(ws)
    block.setFieldValue('mo', 'NAME')
    syncHardwareVariables(ws)
    block.setFieldValue('motor_b_speed', 'NAME')
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual(['motor_b_speed'])
  })

  it('keeps a name that blocks are still using when its declaration goes', () => {
    // The naming block deleted out from under blocks set to its name is a
    // mistake `pin-conflicts.ts` reports. Deleting the variable here would
    // delete those blocks instead, which is not a report — it is a program
    // quietly losing lines.
    const ws = new Blockly.Workspace()
    const block = namePwm(ws, '7', 'motor_b_speed')
    syncHardwareVariables(ws)
    const getter = ws.newBlock('variables_get')
    getter.setFieldValue(ws.getVariableMap().getVariable('motor_b_speed', '')!.getId(), 'VAR')
    block.dispose(false)
    syncHardwareVariables(ws)
    // `item` is Blockly's own: a fresh `variables_get` names one before the
    // line below points it at the PWM. It is here because this test made it,
    // not because anything under test did.
    expect(names(ws)).toContain('motor_b_speed')
    expect(ws.getBlockById(getter.id)).not.toBeNull()
  })

  it('never touches a variable the learner made', () => {
    const ws = new Blockly.Workspace()
    ws.getVariableMap().createVariable('score', '')
    namePwm(ws, '7', 'motor_b_speed').dispose(false)
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual(['score'])
  })
})

describe('opening the file that showed it up', () => {
  const SOURCE = [
    'from machine import PWM, Pin',
    '',
    'motor_a_speed = PWM(Pin(6))',
    'motor_b_speed = PWM(Pin(7))',
    '',
    'motor_a_speed.duty_u16(int(50 * 65535 / 100))',
    ''
  ].join('\n')

  it('offers BOTH drive channels, not just the one already driven', () => {
    const { workspace } = pythonToBlocks(SOURCE)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    // What the file arrives with: the name that was used, and not the one that
    // was only declared. This is the bug, as the reader hands it over.
    expect(names(ws)).toEqual(['motor_a_speed'])
    syncHardwareVariables(ws)
    expect(names(ws)).toEqual(['motor_a_speed', 'motor_b_speed'])
  })

  it('does not change a line of the program by offering the name', () => {
    const { workspace } = pythonToBlocks(SOURCE)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    syncHardwareVariables(ws)
    expect(generateProgram(ws).code).toBe(SOURCE)
  })

  it('says nothing while it works, so opening a file cannot dirty it', () => {
    // A change event here is read as an edit by the canvas — and would put an
    // unsaved dot on a file the learner has only looked at — and would land the
    // creation on the undo stack, so their first ⌘Z would undo a variable they
    // never knowingly made.
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', 'motor_b_speed')
    const events: Blockly.Events.Abstract[] = []
    ws.addChangeListener((event) => events.push(event))
    syncHardwareVariables(ws)
    expect(events).toEqual([])
    expect(names(ws)).toEqual(['motor_b_speed'])
  })
})

describe('where the canvas runs it', () => {
  it('comes with the pass that already sees the whole program', () => {
    // `applyPinWarnings` is what the canvas calls on every change AND on the
    // load — so the names a file arrives declaring are on the menu before the
    // learner has touched anything. Asserted through that door rather than the
    // module's own so the wiring is covered too: a sync nothing calls fixes
    // nothing.
    const ws = new Blockly.Workspace()
    namePwm(ws, '7', 'motor_b_speed')
    applyPinWarnings(ws)
    expect(names(ws)).toEqual(['motor_b_speed'])
  })
})
