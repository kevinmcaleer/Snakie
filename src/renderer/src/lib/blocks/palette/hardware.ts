import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { FIELD_PIN_TYPE } from '../pin-field'
import { onboardLedToken } from '../board-pins'
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
 *  3. **It has to be the code we would teach.** Which is why these target the
 *     friendly `snakie` umbrella rather than raw `machine` — it is the import a
 *     Snakie lesson uses, and it can't be shadowed by a vendor `servo` module.
 *
 * ONE OBJECT PER PIN, hoisted into the setup section by the generator's `setup`
 * key. Two "turn the LED on" blocks on GP15 share one `Led`; a third on GP16
 * gets its own. Constructing inside a loop would re-configure the pin thousands
 * of times a second, which is the bug the hoisting exists to prevent.
 */

/** A pin dropdown filtered to the pins that can do this job. */
const pinField = (name: string, capability?: string, pin?: number): Record<string, unknown> => ({
  type: FIELD_PIN_TYPE,
  name,
  ...(capability ? { capability } : {}),
  ...(pin === undefined ? {} : { pin })
})

/** The pin a block's field holds, as the generated code writes it. */
const pinOf = (block: Blockly.Block, name = 'PIN'): string => String(block.getFieldValue(name) ?? 0)

export const HARDWARE_BLOCKS: BlockDefinition[] = [
  // ---------------------------------------------------------------- digital out
  {
    type: 'snakie_led_set',
    category: 'hardware',
    pin: { field: 'PIN', role: 'LED', needs: 'digital' },
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
      { module: 'snakie', name: 'Pin' }
    ],
    code: (block, gen) => {
      const name = led(gen, pinOf(block), block)
      return `${name}.set(${block.getFieldValue('STATE') === 'ON' ? 'True' : 'False'})\n`
    }
  },
  {
    type: 'snakie_led_toggle',
    category: 'hardware',
    pin: { field: 'PIN', role: 'LED', needs: 'digital' },
    help: 'inst-led',
    json: {
      message0: 'toggle LED on %1',
      args0: [pinField('PIN', 'digital', 15)],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Flip an LED: on becomes off, off becomes on. The heart of a blink.'
    },
    imports: [{ module: 'snakie', name: 'Pin' }],
    code: (block, gen) => {
      // `Led` has no toggle, and reading `Led`'s private pin back would be worse
      // than using the Pin the learner can already see in the setup line.
      const name = digitalPin(gen, pinOf(block), block)
      return `${name}.toggle()\n`
    }
  },
  {
    type: 'snakie_pin_write',
    category: 'hardware',
    pin: { field: 'PIN', role: 'pin output', needs: 'digital' },
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
    imports: [{ module: 'snakie', name: 'Pin' }],
    code: (block, gen) =>
      `${digitalPin(gen, pinOf(block), block)}.value(${block.getFieldValue('VALUE')})\n`
  },
  {
    type: 'snakie_onboard_led',
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
    imports: [{ module: 'snakie', name: 'Pin' }],
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
    category: 'hardware',
    pin: { field: 'PIN', role: 'pin input', needs: 'digital' },
    help: 'ref-pins',
    json: {
      message0: 'read pin %1 %2',
      args0: [pinField('PIN', 'digital', 14), pullDropdown()],
      inputsInline: true,
      output: 'Number',
      tooltip: 'The value on a pin right now: 1 when it is high, 0 when it is low.'
    },
    imports: [{ module: 'snakie', name: 'Pin' }],
    code: (block, gen) => [
      `${inputPin(gen, pinOf(block), block.getFieldValue('PULL'), block)}.value()`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_pin_pressed',
    category: 'hardware',
    pin: { field: 'PIN', role: 'button', needs: 'digital' },
    help: 'inst-button',
    json: {
      message0: 'button on %1 is pressed %2',
      args0: [pinField('PIN', 'digital', 14), pullDropdown()],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True while a button on this pin is held down. Pull-up is the usual wiring: the button connects the pin to ground.'
    },
    imports: [{ module: 'snakie', name: 'Pin' }],
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
      { module: 'snakie', name: 'PWM' },
      { module: 'snakie', name: 'Pin' }
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
      { module: 'snakie', name: 'PWM' },
      { module: 'snakie', name: 'Pin' }
    ],
    code: (block, gen) =>
      `${pwm(gen, pinOf(block), block)}.freq(${gen.valueToCode(block, 'HZ', Order.NONE) || '1000'})\n`
  },

  // ------------------------------------------------------------------------ ADC
  {
    type: 'snakie_adc_read',
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
    // NOT from `snakie`: the umbrella re-exports Led, Servo, Buzzer, Pin and PWM
    // and nothing else, so `from snakie import ADC` would be an ImportError on
    // the board. `machine` is where ADC lives and where every MicroPython
    // tutorial gets it.
    imports: [
      { module: 'machine', name: 'ADC' },
      { module: 'snakie', name: 'Pin' }
    ],
    code: (block, gen) => {
      const name = gen.setup(
        `adc:${pinOf(block)}`,
        `adc_${pinOf(block)}`,
        `ADC(Pin(${pinOf(block)}))`,
        block
      )
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
      { module: 'snakie', name: 'PWM' },
      { module: 'snakie', name: 'Pin' },
      { module: 'snakie', name: 'Servo' }
    ],
    code: (block, gen) => {
      const pin = pinOf(block)
      // `Servo(PWM(Pin(n)), pin=n)`, not `Servo(pin=n)`. The explicit PWM is what
      // `parse-pins.ts` matches, so the Board View draws the wire; the `pin=` is
      // what `instruments.py` reports as SERVO telemetry, so the Robot View can
      // drive the mapped joint. Both, or one of the two views goes dark.
      const name = gen.setup(
        `servo:${pin}`,
        `servo_${pin}`,
        `Servo(PWM(Pin(${pin})), pin=${pin})`,
        block
      )
      return `${name}.angle(${gen.valueToCode(block, 'ANGLE', Order.NONE) || '90'})\n`
    }
  },

  // --------------------------------------------------------------------- buzzer
  {
    type: 'snakie_buzzer_tone',
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
      { module: 'snakie', name: 'PWM' },
      { module: 'snakie', name: 'Pin' }
    ],
    code: (block, gen) => {
      const freq = gen.valueToCode(block, 'FREQ', Order.NONE) || '440'
      const ms = gen.valueToCode(block, 'MS', Order.NONE) || '200'
      return `${buzzer(gen, pinOf(block), block)}.tone(${freq}, ${ms})\n`
    }
  },
  {
    type: 'snakie_buzzer_stop',
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
      { module: 'snakie', name: 'PWM' },
      { module: 'snakie', name: 'Pin' }
    ],
    code: (block, gen) => `${buzzer(gen, pinOf(block), block)}.stop()\n`
  }
]

