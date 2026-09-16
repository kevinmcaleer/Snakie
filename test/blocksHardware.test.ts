import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import { generateProgram, type GeneratedProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { blocksInCategory, installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import {
  FALLBACK_PINS,
  ledPinToken,
  pinOptionsFor,
  setBoardPins,
  type BlockPin
} from '../src/renderer/src/lib/blocks/board-pins'
import { pinConflicts } from '../src/renderer/src/lib/blocks/pin-conflicts'
import { parsePins } from '../src/renderer/src/components/parse-pins'

/**
 * THE HARDWARE PALETTE (#1012, epic #1007).
 * =============================================================================
 *
 * Blocks that make a real pin do a real thing, which means the generated code is
 * pinned from three directions at once and every one of them is tested here:
 *
 *  - It must MATCH `instruments.py`'s real API, or it raises on the board.
 *  - It must be readable by `parse-pins.ts`, or the Board View draws nothing —
 *    the issue's "drives the wiring visualiser with no changes" is a claim, and
 *    the `parsePins` suite below is what makes it a checked one.
 *  - It must be the code a Snakie lesson would teach.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

beforeEach(() => {
  // Every test starts on the default board; the ones about board-specific
  // behaviour set their own.
  setBoardPins(FALLBACK_PINS, "'LED'")
})

function gen(blocks: unknown[]): GeneratedProgram {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out
}

const lines = (blocks: unknown[]): string[] => gen(blocks).code.split('\n')
const num = (n: number, id = `n${n}`): Record<string, unknown> => ({
  type: 'math_number',
  id,
  fields: { NUM: n }
})

describe('digital out (#1012)', () => {
  it('turns an LED on through the Snakie umbrella', () => {
    expect(
      lines([{ type: 'snakie_led_set', id: 'l', fields: { PIN: '15', STATE: 'ON' } }])
    ).toEqual([
      'from snakie import Led, Pin',
      '',
      'led_15 = Led(pin=Pin(15, Pin.OUT))',
      '',
      'led_15.set(True)',
      ''
    ])
  })

  it('uses `.set(True)`, because that is what instruments.py actually has', () => {
    // `Led` has no `.on()`. Code that reads nicely and raises AttributeError on
    // the board is worse than no blocks at all.
    const code = gen([
      { type: 'snakie_led_set', id: 'l', fields: { PIN: '15', STATE: 'OFF' } }
    ]).code
    expect(code).toContain('led_15.set(False)')
    expect(code).not.toContain('.off()')
  })

  it('shares one object between two blocks on the same pin', () => {
    const code = gen([
      {
        type: 'snakie_led_set',
        id: 'a',
        fields: { PIN: '15', STATE: 'ON' },
        next: { block: { type: 'snakie_led_set', id: 'b', fields: { PIN: '15', STATE: 'OFF' } } }
      }
    ]).code
    expect(code.match(/Led\(/g)).toHaveLength(1)
  })

  it('toggle drives the Pin, since Led has no toggle', () => {
    expect(lines([{ type: 'snakie_led_toggle', id: 't', fields: { PIN: '15' } }])).toEqual([
      'from snakie import Pin',
      '',
      'pin_15 = Pin(15, Pin.OUT)',
      '',
      'pin_15.toggle()',
      ''
    ])
  })

  it('writes a pin high or low', () => {
    expect(
      lines([{ type: 'snakie_pin_write', id: 'w', fields: { PIN: '15', VALUE: '1' } }]).at(-2)
    ).toBe('pin_15.value(1)')
  })
})

describe('the onboard LED (#1012)', () => {
  it('uses the token the BOARD declares, not a guess', () => {
    // A Pico W's onboard LED hangs off the wireless chip and has no GPIO number
    // at all; a plain Pico's is GP25. One block, two boards.
    setBoardPins(FALLBACK_PINS, "'LED'")
    expect(gen([{ type: 'snakie_onboard_led', id: 'o', fields: { STATE: 'ON' } }]).code).toContain(
      "onboard_led = Pin('LED', Pin.OUT)"
    )
    setBoardPins(FALLBACK_PINS, '25')
    expect(gen([{ type: 'snakie_onboard_led', id: 'o', fields: { STATE: 'ON' } }]).code).toContain(
      'onboard_led = Pin(25, Pin.OUT)'
    )
  })
})

describe('digital in (#1012)', () => {
  it('puts the pull resistor in the constructor, where it belongs', () => {
    expect(
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'snakie_pin_read', id: 'r', fields: { PIN: '14', PULL: 'PULL_UP' } }
            }
          }
        }
      ])
    ).toEqual([
      'from snakie import Pin',
      '',
      'pin_14 = Pin(14, Pin.IN, Pin.PULL_UP)',
      '',
      'print(pin_14.value())',
      ''
    ])
  })

  it('a pull-UP button reads pressed as `not value()`', () => {
    // The commonest beginner wiring: the button connects the pin to ground, so
    // pressed pulls it LOW. Generating the other one makes every button program
    // read backwards.
    const code = gen([
      {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: {
            block: { type: 'snakie_pin_pressed', id: 'b', fields: { PIN: '14', PULL: 'PULL_UP' } }
          }
        }
      }
    ]).code
    expect(code).toContain('print(not pin_14.value())')
  })

  it('a pull-DOWN button reads pressed as `== 1`', () => {
    const code = gen([
      {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: {
            block: { type: 'snakie_pin_pressed', id: 'b', fields: { PIN: '14', PULL: 'PULL_DOWN' } }
          }
        }
      }
    ]).code
    expect(code).toContain('pin_14 = Pin(14, Pin.IN, Pin.PULL_DOWN)')
    expect(code).toContain('print(pin_14.value() == 1)')
  })

  it('the same pin with two different pulls is two different objects', () => {
    // Sharing the first configuration would make the second block's dropdown a
    // lie about what the hardware is doing.
    const code = gen([
      {
        type: 'snakie_pin_write',
        id: 'w',
        fields: { PIN: '20', VALUE: '1' },
        next: {
          block: {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: { type: 'snakie_pin_read', id: 'r', fields: { PIN: '14', PULL: 'NONE' } }
              }
            }
          }
        }
      }
    ]).code
    expect(code).toContain('Pin(14, Pin.IN)')
    expect(code).not.toContain('Pin.NONE')
  })
})

describe('PWM and ADC (#1012)', () => {
  it('brightness converts per cent to the duty MicroPython wants, visibly', () => {
    expect(
      lines([
        {
          type: 'snakie_pwm_duty',
          id: 'd',
          fields: { PIN: '15' },
          inputs: { PERCENT: { block: num(50) } }
        }
      ])
    ).toEqual([
      'from snakie import PWM, Pin',
      '',
      'pwm_15 = PWM(Pin(15))',
      '',
      'pwm_15.duty_u16(int(50 * 65535 / 100))',
      ''
    ])
  })

  it('frequency', () => {
    expect(
      lines([
        {
          type: 'snakie_pwm_freq',
          id: 'f',
          fields: { PIN: '15' },
          inputs: { HZ: { block: num(50) } }
        }
      ]).at(-2)
    ).toBe('pwm_15.freq(50)')
  })

  it('ADC comes from `machine`, because the snakie umbrella does not export it', () => {
    // `from snakie import ADC` is an ImportError on the board: snakie.py
    // re-exports Led, Servo, Buzzer, Pin and PWM, and nothing else.
    expect(
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'snakie_adc_read', id: 'a', fields: { PIN: '26', UNIT: 'VOLTS' } }
            }
          }
        }
      ])
    ).toEqual([
      'from machine import ADC',
      '',
      'from snakie import Pin',
      '',
      'adc_26 = ADC(Pin(26))',
      '',
      'print(adc_26.read_u16() * 3.3 / 65535)',
      ''
    ])
  })

  it('raw reads skip the conversion', () => {
    const code = gen([
      {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: { block: { type: 'snakie_adc_read', id: 'a', fields: { PIN: '26', UNIT: 'RAW' } } }
        }
      }
    ]).code
    expect(code).toContain('print(adc_26.read_u16())')
    expect(code).not.toContain('3.3')
  })
})

describe('servo and buzzer (#1012)', () => {
  it('a servo is written so BOTH views work', () => {
    // The explicit PWM is what `parse-pins.ts` matches (so the Board View draws
    // the wire); the `pin=` is what instruments.py reports as SERVO telemetry
    // (so the Robot View drives the joint). Drop either and one view goes dark.
    expect(
      lines([
        {
          type: 'snakie_servo_angle',
          id: 's',
          fields: { PIN: '0' },
          inputs: { ANGLE: { block: num(90) } }
        }
      ])
    ).toEqual([
      'from snakie import PWM, Pin, Servo',
      '',
      'servo_0 = Servo(PWM(Pin(0)), pin=0)',
      '',
      'servo_0.angle(90)',
      ''
    ])
  })

  it('a buzzer plays a note', () => {
    expect(
      lines([
        {
          type: 'snakie_buzzer_tone',
          id: 'b',
          fields: { PIN: '16' },
          inputs: { FREQ: { block: num(440, 'f') }, MS: { block: num(200, 'm') } }
        }
      ])
    ).toEqual([
      'from snakie import Buzzer, PWM, Pin',
      '',
      'buzzer_16 = Buzzer(PWM(Pin(16)))',
      '',
      'buzzer_16.tone(440, 200)',
      ''
    ])
  })

  it('and can be silenced, sharing the one object', () => {
    const code = gen([
      {
        type: 'snakie_buzzer_tone',
        id: 'b',
        fields: { PIN: '16' },
        inputs: { FREQ: { block: num(440, 'f') }, MS: { block: num(200, 'm') } },
        next: { block: { type: 'snakie_buzzer_stop', id: 's', fields: { PIN: '16' } } }
      }
    ]).code
    expect(code.match(/Buzzer\(/g)).toHaveLength(1)
    expect(code).toContain('buzzer_16.stop()')
  })
})

/**
 * The issue's strongest claim — "the generated code drives the Board View wiring
 * visualiser with no changes" — checked against the real `parse-pins.ts`, which
 * is the thing that would have to change if it were false.
 */
describe('the generated code drives the Board View (#1012)', () => {
  const pinsFor = (blocks: unknown[]): { type: string; pins: string[] }[] =>
    parsePins(gen(blocks).code).map((u) => ({ type: u.type, pins: u.pins }))

  it('an LED lands as an output on its pin', () => {
    expect(
      pinsFor([{ type: 'snakie_led_set', id: 'l', fields: { PIN: '15', STATE: 'ON' } }])
    ).toEqual([{ type: 'output', pins: ['15'] }])
  })

  it('a button lands as an input', () => {
    expect(
      pinsFor([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'snakie_pin_pressed', id: 'b', fields: { PIN: '14', PULL: 'PULL_UP' } }
            }
          }
        }
      ])
    ).toEqual([{ type: 'input', pins: ['14'] }])
  })

  it('a servo lands as PWM — which `Servo(pin=0)` alone would NOT have done', () => {
    expect(
      pinsFor([
        {
          type: 'snakie_servo_angle',
          id: 's',
          fields: { PIN: '0' },
          inputs: { ANGLE: { block: num(90) } }
        }
      ])
    ).toEqual([{ type: 'pwm', pins: ['0'] }])
    // The form the naive implementation would have used is invisible to it.
    expect(parsePins('servo_0 = Servo(pin=0)')).toEqual([])
  })

  it('an analogue read lands as ADC', () => {
    expect(
      pinsFor([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'snakie_adc_read', id: 'a', fields: { PIN: '26', UNIT: 'VOLTS' } }
            }
          }
        }
      ])
    ).toEqual([{ type: 'adc', pins: ['26'] }])
  })

  it('a whole robot program lands every pin it uses', () => {
    const used = pinsFor([
      {
        type: 'snakie_servo_angle',
        id: 's',
        fields: { PIN: '0' },
        inputs: { ANGLE: { block: num(90) } },
        next: {
          block: {
            type: 'snakie_led_set',
            id: 'l',
            fields: { PIN: '15', STATE: 'ON' },
            next: {
              block: {
                type: 'snakie_buzzer_tone',
                id: 'b',
                fields: { PIN: '16' },
                inputs: { FREQ: { block: num(440, 'f') }, MS: { block: num(200, 'm') } }
              }
            }
          }
        }
      }
    ])
    expect(used.flatMap((u) => u.pins).sort()).toEqual(['0', '15', '16'])
  })
})

