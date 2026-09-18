import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * WAIT (#1011, epic #1007).
 * =============================================================================
 *
 * Three waits and two clock readings, in a category of their own.
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
 *
 * AND READING THE CLOCK BELONGS HERE TOO, because the other half of timing a
 * pulse is measuring one. `ticks_ms` and `ticks_us` are the counters; `ticks
 * between` is how you subtract two readings of either.
 *
 * BOTH COUNTERS, for the same reason there are three waits: they are two
 * different MicroPython functions and a unit dropdown would hide the one thing
 * we want a learner to notice. `ticks_ms` is the one nearly every program
 * actually uses — "has half a second gone by yet" is the shape of every
 * non-blocking loop, every debounce and every timeout — and `ticks_us` is for
 * the pulse widths a datasheet quotes. Milliseconds first, as the waits are.
 *
 * THEY SHIP WITH `ticks between` ON PURPOSE. MicroPython's tick counters WRAP —
 * they count up to an unspecified limit and start again — so `end - start` is
 * right almost always and catastrophically wrong on the wrap, which is a bug
 * that appears once an hour on a Pico and never in a lesson. `ticks_diff` exists
 * to do that subtraction correctly and is the only supported way to do it. A
 * counter block on its own would be a block whose obvious use is a bug, so the
 * drawer offers them together — and one `ticks between` serves both counters,
 * because `ticks_diff` does not care which of them produced its arguments.
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
  },

  // ------------------------------------------------------------------- ticks
  {
    type: 'snakie_ticks_ms',
    category: 'wait',
    help: 'ref-timing',
    json: {
      message0: 'millisecond ticks',
      output: 'Number',
      tooltip:
        'A counter that ticks up every millisecond. Read it before and after something to find out how long it took, or compare it against an earlier reading to do something every so often without stopping the program \u2014 with the \u201cticks from \u2026 to \u2026\u201d block, which handles the counter running out and starting again.'
    },
    imports: [{ module: 'time' }],
    code: () => ['time.ticks_ms()', Order.FUNCTION_CALL],
    /**
     * CIRCUITPYTHON HAS NO `ticks_ms` (epic #209), as it has no `ticks_us`.
     *
     * Same substitution as the microsecond counter below and for the same
     * reason — `time.monotonic()` is a float in seconds that loses resolution
     * the longer the board stays up, which is the wrong property for timing
     * anything — floor-divided to milliseconds so the block hands back the unit
     * its label promises on either board.
     */
    circuitpython: {
      imports: [{ module: 'time' }],
      code: () => ['time.monotonic_ns() // 1000000', Order.MULTIPLICATIVE]
    }
  },
  {
    type: 'snakie_ticks_us',
    category: 'wait',
    help: 'ref-timing',
    json: {
      message0: 'microsecond ticks',
      output: 'Number',
      tooltip:
        'A counter that ticks up every microsecond. Read it before and after something to find out how long it took \u2014 with the “ticks from … to …” block, which handles the counter running out and starting again.'
    },
    imports: [{ module: 'time' }],
    code: () => ['time.ticks_us()', Order.FUNCTION_CALL],
    /**
     * CIRCUITPYTHON COUNTS IN NANOSECONDS AND DOES NOT WRAP (epic #209).
     *
     * `time.monotonic_ns()` is the integer counter there — `time.monotonic()` is
     * a float in seconds and loses resolution as the board stays up, which is
     * exactly the wrong property for timing a pulse. Floor-divided to
     * microseconds so both dialects hand back the same unit, and so the block
     * plugs into the same arithmetic on either board.
     */
    circuitpython: {
      imports: [{ module: 'time' }],
      code: () => ['time.monotonic_ns() // 1000', Order.MULTIPLICATIVE]
    }
  },
  {
    type: 'snakie_ticks_diff',
    category: 'wait',
    help: 'ref-timing',
    json: {
      // `from` then `to`, the order a learner thinks in, even though
      // `ticks_diff` takes the later reading FIRST. Putting the sockets in
      // datasheet order and swapping them in the emitter is the whole reason
      // this is a block rather than a note telling people to be careful.
      message0: 'ticks from %1 to %2',
      args0: [
        { type: 'input_value', name: 'FROM', check: 'Number' },
        { type: 'input_value', name: 'TO', check: 'Number' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'How many ticks passed between two readings of the clock. Use this rather than subtracting them yourself: the counter runs out and starts again, and this is the only way that keeps working when it does.'
    },
    imports: [{ module: 'time' }],
    code: (block, gen) => [
      `time.ticks_diff(${gen.valueToCode(block, 'TO', Order.NONE) || '0'}, ${
        gen.valueToCode(block, 'FROM', Order.NONE) || '0'
      })`,
      Order.FUNCTION_CALL
    ],
    /**
     * NOTHING TO CORRECT FOR ON CIRCUITPYTHON. `monotonic_ns` does not wrap, so
     * the subtraction `ticks_diff` exists to protect is simply right there — and
     * writing it out is what a CircuitPython tutorial does.
     */
    circuitpython: {
      imports: [],
      code: (block, gen) => [
        `${gen.valueToCode(block, 'TO', Order.ADDITIVE) || '0'} - ${
          gen.valueToCode(block, 'FROM', Order.ADDITIVE) || '0'
        }`,
        Order.ADDITIVE
      ]
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
