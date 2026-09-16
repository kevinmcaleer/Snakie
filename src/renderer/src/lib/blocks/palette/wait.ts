import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * WAIT (#1011, epic #1007).
 * =============================================================================
 *
 * Two blocks, and a category to themselves.
 *
 * That looks disproportionate until you count how often a hardware lesson uses
 * them: every blink, every "press the button, now let go", every "turn the servo
 * and let it get there" is a wait. It is the first block a learner reaches for
 * after the one that does something, and burying it under Control asks them to
 * already know that waiting is a kind of control flow.
 *
 * TWO blocks rather than one with a unit dropdown, because `time.sleep(0.1)` and
 * `time.sleep_ms(100)` are different functions in MicroPython and the whole
 * point is that the generated code is the code they will later write. A dropdown
 * would hide exactly the thing we want them to notice.
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
  }
]

/**
 * Milliseconds → the seconds `time.sleep()` wants.
 *
 * A LITERAL IS CONVERTED HERE, not by the board: `time.sleep(0.5)` is what a
 * CircuitPython tutorial writes and what a learner reading the mirror should
 * see, while `time.sleep(500 / 1000)` is arithmetic nobody would type. Anything
 * that is not a plain number — a variable, an expression — keeps the division,
 * because it is the only form that is still correct when the value changes.
 */
function seconds(ms: string): string {
  const text = (ms || '0').trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return `${text} / 1000`
  // `String(n)` rather than `toFixed`: 500 → `0.5`, not `0.500`, and 1 → `0.001`.
  return String(Number(text) / 1000)
}