describe('pin dropdowns come from the real board (#1012)', () => {
  const PICO: BlockPin[] = [
    { gpio: 0, label: 'GP0', capabilities: ['digital', 'pwm'] },
    { gpio: 15, label: 'GP15', capabilities: ['digital', 'pwm'] },
    { gpio: 26, label: 'GP26', capabilities: ['digital', 'adc'] }
  ]

  it('offers only ADC-capable pins to the ADC block', () => {
    setBoardPins(PICO)
    expect(pinOptionsFor('adc')).toEqual([['GP26', '26']])
  })

  it('offers only PWM-capable pins where PWM is needed', () => {
    setBoardPins(PICO)
    expect(pinOptionsFor('pwm')).toEqual([
      ['GP0', '0'],
      ['GP15', '15']
    ])
  })

  it('offers everything when no capability is asked for', () => {
    setBoardPins(PICO)
    expect(pinOptionsFor()).toHaveLength(3)
  })

  it('a pin that declares NO capabilities is offered for everything', () => {
    // A hand-authored or older board part declares nothing. "We don't know" must
    // not read as "this pin can't" — that would empty the dropdown on a board
    // whose part is simply older than this feature.
    setBoardPins([{ gpio: 7, label: 'GP7', capabilities: [] }])
    expect(pinOptionsFor('adc')).toEqual([['GP7', '7']])
  })

  it('never offers an EMPTY dropdown', () => {
    // A block nobody can configure is worse than one offering the wrong pins.
    setBoardPins([{ gpio: 3, label: 'GP3', capabilities: ['digital'] }])
    expect(pinOptionsFor('adc')).toEqual([['GP3', '3']])
    setBoardPins([])
    expect(pinOptionsFor('adc').length).toBeGreaterThan(0)
  })

  it('falls back to the Pico when no board has been resolved', () => {
    setBoardPins([])
    expect(pinOptionsFor('adc').map(([l]) => l)).toEqual(['GP26', 'GP27', 'GP28'])
  })
})