// ---------------------------------------------------------------------------
// The hoisted objects. One per pin per role, so two blocks on one pin share.
// ---------------------------------------------------------------------------

/** `led_15 = Led(pin=Pin(15, Pin.OUT))` — the Snakie LED over a digital pin. */
function led(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`led:${pin}`, `led_${pin}`, `Led(pin=Pin(${pin}, Pin.OUT))`, block)
}

/** `pin_15 = Pin(15, Pin.OUT)` — a bare output pin. */
function digitalPin(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`pin-out:${pin}`, `pin_${pin}`, `Pin(${pin}, Pin.OUT)`, block)
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
  return gen.setup(`pin-in:${pin}:${pull}`, `pin_${pin}`, `Pin(${pin}, Pin.IN${suffix})`, block)
}

/** `pwm_15 = PWM(Pin(15))`. */
function pwm(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`pwm:${pin}`, `pwm_${pin}`, `PWM(Pin(${pin}))`, block)
}

/** `buzzer_16 = Buzzer(PWM(Pin(16)))`. */
function buzzer(gen: MicroPythonGenerator, pin: string, block: Blockly.Block): string {
  return gen.setup(`buzzer:${pin}`, `buzzer_${pin}`, `Buzzer(PWM(Pin(${pin})))`, block)
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
