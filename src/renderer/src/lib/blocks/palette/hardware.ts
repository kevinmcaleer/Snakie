import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { FIELD_PIN_TYPE } from '../pin-field'
import {
  circuitPythonPin,
  isPinName,
  onboardLedToken,
  pinAliasesIn,
  pinConstructor,
  PIN_ALIAS_BLOCK,
  resolvePinGpio
} from '../board-pins'
import { i2cBlockForPins } from '../../../components/display-logic'
import { registerCallRules } from '../python-to-blocks'
import type * as Blockly from 'blockly/core'

/**
 * HARDWARE (#1012, epic #1007).
 * =============================================================================
 *
 * The reason any of this exists: blocks that make a real pin do a real thing.
 *
 * THE GENERATED CODE IS CONSTRAINED, and not by taste. Three things have to hold
 * at once, and between them they decide every line below:
 *
 *  1. **It has to run.** `instruments.py` is a real module with a real API, and
 *     it is fussier than it looks: `Led(pin=…)` wants a Pin OBJECT and drives it
 *     through `.set(True)`, not `.on()`; `Buzzer` takes a PWM and is configured
 *     after construction; `ADC` is not on the `snakie` umbrella at all and comes
 *     from `machine`. Code that reads nicely and raises `AttributeError` on the
 *     board is worse than no blocks.
 *  2. **The Board View has to see it.** `parse-pins.ts` finds pins by matching
 *     the outermost `Pin`/`PWM`/`ADC`/`I2C`/`SPI` constructor on a line. A servo
 *     written `Servo(pin=0)` is invisible to it — the wiring diagram stays empty
 *     and the pin badges never light. Written `Servo(PWM(Pin(0)), pin=0)` it is
 *     a PWM claim on GP0, and everything downstream works with no changes. That
 *     second `pin=0` is not redundant: it is what `instruments.py` reports as
 *     SERVO telemetry so the Robot View can drive the mapped joint.
 *  3. **It has to be the code we would teach.** Which for `Led`, `Servo` and
 *     `Buzzer` means the friendly `snakie` umbrella — those classes only exist
 *     there, and the import can't be shadowed by a vendor `servo` module.
 *
 * RAW IO COMES FROM `machine`, NOT `snakie`. `Pin`, `PWM`, `ADC` and `I2C` are
 * the board's own types; `snakie.py` only ever re-exported the first two
 * (`micropython/instruments.py` does `from machine import Pin, PWM` and hands
 * them straight on), so `from snakie import Pin` was the same class behind a
 * name that costs a library. Taking them from `machine` means a program built
 * only from the raw-pin, PWM, ADC and I²C blocks runs on a stock MicroPython
 * board with nothing installed — no `/lib/snakie.py`, no `/lib/instruments.py`
 * — and it is the import every MicroPython tutorial and datasheet writes, so a
 * learner who graduates to text has already read it a hundred times. Only the
 * blocks that really need `Led`/`Servo`/`Buzzer` still pull the library in, and
 * they now say so honestly: `from machine import Pin, PWM` + `from snakie
 * import Servo` names exactly what each half is for.
 *
 * ONE OBJECT PER PIN, hoisted into the setup section by the generator's `setup`
 * key. Two "turn the LED on" blocks on GP15 share one `Led`; a third on GP16
 * gets its own. Constructing inside a loop would re-configure the pin thousands
 * of times a second, which is the bug the hoisting exists to prevent.
 */

/** A pin dropdown filtered to the pins that can do this job. */
export const pinField = (
  name: string,
  capability?: string,
  pin?: number
): Record<string, unknown> => ({
  type: FIELD_PIN_TYPE,
  name,
  ...(capability ? { capability } : {}),
  ...(pin === undefined ? {} : { pin })
})

/** The pin a block's field holds, as the generated code writes it. */
export const pinOf = (block: Blockly.Block, name = 'PIN'): string => String(block.getFieldValue(name) ?? 0)

/** What each CircuitPython peripheral needs in scope (#1040). */
const CP_DIGITAL = [{ module: 'board' }, { module: 'digitalio' }] as const
const CP_PWM = [{ module: 'board' }, { module: 'pwmio' }] as const
const CP_ADC = [{ module: 'board' }, { module: 'analogio' }] as const

