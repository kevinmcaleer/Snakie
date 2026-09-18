import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import {
  FALLBACK_PINS,
  pinAliasesIn,
  pinLabel,
  pinOptionsFor,
  resolvePinGpio,
  setBoardPins,
  setPinAliases
} from '../src/renderer/src/lib/blocks/board-pins'
import { applyPinWarnings, collectPinClaims, pinConflicts } from '../src/renderer/src/lib/blocks/pin-conflicts'
import { parsePins } from '../src/renderer/src/components/parse-pins'

/**
 * NAMED PINS.
 * =============================================================================
 *
 * `GP15` is what the board calls the hole; `motor_left` is what the learner
 * calls it, and on a robot with six of them the name is the only one of the two
 * anybody can keep straight. A `name pin` block declares one.
 *
 * FOUR THINGS HAVE TO HOLD AT ONCE, and they are what this suite is:
 *
 *  1. the assignment lands ABOVE every `Pin(...)` that reads it, whatever order
 *     the blocks sit in — otherwise the program is a `NameError`;
 *  2. the Board View still lights the right badge, which means `parse-pins.ts`
 *     has to resolve the name back to the GPIO;
 *  3. the pin-conflict pass still sees two blocks on one hole as one hole, even
 *     when they reached it by different names;
 *  4. a name nothing declares says so, rather than generating quietly.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

beforeEach(() => {
  setBoardPins(FALLBACK_PINS, "'LED'")
  setPinAliases([])
})

function workspaceOf(blocks: unknown[]): Blockly.Workspace {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
  return ws
}

const codeOf = (blocks: unknown[]): string => generateProgram(workspaceOf(blocks)).code
const linesOf = (blocks: unknown[]): string[] => codeOf(blocks).split('\n')

/** `name pin <gpio> as <name>`, optionally with a block stacked under it. */
const namePin = (
  gpio: string,
  name: string,
  id = 'n',
  next?: Record<string, unknown>
): Record<string, unknown> => ({
  type: 'snakie_name_pin',
  id,
  fields: { PIN: gpio, NAME: name },
  ...(next ? { next: { block: next } } : {})
})

const write = (pin: string, id = 'w'): Record<string, unknown> => ({
  type: 'snakie_pin_write',
  id,
  fields: { PIN: pin, VALUE: '1' }
})

describe('the name pin block', () => {
  it('assigns the pin once and says the name after', () => {
    expect(linesOf([namePin('15', 'motor_left', 'n', write('motor_left'))])).toEqual([
      'from machine import Pin',
      '',
      'motor_left = 15',
      'pin_motor_left = Pin(motor_left, Pin.OUT)',
      '',
      'pin_motor_left.value(1)',
      ''
    ])
  })

  it('declares nothing where it stands', () => {
    // The whole block generates one hoisted line and nothing at the point it
    // sits, exactly like the import blocks. A learner should be able to park it
    // anywhere without a stray statement appearing mid-program.
    const out = generateProgram(workspaceOf([namePin('15', 'motor_left')]))
    expect(out.code).toBe('motor_left = 15\n')
  })

  it('a blank name declares nothing at all', () => {
    // Mid-retype: the field is empty for a keystroke, and `= 15` on a line of
    // its own is a SyntaxError in the mirror the learner is looking at.
    expect(codeOf([namePin('15', '   ')])).toBe('')
  })
})

describe('the assignment lands before the pin that reads it', () => {
  it('when the name block is ABOVE the block using it', () => {
    const code = codeOf([namePin('15', 'motor_left', 'n', write('motor_left'))])
    expect(code.indexOf('motor_left = 15')).toBeLessThan(code.indexOf('Pin(motor_left'))
  })

  it('and when it is BELOW it', () => {
    // THE CASE THAT DECIDED THE DESIGN. Setup lines are written in first-request
    // order, so leaving the assignment to the `name pin` block alone would put it
    // after the `Pin(...)` whenever the learner parked the declaration at the
    // bottom — a NameError produced by dragging a block downwards.
    const code = codeOf([write('motor_left'), namePin('15', 'motor_left')])
    expect(code.indexOf('motor_left = 15')).toBeLessThan(code.indexOf('Pin(motor_left'))
  })

  it('and when nothing declares it, it is still the learner’s name', () => {
    // Substituting a pin we guessed at would drive the wrong hardware in silence.
    // A NameError is the honest outcome, and the warning below arrives first.
    expect(codeOf([write('ghost')])).toContain('Pin(ghost, Pin.OUT)')
  })
})