describe('pin conflicts are warnings, not errors (#1012)', () => {
  beforeEach(() => setBoardPins(FALLBACK_PINS))

  it('says who else is on the pin, by name', () => {
    const out = pinConflicts([
      { blockId: 'a', pin: '15', role: 'servo' },
      { blockId: 'b', pin: '15', role: 'buzzer' }
    ])
    expect(out.get('a')).toBe('GP15 is also used by the buzzer.')
    expect(out.get('b')).toBe('GP15 is also used by the servo.')
  })

  it('leaves a block with nothing wrong out of the map entirely', () => {
    const out = pinConflicts([
      { blockId: 'a', pin: '15', role: 'led' },
      { blockId: 'b', pin: '16', role: 'buzzer' }
    ])
    expect(out.size).toBe(0)
  })

  it('flags a pin this board does not have', () => {
    setBoardPins([{ gpio: 0, label: 'GP0', capabilities: ['digital'] }])
    expect(pinConflicts([{ blockId: 'a', pin: '40', role: 'led' }]).get('a')).toBe(
      'This board has no GP40.'
    )
  })

  it('flags a pin that cannot do the job — the failure that looks like nothing', () => {
    setBoardPins([{ gpio: 3, label: 'GP3', capabilities: ['digital', 'pwm'] }])
    expect(pinConflicts([{ blockId: 'a', pin: '3', role: 'sensor', needs: 'adc' }]).get('a')).toBe(
      "GP3 can't do adc on this board."
    )
  })

  it('does not flag a capability on a board that declares none', () => {
    setBoardPins([{ gpio: 3, label: 'GP3', capabilities: [] }])
    expect(pinConflicts([{ blockId: 'a', pin: '3', role: 'sensor', needs: 'adc' }]).size).toBe(0)
  })

  it('reports every problem a block has at once', () => {
    setBoardPins([{ gpio: 3, label: 'GP3', capabilities: ['digital'] }])
    const out = pinConflicts([
      { blockId: 'a', pin: '3', role: 'sensor', needs: 'adc' },
      { blockId: 'b', pin: '3', role: 'led' }
    ])
    expect(out.get('a')).toBe("GP3 is also used by the led.\nGP3 can't do adc on this board.")
  })
})