export const HARDWARE_BLOCKS: BlockDefinition[] = [
  // ---------------------------------------------------------------- digital out
  {
    type: 'snakie_led_set',
    circuitpython: {
      imports: CP_DIGITAL,
      // `.value = True`, an attribute. There is no `.set()` and no `Led` class:
      // CircuitPython's core has no opinion about what a pin is wired to.
      code: (block, gen) =>
        `${cpDigitalOut(gen, pinOf(block), block, 'led')}.value = ${
          block.getFieldValue('STATE') === 'ON' ? 'True' : 'False'
        }\n`
    },
    // How that line reads BACK (#1058). Two lines make this block — the hoisted
    // `led_15 = Led(...)` and the call on it — so the round trip has to know
    // both, and that the pin lives in the object's NAME rather than either call.
    read: {
      fn: 'set',
      args: [] as const,
      receiver: { name: 'led', pinField: 'PIN', ctor: 'Led(pin=Pin({PIN}, Pin.OUT))' },
      argFields: { 0: { field: 'STATE', values: { True: 'ON', False: 'OFF' } } }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'LED', needs: 'digital', direction: 'out' },
    help: 'inst-led',
    json: {
      message0: 'turn LED on %1 %2',
      args0: [
        pinField('PIN', 'digital', 15),
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            ['on', 'ON'],
            ['off', 'OFF']
          ]
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Light an LED wired to this pin, or turn it off.'
    },
    imports: [
      { module: 'snakie', name: 'Led' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => {
      const name = led(gen, pinOf(block), block)
      return `${name}.set(${block.getFieldValue('STATE') === 'ON' ? 'True' : 'False'})\n`
    }
  },
  {
    type: 'snakie_led_toggle',
    circuitpython: {
      imports: CP_DIGITAL,
      // No `.toggle()` either — `not` its own value, which is also the clearest
      // thing to read and exactly what the MicroPython method does.
      code: (block, gen) => {
        const name = cpDigitalOut(gen, pinOf(block), block)
        return `${name}.value = not ${name}.value\n`
      }
    },
    read: {
      fn: 'toggle',
      args: [] as const,
      receiver: { name: 'pin', pinField: 'PIN', ctor: 'Pin({PIN}, Pin.OUT)' }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'LED', needs: 'digital', direction: 'out' },
    help: 'inst-led',
    json: {
      message0: 'toggle LED on %1',
      args0: [pinField('PIN', 'digital', 15)],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Flip an LED: on becomes off, off becomes on. The heart of a blink.'
    },
    imports: [{ module: 'machine', name: 'Pin' }],
    code: (block, gen) => {
      // `Led` has no toggle, and reading `Led`'s private pin back would be worse
      // than using the Pin the learner can already see in the setup line.
      const name = digitalPin(gen, pinOf(block), block)
      return `${name}.toggle()\n`
    }
  },
  {
    type: 'snakie_pin_write',
    circuitpython: {
      imports: CP_DIGITAL,
      code: (block, gen) =>
        `${cpDigitalOut(gen, pinOf(block), block)}.value = ${
          block.getFieldValue('VALUE') === '1' ? 'True' : 'False'
        }\n`
    },
    read: {
      fn: 'value',
      args: [] as const,
      receiver: { name: 'pin', pinField: 'PIN', ctor: 'Pin({PIN}, Pin.OUT)' },
      argFields: { 0: { field: 'VALUE', values: { '1': '1', '0': '0' } } }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'pin output', needs: 'digital', direction: 'out' },
    help: 'ref-pins',
    json: {
      message0: 'set pin %1 to %2',
      args0: [
        pinField('PIN', 'digital', 15),
        {
          type: 'field_dropdown',
          name: 'VALUE',
          options: [
            ['1 (high)', '1'],
            ['0 (low)', '0']
          ]
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Drive a pin high or low directly — for anything that is not an LED.'
    },
    imports: [{ module: 'machine', name: 'Pin' }],
    code: (block, gen) =>
      `${digitalPin(gen, pinOf(block), block)}.value(${block.getFieldValue('VALUE')})\n`
  },
  {
    type: 'snakie_onboard_led',
    circuitpython: {
      imports: CP_DIGITAL,
      // `board.LED` by name, on every CircuitPython board that has one — which
      // is the case the MicroPython side needs a per-board token for.
      code: (block, gen) => {
        const name = gen.setup(
          'cp-onboard-led',
          'onboard_led',
          'digitalio.DigitalInOut(board.LED)',
          block,
          ['{NAME}.direction = digitalio.Direction.OUTPUT']
        )
        return `${name}.value = ${block.getFieldValue('STATE') === 'ON' ? 'True' : 'False'}\n`
      }
    },
    category: 'hardware',
    help: 'inst-led',
    json: {
      message0: 'turn the onboard LED %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            ['on', 'ON'],
            ['off', 'OFF']
          ]
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'The little LED on the board itself — no wiring needed. The first program most people write.'
    },
    imports: [{ module: 'machine', name: 'Pin' }],
    code: (block, gen) => {
      // The token is the BOARD's, not a guess: a Pico W's onboard LED hangs off
      // the wireless chip and is `Pin("LED")` with no GPIO number at all, while a
      // plain Pico's is GP25. Getting this from the board definition is the only
      // way the same block works on both.
      const token = onboardLedToken() ?? '"LED"'
      const name = gen.setup(`onboard-led`, 'onboard_led', `Pin(${token}, Pin.OUT)`, block)
      return `${name}.value(${block.getFieldValue('STATE') === 'ON' ? '1' : '0'})\n`
    }
  },

  // ----------------------------------------------------------------- digital in
  {
    type: 'snakie_pin_read',
    circuitpython: {
      imports: CP_DIGITAL,
      // A BOOLEAN here, where MicroPython gives 1/0 — so `int(...)`, because
      // the block says "1 when it is high" and a block that says one thing and
      // returns another is worse than a slightly longer line.
      code: (block, gen) => [
        `int(${cpDigitalIn(gen, pinOf(block), block.getFieldValue('PULL'), block)}.value)`,
        Order.FUNCTION_CALL
      ]
    },
    // The PULL comes off the CONSTRUCTOR, not the call — `pin_14.value()` says
    // nothing about the resistor, and getting it wrong would rewrite the
    // learner's wiring. `NONE` writes no suffix at all, hence the empty string.
    read: {
      fn: 'value',
      args: [] as const,
      shape: 'value' as const,
      receiver: {
        name: 'pin',
        pinField: 'PIN',
        ctor: 'Pin({PIN}, Pin.IN{PULL})',
        options: {
          PULL: { PULL_UP: ', Pin.PULL_UP', PULL_DOWN: ', Pin.PULL_DOWN', NONE: '' }
        }
      }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'pin input', needs: 'digital', direction: 'in' },
    help: 'ref-pins',
    json: {
      message0: 'read pin %1 %2',
      args0: [pinField('PIN', 'digital', 14), pullDropdown()],
      inputsInline: true,
      output: 'Number',
      tooltip: 'The value on a pin right now: 1 when it is high, 0 when it is low.'
    },
    imports: [{ module: 'machine', name: 'Pin' }],
    code: (block, gen) => [
      `${inputPin(gen, pinOf(block), block.getFieldValue('PULL'), block)}.value()`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_pin_pressed',
    circuitpython: {
      imports: CP_DIGITAL,
      code: (block, gen) => {
        const pull = block.getFieldValue('PULL')
        const name = cpDigitalIn(gen, pinOf(block), pull, block)
        // Same reasoning as the MicroPython side: with a pull-UP a pressed
        // button pulls the pin LOW.
        return pull === 'PULL_UP'
          ? [`not ${name}.value`, Order.LOGICAL_NOT]
          : [`${name}.value`, Order.ATOMIC]
      }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'button', needs: 'digital', direction: 'in' },
    help: 'inst-button',
    json: {
      message0: 'button on %1 is pressed %2',
      args0: [pinField('PIN', 'digital', 14), pullDropdown()],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True while a button on this pin is held down. Pull-up is the usual wiring: the button connects the pin to ground.'
    },
    imports: [{ module: 'machine', name: 'Pin' }],
    code: (block, gen) => {
      const pull = block.getFieldValue('PULL')
      const name = inputPin(gen, pinOf(block), pull, block)
      // With a pull-UP, a pressed button pulls the pin DOWN — so pressed is
      // `not value()`. Generating the wrong one here would make every button
      // program read backwards, which is the single most common beginner
      // wiring confusion and exactly what the dropdown exists to settle.
      return pull === 'PULL_UP'
        ? [`not ${name}.value()`, Order.LOGICAL_NOT]
        : [`${name}.value() == 1`, Order.RELATIONAL]
    }
  },

  // ------------------------------------------------------------------------ PWM
  {
    type: 'snakie_pwm_duty',
    circuitpython: {
      imports: CP_PWM,
      // `duty_cycle`, and the same 16-bit range — so the arithmetic that IS the
      // lesson stays word for word what the MicroPython block writes.
      code: (block, gen) => {
        const name = cpPwm(gen, pinOf(block), block)
        const percent = gen.valueToCode(block, 'PERCENT', Order.MULTIPLICATIVE) || '0'
        return `${name}.duty_cycle = int(${percent} * 65535 / 100)\n`
      }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'brightness', needs: 'pwm' },
    help: 'ref-pwm',
    json: {
      message0: 'set brightness of %1 to %2 %%',
      args0: [
        pinField('PIN', 'pwm', 15),
        { type: 'input_value', name: 'PERCENT', check: 'Number' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Dim an LED (or drive a motor) from 0 to 100 per cent.'
    },
    toolbox: { inputs: { PERCENT: { shadow: { type: 'math_number', fields: { NUM: 50 } } } } },
    imports: [
      { module: 'machine', name: 'PWM' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => {
      const name = pwm(gen, pinOf(block), block)
      const percent = gen.valueToCode(block, 'PERCENT', Order.MULTIPLICATIVE) || '0'
      // `duty_u16` is 0-65535, which is not a number a child should have to
      // know — but it IS the number MicroPython wants, so the conversion is on
      // the line where they can see both.
      return `${name}.duty_u16(int(${percent} * 65535 / 100))\n`
    }
  },
  {
    type: 'snakie_pwm_freq',
    circuitpython: {
      imports: CP_PWM,
      code: (block, gen) =>
        `${cpPwm(gen, pinOf(block), block)}.frequency = ${
          gen.valueToCode(block, 'HZ', Order.NONE) || '1000'
        }\n`
    },
    read: {
      fn: 'freq',
      args: ['HZ'] as const,
      receiver: { name: 'pwm', pinField: 'PIN', ctor: 'PWM(Pin({PIN}))' }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'frequency', needs: 'pwm' },
    help: 'ref-pwm',
    json: {
      message0: 'set frequency of %1 to %2 Hz',
      args0: [pinField('PIN', 'pwm', 15), { type: 'input_value', name: 'HZ', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'How many times a second the pin pulses. 50 Hz for a servo, 1000 Hz for an LED.'
    },
    toolbox: { inputs: { HZ: { shadow: { type: 'math_number', fields: { NUM: 1000 } } } } },
    imports: [
      { module: 'machine', name: 'PWM' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) =>
      `${pwm(gen, pinOf(block), block)}.freq(${gen.valueToCode(block, 'HZ', Order.NONE) || '1000'})\n`
  },

  // ------------------------------------------------------------------------ ADC
  {
    type: 'snakie_adc_read',
    circuitpython: {
      imports: CP_ADC,
      // `.value` is already 0–65535, the same range `read_u16()` gives, so both
      // dialects divide by the same number and the lesson is the same lesson.
      code: (block, gen) => {
        const name = cpAdc(gen, pinOf(block), block)
        if (block.getFieldValue('UNIT') === 'RAW') return [`${name}.value`, Order.MEMBER]
        return [`${name}.value * 3.3 / 65535`, Order.MULTIPLICATIVE]
      }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'analogue read', needs: 'adc' },
    help: 'ref-pins',
    json: {
      message0: 'read %1 as %2',
      args0: [
        pinField('PIN', 'adc', 26),
        {
          type: 'field_dropdown',
          name: 'UNIT',
          options: [
            ['volts', 'VOLTS'],
            ['a number 0-65535', 'RAW']
          ]
        }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Measure the voltage on an analogue pin — a dial, a light sensor, a battery. Only some pins can do this.'
    },
    // `ADC` was never on the `snakie` umbrella (it re-exports Led, Servo,
    // Buzzer, Pin and PWM and nothing else), so this block always came from
    // `machine` — and now its `Pin` does too, which is how the whole analogue
    // read runs with no library installed.
    imports: [
      { module: 'machine', name: 'ADC' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => {
      const name = adc(gen, pinOf(block), block)
      if (block.getFieldValue('UNIT') === 'RAW') {
        return [`${name}.read_u16()`, Order.FUNCTION_CALL]
      }
      // 3.3 V over the full 16-bit range. Written out for the same reason the
      // duty conversion is: the magic number is the lesson.
      return [`${name}.read_u16() * 3.3 / 65535`, Order.MULTIPLICATIVE]
    }
  },

  // ---------------------------------------------------------------------- servo
  {
    type: 'snakie_servo_angle',
    read: {
      fn: 'angle',
      args: ['ANGLE'] as const,
      receiver: {
        name: 'servo',
        pinField: 'PIN',
        ctor: 'Servo(PWM(Pin({PIN})), pin={PIN})'
      }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'servo', needs: 'pwm' },
    help: 'inst-servo',
    json: {
      message0: 'set servo on %1 to %2 degrees',
      args0: [pinField('PIN', 'pwm', 0), { type: 'input_value', name: 'ANGLE', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Move a hobby servo to an angle between 0 and 180 degrees.'
    },
    toolbox: { inputs: { ANGLE: { shadow: { type: 'math_number', fields: { NUM: 90 } } } } },
    imports: [
      { module: 'machine', name: 'PWM' },
      { module: 'machine', name: 'Pin' },
      { module: 'snakie', name: 'Servo' }
    ],
    code: (block, gen) => {
      const pin = pinOf(block)
      // `Servo(PWM(Pin(n)), pin=n)`, not `Servo(pin=n)`. The explicit PWM is what
      // `parse-pins.ts` matches, so the Board View draws the wire; the `pin=` is
      // what `instruments.py` reports as SERVO telemetry, so the Robot View can
      // drive the mapped joint. Both, or one of the two views goes dark.
      const at = pinObject(gen, pin, block)
      // `pin=` STAYS A NUMBER even for a named pin: `instruments.py` reports it
      // as SERVO telemetry and the Robot View maps that number to a joint, so a
      // Pin object there would take the 3-D model dark.
      const gpio = resolvePinGpio(pin, pinAliasesIn(block.workspace)) ?? pin
      const name = gen.setup(
        `servo:${pin}`,
        `servo_${pin}`,
        `Servo(PWM(${at}), pin=${gpio})`,
        block
      )
      return `${name}.angle(${gen.valueToCode(block, 'ANGLE', Order.NONE) || '90'})\n`
    }
  },

  // --------------------------------------------------------------------- buzzer
  {
    type: 'snakie_buzzer_tone',
    read: {
      fn: 'tone',
      args: ['FREQ', 'MS'] as const,
      receiver: { name: 'buzzer', pinField: 'PIN', ctor: 'Buzzer(PWM(Pin({PIN})))' }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'buzzer', needs: 'pwm' },
    help: 'inst-buzzer',
    json: {
      message0: 'buzzer on %1 play %2 Hz for %3 ms',
      args0: [
        pinField('PIN', 'pwm', 16),
        { type: 'input_value', name: 'FREQ', check: 'Number' },
        { type: 'input_value', name: 'MS', check: 'Number' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Sound one note. 440 Hz is the A above middle C.'
    },
    toolbox: {
      inputs: {
        FREQ: { shadow: { type: 'math_number', fields: { NUM: 440 } } },
        MS: { shadow: { type: 'math_number', fields: { NUM: 200 } } }
      }
    },
    imports: [
      { module: 'snakie', name: 'Buzzer' },
      { module: 'machine', name: 'PWM' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => {
      const freq = gen.valueToCode(block, 'FREQ', Order.NONE) || '440'
      const ms = gen.valueToCode(block, 'MS', Order.NONE) || '200'
      return `${buzzer(gen, pinOf(block), block)}.tone(${freq}, ${ms})\n`
    }
  },
  {
    type: 'snakie_buzzer_stop',
    read: {
      fn: 'stop',
      args: [] as const,
      receiver: { name: 'buzzer', pinField: 'PIN', ctor: 'Buzzer(PWM(Pin({PIN})))' }
    },
    category: 'hardware',
    pin: { field: 'PIN', role: 'buzzer', needs: 'pwm' },
    help: 'inst-buzzer',
    json: {
      message0: 'silence buzzer on %1',
      args0: [pinField('PIN', 'pwm', 16)],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Stop whatever the buzzer is playing.'
    },
    imports: [
      { module: 'snakie', name: 'Buzzer' },
      { module: 'machine', name: 'PWM' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => `${buzzer(gen, pinOf(block), block)}.stop()\n`
  },

  // ----------------------------------------------------------------- I2C bus
  // WHY THESE ARE HERE AND NOT IN INSTRUMENTS (#1057). There is an
  // `snakie_inst_i2c_scan` already, and it is a different thing: it feeds the
  // I²C Detect panel. These hand the learner the ANSWER — the addresses, as a
  // list, and the one question they actually ask of a bus, which is "is my
  // sensor plugged in?". Before this, `i2c = I2C(Pin(0), Pin(1))` and
  // `i2c.scan()` had no block at all and came back from #1019 as two raw
  // Python blocks: readable, unbuildable.
  {
    type: 'snakie_i2c_scan',
    category: 'hardware',
    help: 'ref-pins',
    json: {
      message0: 'the I²C devices on SDA %1 SCL %2',
      args0: [pinField('SDA', 'i2c', 4), pinField('SCL', 'i2c', 5)],
      inputsInline: true,
      output: 'Array',
      tooltip:
        'The addresses of everything plugged into the I²C wires, as a list. This one pauses for a moment — don’t put it in a fast loop.'
    },
    imports: [
      { module: 'machine', name: 'I2C' },
      { module: 'machine', name: 'Pin' }
    ],
    code: (block, gen) => [`${i2c(gen, block)}.scan()`, Order.FUNCTION_CALL]
  },
  {
    type: 'snakie_i2c_present',
    category: 'hardware',
    help: 'ref-pins',
    json: {
      message0: 'is there a device at address %1 on SDA %2 SCL %3',
      args0: [
        { type: 'field_input', name: 'ADDR', text: '0x76' },
        pinField('SDA', 'i2c', 4),
        pinField('SCL', 'i2c', 5)
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True when something answers at that address. The question a wiring problem actually asks — put it in an if.'
    },
    imports: [
      { module: 'machine', name: 'I2C' },
      { module: 'machine', name: 'Pin' }
    ],
    // `in`, not `== scan()[0]`: a bus with two devices on it must still find
    // the one being asked about, whichever order it came back in.
    code: (block, gen) => [
      `${i2cAddress(block)} in ${i2c(gen, block)}.scan()`,
      Order.RELATIONAL
    ]
  },

  // ------------------------------------------------------------------ name a pin
  //
  // A DECLARATION, not a step. It generates no line where it stands — the
  // assignment it causes is hoisted into the setup section with the rest — which
  // is the same shape the import blocks have, and for the same reason: what it
  // does is make a name mean something for the whole program.
  {
    type: PIN_ALIAS_BLOCK,
    // Nothing on CircuitPython. There a pin is `board.GP15`, an attribute rather
    // than a number a variable can hold, so `circuitPythonPin` resolves the name
    // at the point of use and this block has nothing left to emit.
    circuitpython: { imports: [], code: () => '' },
    category: 'hardware',
    help: 'ref-pins',
    json: {
      message0: 'name pin %1 as %2 %3',
      args0: [
        // NO CAPABILITY FILTER: the name is for the pin, and which jobs it can do
        // is a question for the block that eventually uses it. Filtering here
        // would hide GP26 from somebody naming their battery sense line.
        pinField('PIN', undefined, 15),
        { type: 'field_input', name: 'NAME', text: 'motor_left' },
        {
          // THE DIRECTION LIVES HERE because the object does. `Pin(4)` on its own
          // is not configured for anything, and a pin driven the wrong way round
          // does nothing at all rather than failing — the silent wrong answer
          // this palette is built to avoid. The four options are exactly what
          // the read blocks' own pull dropdown already offers, because they are
          // the same four constructors.
          type: 'field_dropdown',
          name: 'DIRECTION',
          options: [
            ['for output', 'OUT'],
            ['for input', 'IN'],
            ['for input, pull-up', 'PULL_UP'],
            ['for input, pull-down', 'PULL_DOWN']
          ]
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Give a pin a name you will recognise, and say which way it is driven. Every pin dropdown then offers the name, and your program uses this one pin object everywhere — so rewiring means changing this one block.'
    },
    code: (block, gen) => {
      const name = String(block.getFieldValue('NAME') ?? '').trim()
      const gpio = Number(block.getFieldValue('PIN'))
      // A BLANK NAME IS NOT A DECLARATION. A learner clearing the field to retype
      // it should get a program that still runs, not `= Pin(15, Pin.OUT)` on a
      // line with nothing on its left.
      if (!name || !Number.isFinite(gpio)) return ''
      // `Pin` IS NEEDED FROM HERE, not from a static `imports` list, precisely
      // because of the line above: a block mid-retype declares nothing, and a
      // static list would still have put `from machine import Pin` at the top of
      // a program with nothing to use it.
      gen.need({ module: 'machine', name: 'Pin' })
      const raw = String(block.getFieldValue('DIRECTION') ?? 'OUT')
      const direction = (['OUT', 'IN', 'PULL_UP', 'PULL_DOWN'] as const).find((d) => d === raw)
      // Registered with THIS block, so the line is attributed to it however the
      // blocks are laid out — a block that already needed the name registered it
      // anonymously, and `setup` lets the owner step forward.
      gen.setup(`pin-alias:${name}`, name, pinConstructor(gpio, direction ?? 'OUT'), block)
      return ''
    }
  },
]

// ---------------------------------------------------------------------------
// The hoisted objects. One per pin per role, so two blocks on one pin share.
// ---------------------------------------------------------------------------

/**
 * What to write where the pin goes: a GPIO number, or the learner's name for it.
 *
 * A named pin costs one assignment at the top (`motor_left_speed = 15`) and then
 * reads as the name everywhere after. The assignment is registered HERE, from
 * the first block that uses the name, rather than being left to the `name pin`
 * block to emit — because the setup section is written in first-request order,
 * and a learner is perfectly entitled to park the `name pin` block below the
 * blocks that use it. Registering it from the point of use means the assignment
 * can never land after the `Pin(...)` that reads it, whatever the layout. The
 * `name pin` block claims the line when it emits (see `setup`), so the mirror
 * still lights up on the block a learner actually chose.
 *
 * A NAME NOTHING DECLARES is written through unchanged — a `name pin` block
 * deleted out from under a block still set to its name. That generates a
 * `NameError`, which is the honest outcome: substituting some other pin would
 * drive the wrong hardware silently, and `pin-conflicts.ts` puts a warning on
 * the block before it ever runs.
 */
function namedPin(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string | null {
  if (!isPinName(pin)) return null
  const declared = pinAliasesIn(block.workspace).find((a) => a.name === pin.trim())
  // A NAME NOTHING DECLARES is written through unchanged — a `name pin` block
  // deleted out from under a block still set to its name. That raises
  // `NameError`, which is the honest outcome: substituting some other pin would
  // drive the wrong hardware silently, and `pin-conflicts.ts` puts a warning on
  // the block before it ever runs.
  if (!declared) return pin
  return gen.setup(`pin-alias:${pin}`, pin, pinConstructor(declared.gpio, declared.direction))
}

/**
 * The Pin OBJECT to build this peripheral on: the learner's name, or a fresh
 * `Pin(...)` for a plain GPIO.
 *
 * `extra` is what an unnamed pin's constructor needs and a named one already
 * has — `, Pin.OUT` for a digital output. A named pin was configured once, on
 * the block that named it, so nothing here configures it a second time; a block
 * that needs the other direction is a mismatch `pin-conflicts.ts` reports rather
 * than something to paper over.
 */
function pinObject(
  gen: MicroPythonGenerator,
  pin: string,
  block: Blockly.Block,
  extra = ''
): string {
  return namedPin(gen, pin, block) ?? `Pin(${pin}${extra})`
}

/** `led_15 = Led(pin=Pin(15, Pin.OUT))` — the Snakie LED over a digital pin. */
function led(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  const at = pinObject(gen, pin, block, ', Pin.OUT')
  return gen.setup(`led:${pin}`, `led_${pin}`, `Led(pin=${at})`, block)
}

/** `pin_15 = Pin(15, Pin.OUT)` — a bare output pin. */
function digitalPin(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  // A NAMED PIN IS ALREADY THE OBJECT, so there is nothing to hoist: the name
  // the learner chose is what the call is made on. Wrapping it in a second
  // `Pin(...)` is what the number form used to do, and it is what made the name
  // stand for a pin number rather than for the pin.
  return namedPin(gen, pin, block) ?? gen.setup(`pin-out:${pin}`, `pin_${pin}`, `Pin(${pin}, Pin.OUT)`, block)
}

/** `button_14 = Pin(14, Pin.IN, Pin.PULL_UP)` — an input with its resistor. */
function inputPin(
  gen: MicroPythonGenerator,
  pin: string,
  pull: string,
  block: Blockly.Block
): string {
  // The PULL is part of the key: the same pin read with a pull-up and a
  // pull-down is two different configurations, and silently sharing the first
  // one would make the second block's dropdown a lie.
  const suffix = pull === 'NONE' ? '' : `, Pin.${pull}`
  // As `digitalPin`: a named pin carries its own pull, chosen where it was
  // named, and this block's dropdown does not get to override it.
  const named = namedPin(gen, pin, block)
  if (named) return named
  return gen.setup(`pin-in:${pin}:${pull}`, `pin_${pin}`, `Pin(${pin}, Pin.IN${suffix})`, block)
}

/**
 * `adc_26 = ADC(Pin(26))`.
 *
 * Exported so #1014's `read_adc` block shares the SAME object as this palette's
 * analogue-read block: one key, one construction, whichever of the two a learner
 * reaches for — and two `ADC`s on one pin is a real bug, not a tidiness point.
 */
export function adc(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`adc:${pin}`, `adc_${pin}`, `ADC(${pinObject(gen, pin, block)})`, block)
}

/** `pwm_15 = PWM(Pin(15))`. Exported for #1014's `read_pwm`, as `adc` above. */
export function pwm(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`pwm:${pin}`, `pwm_${pin}`, `PWM(${pinObject(gen, pin, block)})`, block)
}

/**
 * `i2c_0 = I2C(0, sda=Pin(4), scl=Pin(5))` — the bus a SDA/SCL pair selects.
 *
 * The RP2040 muxes its two I²C blocks onto fixed pin sets, so the bus NUMBER is
 * decided by the pins: `i2cBlockForPins` is the same table `instruments.py` and
 * the Display panel already use, rather than a third copy of it. An invalid
 * pair falls back to bus 0 and leaves the pin-conflict pass to say so, because
 * refusing to generate would leave a learner holding a block that silently does
 * nothing.
 *
 * WRITTEN EXACTLY LIKE THIS ON PURPOSE. `parse-pins.ts` matches
 * `I2C(id, sda=Pin(a), scl=Pin(b))` to light the Board View's SDA/SCL badges —
 * so the spelling is what makes these HARDWARE blocks rather than calls. The
 * same reason `Servo` is written `Servo(PWM(Pin(0)), pin=0)` above.
 *
 * Exported for #1014's `i2c_scan`, which used to keep its own copy of this.
 */
export function i2c(gen: MicroPythonGenerator, block: Blockly.Block): string {
  const sda = pinOf(block, 'SDA')
  const scl = pinOf(block, 'SCL')
  // The BUS is decided by the real GPIOs — the RP2040 muxes its two I²C blocks
  // onto fixed pin sets, and a name does not change which hole it is — while the
  // generated line says whatever the learner called them.
  const declared = pinAliasesIn(block.workspace)
  const bus =
    i2cBlockForPins(resolvePinGpio(sda, declared) ?? NaN, resolvePinGpio(scl, declared) ?? NaN) ?? 0
  const sdaAt = pinObject(gen, sda, block)
  const sclAt = pinObject(gen, scl, block)
  return gen.setup(
    `i2c:${bus}:${sda}:${scl}`,
    `i2c_${bus}`,
    `I2C(${bus}, sda=${sdaAt}, scl=${sclAt})`,
    block
  )
}

/**
 * The address field, as the generated code should write it.
 *
 * I²C addresses are quoted in hex everywhere a datasheet, a tutorial or a
 * `i2cdetect` dump shows them, so the field holds `0x76` and the code says
 * `0x76` — a learner comparing the block to the sensor's page should see the
 * same characters. Anything that is not a number at all falls back to 0, which
 * matches nothing and is visibly wrong, rather than generating a syntax error
 * into their program.
 */
export function i2cAddress(block: Blockly.Block): string {
  const raw = String(block.getFieldValue('ADDR') ?? '').trim()
  return /^(0[xX][0-9a-fA-F]+|\d+)$/.test(raw) ? raw : '0'
}

/** `buzzer_16 = Buzzer(PWM(Pin(16)))`. */
function buzzer(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  const at = pinObject(gen, pin, block)
  return gen.setup(`buzzer:${pin}`, `buzzer_${pin}`, `Buzzer(PWM(${at}))`, block)
}

/**
 * The pull-resistor dropdown.
 *
 * On the block, not hidden in the generated code, because it is the thing that
 * decides whether a button reads 1 or 0 when pressed — and a beginner whose
 * button "doesn't work" is nearly always looking at this. The issue's words: a
 * dropdown, not a mystery.
 */
function pullDropdown(): Record<string, unknown> {
  return {
    type: 'field_dropdown',
    name: 'PULL',
    options: [
      ['with pull-up', 'PULL_UP'],
      ['with pull-down', 'PULL_DOWN'],
      ['with no pull resistor', 'NONE']
    ]
  }
}

// ---------------------------------------------------------------------------
// The same objects, in CircuitPython (#1040)
// ---------------------------------------------------------------------------
//
// THE TWO APIS ARE DIFFERENT SHAPES, and that is the whole difficulty. A
// `machine.Pin` says everything in its constructor; a `digitalio.DigitalInOut`
// is built first and told its direction afterwards, and its value is an
// ATTRIBUTE rather than a call. So these hoist with an `after` line, which is
// what `gen.setup`'s last argument is for, and the emitters assign rather than
// call.
//
// The pin name comes off the board profile (`circuitPythonPin`): `board.GP15`
// and `machine.Pin(15)` are the same physical hole, and the silk label is what
// CircuitPython's own `board` module is built from.

/** `led_15 = digitalio.DigitalInOut(board.GP15)` + its direction. */
function cpDigitalOut(gen: MicroPythonGenerator, pin: string, block: Blockly.Block, role = 'pin'): string {
  return gen.setup(
    `cp-out:${pin}`,
    `${role}_${pin}`,
    `digitalio.DigitalInOut(${circuitPythonPin(pin)})`,
    block,
    ['{NAME}.direction = digitalio.Direction.OUTPUT']
  )
}

/** An input, with its pull. CircuitPython spells "no pull" as `None`. */
function cpDigitalIn(
  gen: MicroPythonGenerator,
  pin: string,
  pull: string,
  block: Blockly.Block
): string {
  const pulls: Record<string, string> = {
    PULL_UP: 'digitalio.Pull.UP',
    PULL_DOWN: 'digitalio.Pull.DOWN',
    NONE: 'None'
  }
  return gen.setup(
    `cp-in:${pin}:${pull}`,
    `pin_${pin}`,
    `digitalio.DigitalInOut(${circuitPythonPin(pin)})`,
    block,
    [
      '{NAME}.direction = digitalio.Direction.INPUT',
      `{NAME}.pull = ${pulls[pull] ?? 'None'}`
    ]
  )
}

/** `pwm_15 = pwmio.PWMOut(board.GP15)`. */
function cpPwm(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(
    `cp-pwm:${pin}`,
    `pwm_${pin}`,
    // `variable_frequency` so the frequency block can move it later; without it
    // CircuitPython raises the moment anything assigns `.frequency`.
    `pwmio.PWMOut(${circuitPythonPin(pin)}, variable_frequency=True)`,
    block
  )
}

/** `adc_26 = analogio.AnalogIn(board.GP26)`. */
function cpAdc(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`cp-adc:${pin}`, `adc_${pin}`, `analogio.AnalogIn(${circuitPythonPin(pin)})`, block)
}


/**
 * Teach the Python → blocks converter how to read these lines back (#1058).
 *
 * Derived from the block list rather than written out again, exactly as the
 * turtle palette does: the `read` each block carries IS the call its emitter
 * writes, so a block that changes its function name or its constructor changes
 * both halves at once, or neither.
 *
 * EIGHT OF THE TWELVE. The four left out are left out for a reason, and it is
 * the same reason each time — their generated line is not a plain call on the
 * hoisted object:
 *
 *  - `snakie_onboard_led` hoists as `onboard_led`, with no pin in the name to
 *    read back (the board decides it, and on a Pico W it is not a number).
 *  - `snakie_pin_pressed` changes the SHAPE of its line with the dropdown —
 *    `not p.value()` for a pull-up, `p.value() == 1` otherwise — so the line is
 *    not a call at all.
 *  - `snakie_pwm_duty` and `snakie_adc_read` wrap theirs in arithmetic
 *    (`int(x * 65535 / 100)`, `* 3.3 / 65535`), which is the lesson and cannot
 *    be unpicked into a socket by a table.
 *
 * Those four still convert — as raw Python blocks, exactly as before. Reading
 * back fewer lines correctly beats reading back more of them wrongly.
 */
registerCallRules(
  HARDWARE_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)