describe('the line belongs to the block that declared it', () => {
  it('even when another block registered it first', () => {
    // The assignment is registered from the point of USE, so the pin block gets
    // there first whenever it sits above. The `name pin` block still owns the
    // line — it is that block's only visible effect, so #1016's hover has to
    // light it up there.
    const out = generateProgram(workspaceOf([write('motor_left'), namePin('15', 'motor_left')]))
    const line = out.code.split('\n').indexOf('motor_left = 15') + 1
    expect(out.sourceMap.get(line)).toBe('n')
  })
})

describe('every pin block takes a name', () => {
  it('a servo, keeping both of the things the spelling has to carry', () => {
    expect(
      codeOf([
        namePin('0', 'shoulder', 'n', {
          type: 'snakie_servo_angle',
          id: 's',
          fields: { PIN: 'shoulder' },
          inputs: { ANGLE: { block: { type: 'math_number', id: 'a', fields: { NUM: 90 } } } }
        })
      ])
    ).toContain('servo_shoulder = Servo(PWM(Pin(shoulder)), pin=shoulder)')
  })

  it('a PWM', () => {
    expect(
      codeOf([
        namePin('15', 'lamp', 'n', {
          type: 'snakie_pwm_duty',
          id: 'd',
          fields: { PIN: 'lamp' },
          inputs: { PERCENT: { block: { type: 'math_number', id: 'p', fields: { NUM: 50 } } } }
        })
      ])
    ).toContain('pwm_lamp = PWM(Pin(lamp))')
  })

  it('an analogue read', () => {
    expect(
      codeOf([
        namePin('26', 'battery', 'n', {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: { block: { type: 'snakie_adc_read', id: 'a', fields: { PIN: 'battery', UNIT: 'VOLTS' } } }
          }
        })
      ])
    ).toContain('adc_battery = ADC(Pin(battery))')
  })

  it('an I²C bus — whose NUMBER still comes from the real GPIOs', () => {
    // A name does not change which hole it is, and the RP2040 muxes its two I²C
    // blocks onto fixed pin sets. Picking the bus off the name would pick bus 0
    // for everything.
    const code = codeOf([
      namePin('4', 'sda_line', 'n1', {
        type: 'snakie_name_pin',
        id: 'n2',
        fields: { PIN: '5', NAME: 'scl_line' },
        next: {
          block: {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: {
                  type: 'snakie_i2c_scan',
                  id: 'i',
                  fields: { SDA: 'sda_line', SCL: 'scl_line' }
                }
              }
            }
          }
        }
      })
    ])
    expect(code).toContain('i2c_0 = I2C(0, sda=Pin(sda_line), scl=Pin(scl_line))')
  })

  it('and two blocks on one name share one object', () => {
    const code = codeOf([
      namePin('15', 'motor_left', 'n', {
        ...write('motor_left', 'a'),
        next: { block: write('motor_left', 'b') }
      })
    ])
    expect(code.match(/Pin\(motor_left/g)).toHaveLength(1)
    expect(code.match(/motor_left = 15/g)).toHaveLength(1)
  })
})

describe('a name that would shadow a module', () => {
  it('is renamed, and the pin still refers to the renamed one', () => {
    // `names.ts` already refuses to let a learner's identifier replace a module
    // the program imports. A pin name is no different, and the two halves must
    // agree or the assignment and the reference drift apart.
    const code = codeOf([
      namePin('15', 'time', 'n', {
        type: 'snakie_wait_seconds',
        id: 'w',
        inputs: { SECS: { block: { type: 'math_number', id: 's', fields: { NUM: 1 } } } },
        next: { block: write('time') }
      })
    ])
    expect(code).toContain('import time')
    expect(code).toContain('time_ = 15')
    expect(code).toContain('Pin(time_, Pin.OUT)')
  })
})

describe('the Board View still sees the pin', () => {
  it('resolves the name back to the GPIO it stands for', () => {
    // `parse-pins.ts` already had `buildPinVarMap` for exactly this shape, which
    // is why naming a pin costs the wiring diagram nothing.
    const used = parsePins(codeOf([namePin('15', 'motor_left', 'n', write('motor_left'))]))
    expect(used.map((u) => u.pins)).toEqual([['15']])
  })
})