describe('the hardware category (#1012)', () => {
  it('covers everything the issue lists', () => {
    expect(blocksInCategory('hardware').map((b) => b.type)).toEqual([
      'snakie_led_set',
      'snakie_led_toggle',
      'snakie_pin_write',
      'snakie_onboard_led',
      'snakie_pin_read',
      'snakie_pin_pressed',
      'snakie_pwm_duty',
      'snakie_pwm_freq',
      'snakie_adc_read',
      'snakie_servo_angle',
      'snakie_buzzer_tone',
      'snakie_buzzer_stop'
    ])
  })

  it('every hardware block has a tooltip and an in-app help article', () => {
    for (const def of blocksInCategory('hardware')) {
      expect(typeof def.json?.tooltip).toBe('string')
      expect(def.help).toBeTruthy()
    }
  })
})

describe('ledPinToken (#1012)', () => {
  it('writes a numbered LED as a number and a named one as a string', () => {
    // `Pin("25")` is accepted by some ports and not others; `Pin(LED)` is a
    // NameError. Getting this the wrong way round breaks the first program most
    // people write, on half the boards.
    expect(ledPinToken('25')).toBe('25')
    expect(ledPinToken('LED')).toBe("'LED'")
    expect(ledPinToken('GP25')).toBe('25')
  })

  it('is null when the board declares none, so the block can say so', () => {
    expect(ledPinToken(undefined)).toBeNull()
    expect(ledPinToken('')).toBeNull()
    expect(ledPinToken('   ')).toBeNull()
  })
})
