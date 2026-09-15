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
    code: (block, gen) => `time.sleep_ms(${gen.valueToCode(block, 'MS', Order.NONE) || '0'})\n`
  }
]