describe('the dropdowns', () => {
  it('offer the names first, with the pin still shown', () => {
    setPinAliases([{ name: 'motor_left', gpio: 15 }])
    expect(pinOptionsFor()[0]).toEqual(['motor_left (GP15)', 'motor_left'])
  })

  it('filter a name by what its pin can actually do', () => {
    // GP15 has no ADC on this board, so a name for it has no business in the
    // analogue menu — the name inherits the hole's capabilities.
    setPinAliases([{ name: 'motor_left', gpio: 15 }, { name: 'battery', gpio: 26 }])
    expect(pinOptionsFor('adc').map(([, v]) => v)).not.toContain('motor_left')
    expect(pinOptionsFor('adc')[0]).toEqual(['battery (GP26)', 'battery'])
  })

  it('keep a name for a pin this board has not got', () => {
    // Dropping it would silently rewire a robot built for another board. The
    // conflict pass is what says so.
    setBoardPins([{ gpio: 0, label: 'GP0', capabilities: ['digital'] }])
    setPinAliases([{ name: 'motor_left', gpio: 15 }])
    expect(pinOptionsFor().map(([, v]) => v)).toContain('motor_left')
  })

  it('and the canvas fills them from the workspace', () => {
    applyPinWarnings(workspaceOf([namePin('15', 'motor_left', 'n', write('motor_left'))]))
    expect(pinOptionsFor().map(([, v]) => v)).toContain('motor_left')
  })
})

describe('reading the names off a workspace', () => {
  it('takes them in order, and the first claim on a name keeps it', () => {
    const ws = workspaceOf([
      namePin('15', 'motor_left', 'a'),
      namePin('16', 'motor_left', 'b'),
      namePin('17', 'motor_right', 'c')
    ])
    expect(pinAliasesIn(ws)).toEqual([
      { name: 'motor_left', gpio: 15 },
      { name: 'motor_right', gpio: 17 }
    ])
  })

  it('and ignores a blank one', () => {
    expect(pinAliasesIn(workspaceOf([namePin('15', '  ')]))).toEqual([])
  })
})

describe('resolving a field value', () => {
  it('passes a number through and looks a name up', () => {
    const declared = [{ name: 'motor_left', gpio: 15 }]
    expect(resolvePinGpio('15', declared)).toBe(15)
    expect(resolvePinGpio('motor_left', declared)).toBe(15)
    expect(resolvePinGpio('ghost', declared)).toBeNull()
  })

  it('and labels a name with the pin behind it', () => {
    expect(pinLabel('motor_left', [{ name: 'motor_left', gpio: 15 }])).toBe('motor_left (GP15)')
    expect(pinLabel('15', [])).toBe('GP15')
  })
})

describe('the pin-conflict pass', () => {
  it('sees a name and its number as the SAME hole', () => {
    // The mistake this pass exists for, reached by two different routes: naming
    // GP15 and then dropping an LED block on `15` is still two things on one pin.
    const ws = workspaceOf([
      namePin('15', 'motor_left', 'n', {
        ...write('motor_left', 'w'),
        next: { block: { type: 'snakie_led_set', id: 'l', fields: { PIN: '15', STATE: 'ON' } } }
      })
    ])
    const warnings = pinConflicts(collectPinClaims(ws))
    expect(warnings.get('w')).toContain('also used by the LED')
    expect(warnings.get('l')).toContain('also used by the pin output')
  })

  it('does not invent a clash between two names for two different pins', () => {
    const ws = workspaceOf([
      namePin('15', 'motor_left', 'n1', {
        type: 'snakie_name_pin',
        id: 'n2',
        fields: { PIN: '16', NAME: 'motor_right' },
        next: { block: { ...write('motor_left', 'w'), next: { block: write('motor_right', 'x') } } }
      })
    ])
    expect([...pinConflicts(collectPinClaims(ws)).keys()]).toEqual([])
  })

  it('says so when nothing declares the name', () => {
    const warnings = pinConflicts(collectPinClaims(workspaceOf([write('ghost')])))
    expect(warnings.get('w')).toContain('Nothing names ghost')
  })

  it('and still checks the board and the capability through the name', () => {
    setBoardPins([{ gpio: 15, label: 'GP15', capabilities: ['digital'] }])
    const ws = workspaceOf([
      namePin('15', 'battery', 'n', {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: { block: { type: 'snakie_adc_read', id: 'a', fields: { PIN: 'battery', UNIT: 'VOLTS' } } }
        }
      })
    ])
    expect(pinConflicts(collectPinClaims(ws)).get('a')).toContain("can't do adc")
  })

  it('leaves a plain numeric claim exactly as it was', () => {
    // Every caller written before names existed hands over bare numbers with no
    // `gpio` at all, and must keep getting the same answers.
    expect(
      pinConflicts([
        { blockId: 'a', pin: '15', role: 'servo' },
        { blockId: 'b', pin: '15', role: 'buzzer' }
      ]).get('a')
    ).toContain('also used by the buzzer')
  })
})
