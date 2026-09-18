import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * WAIT (#1011, epic #1007).
 * =============================================================================
 *
 * Three blocks, and a category to themselves.
 *
 * That looks disproportionate until you count how often a hardware lesson uses
 * them: every blink, every "press the button, now let go", every "turn the servo
 * and let it get there" is a wait. It is the first block a learner reaches for
 * after the one that does something, and burying it under Control asks them to
 * already know that waiting is a kind of control flow.
 *
 * ONE PER FUNCTION rather than one block with a unit dropdown, because
 * `time.sleep(0.1)`, `time.sleep_ms(100)` and `time.sleep_us(100)` are three
 * different functions in MicroPython and the whole point is that the generated
 * code is the code they will later write. A dropdown would hide exactly the
 * thing we want them to notice.
 *
 * MICROSECONDS EARN THE THIRD because the waits that need them are waits you
 * cannot write any other way: an HC-SR04's 10 µs trigger pulse, a WS2812's reset
 * gap, the setup time on a shift register. `sleep_ms(0)` is not those, and
 * `sleep(0.00001)` is both unreadable and, on a busy board, not obviously that
 * either. It is the datasheet's own unit.
 */
export const WAIT_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_wait_seconds',
    category: 'wait',
    help: 'ref-timing',
    json: {
      message0: 'wait %1 seconds',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Pause the program for a number of seconds. Fractions are fine: 0.5 is half a second.'
    },
    toolbox: { inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    imports: [{ module: 'time' }],
    code: (block, gen) => `time.sleep(${gen.valueToCode(block, 'SECS', Order.NONE) || '0'})\n`
  },
  {
    type: 'snakie_wait_ms',
    category: 'wait',
    help: 'ref-timing',
    json: {
      message0: 'wait %1 milliseconds',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Pause for a number of milliseconds. 1000 milliseconds is one second — use this for short, exact waits.'
    },
    toolbox: { inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } } } },
    imports: [{ module: 'time' }],
    code: (block, gen) => `time.sleep_ms(${gen.valueToCode(block, 'MS', Order.NONE) || '0'})\n`,
    /**
     * CIRCUITPYTHON HAS NO `sleep_ms` (#1041, epic #209).
     *
     * This is the only dialect-specific block outside hardware — its sibling
     * `wait N seconds` writes `time.sleep(…)`, which is right on both.
     *
     * The issue offered three fixes. Generating the portable `time.sleep(0.5)`
     * everywhere was the smallest, and it costs the idiom: `sleep_ms` is what
     * every MicroPython tutorial uses, and the mirror is meant to show the code
     * a learner will meet elsewhere. A second block costs a second block, for a
     * difference that is a unit conversion. #1040's per-dialect template settled
     * it — the label still says milliseconds, and each board gets the call it
     * actually has.
     */
    circuitpython: {
      imports: [{ module: 'time' }],
      code: (block, gen) => `time.sleep(${seconds(gen.valueToCode(block, 'MS', Order.NONE))})\n`
    }
  },
  {
    type: 'snakie_wait_us',
    category: 'wait',
    help: 'ref-timing',
    json: {
      message0: 'wait %1 microseconds',
      args0: [{ type: 'input_value', name: 'US', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Pause for a number of microseconds — a millionth of a second each. For the very short pulses a datasheet asks for, like an ultrasonic sensor\u2019s 10 microsecond trigger.'
    },
    // 10, because the commonest microsecond wait in this whole app is the
    // HC-SR04 trigger pulse and it is exactly that long.
    toolbox: { inputs: { US: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
    imports: [{ module: 'time' }],
    code: (block, gen) => `time.sleep_us(${gen.valueToCode(block, 'US', Order.NONE) || '0'})\n`,
    /**
     * CIRCUITPYTHON HAS NO `sleep_us` EITHER (epic #209).
     *
     * Same shape as the milliseconds block above, and the same reasoning — with
     * one thing worth saying out loud: `time.sleep()` on CircuitPython does not
     * really deliver microsecond resolution, so the translated wait is a floor
     * rather than a promise. That is a property of the runtime, not of this
     * translation, and the alternative (refusing to generate) would leave a
     * learner holding a block that does nothing on their board.
     */
    circuitpython: {
      imports: [{ module: 'time' }],
      code: (block, gen) =>
        `time.sleep(${secondsFromMicros(gen.valueToCode(block, 'US', Order.NONE))})\n`
    }
  }
]

/** Milliseconds → the seconds `time.sleep()` wants. */
function seconds(ms: string): string {
  return divided(ms, 1000)
}

/** Microseconds → the seconds `time.sleep()` wants. As {@link seconds}. */
function secondsFromMicros(us: string): string {
  return divided(us, 1_000_000)
}

/**
 * `value / by`, worked out here when it can be and written out when it cannot.
 *
 * A LITERAL IS CONVERTED HERE, not by the board: `time.sleep(0.5)` is what a
 * CircuitPython tutorial writes and what a learner reading the mirror should
 * see, while `time.sleep(500 / 1000)` is arithmetic nobody would type. Anything
 * that is not a plain number — a variable, an expression — keeps the division,
 * because it is the only form that is still correct when the value changes.
 */
function divided(value: string, by: number): string {
  const text = (value || '0').trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return `${text} / ${by}`
  // `String(n)` rather than `toFixed`: 500 → `0.5`, not `0.500`, and 1 → `0.001`.
  return String(Number(text) / by)
}
