import { Order } from '../generator'
import type { BlockDefinition } from '../registry'
import type * as Blockly from 'blockly/core'
import type { MicroPythonGenerator } from '../generator'

/**
 * CONTROL (#1011, epic #1007).
 * =============================================================================
 *
 * The shapes a learner already knows from Scratch — repeat, forever, if/else —
 * generating the Python they will later write by hand.
 *
 * MOSTLY BLOCKLY'S OWN BLOCKS. `controls_if` carries the mutator that adds
 * `else if` and `else` (the little gear), `controls_forEach` binds a variable
 * over a list, `controls_flow_statements` knows it may only sit inside a loop
 * and turns itself off when it doesn't. Rebuilding those to the same standard
 * would be weeks, and would be weeks spent on the half of this that is already
 * solved. The work here is the MicroPython half.
 *
 * ONE ADDITION: `forever`. Blockly's `controls_whileUntil` can express it
 * (`repeat while true`) but only by making a learner say something they do not
 * mean. `forever` is the Scratch block, it is what a beginner is looking for,
 * and it generates the `while True:` they will meet on their first day of text.
 */

/** A statement input's body, or `pass` — an empty loop is a syntax error. */
function body(block: Blockly.Block, name: string, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
}

export const CONTROL_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_forever',
    category: 'control',
    help: 'ref-flow',
    json: {
      message0: 'forever',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      // NO next connection. Nothing can run after a `while True:`, and a block
      // that let you attach something would be teaching a lie that only shows
      // up as code that never runs.
      tooltip: 'Repeat the blocks inside for ever. This is the main loop of most hardware programs.'
    },
    code: (block, gen) => `while True:\n${body(block, 'DO', gen)}`
  },
  {
    // Blockly's `controls_repeat_ext` — "repeat (n) times" with a socket, so the
    // count can be a variable rather than only a typed number.
    type: 'controls_repeat_ext',
    category: 'control',
    help: 'ref-flow',
    toolbox: { inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
    code: (block, gen) => {
      const times = gen.valueToCode(block, 'TIMES', Order.NONE) || '0'
      // `_` because the counter is deliberately unused — which is also the
      // idiom a learner will be shown the first time they ask why.
      return `for _ in range(${times}):\n${body(block, 'DO', gen)}`
    }
  },
  {
    type: 'controls_whileUntil',
    category: 'control',
    help: 'ref-flow',
    code: (block, gen) => {
      const until = block.getFieldValue('MODE') === 'UNTIL'
      // `until x` is `while not x`. No brackets around a comparison, because
      // `not` binds LOOSER than `<` in Python — `not 1 < 5` already means
      // `not (1 < 5)`. Blockly's own Python generator emits it the same way, and
      // redundant brackets in the mirror would be a small lie about how Python
      // reads.
      const cond = gen.valueToCode(block, 'BOOL', until ? Order.LOGICAL_NOT : Order.NONE) || 'False'
      return `while ${until ? `not ${cond}` : cond}:\n${body(block, 'DO', gen)}`
    }
  },
  {
    type: 'controls_if',
    category: 'control',
    help: 'ref-flow',
    code: (block, gen) => {
      let code = ''
      let n = 0
      // The mutator lets a learner add as many `else if` arms as they like, so
      // this counts rather than assuming one.
      do {
        const cond = gen.valueToCode(block, `IF${n}`, Order.NONE) || 'False'
        code += `${n === 0 ? 'if' : 'elif'} ${cond}:\n${body(block, `DO${n}`, gen)}`
        n++
      } while (block.getInput(`IF${n}`))
      if (block.getInput('ELSE')) code += `else:\n${body(block, 'ELSE', gen)}`
      return code
    }
  },
  {
    type: 'controls_for',
    category: 'control',
    help: 'ref-flow',
    toolbox: {
      inputs: {
        FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        TO: { shadow: { type: 'math_number', fields: { NUM: 10 } } },
        BY: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
      }
    },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      const from = gen.valueToCode(block, 'FROM', Order.NONE) || '0'
      const to = gen.valueToCode(block, 'TO', Order.NONE) || '0'
      const by = gen.valueToCode(block, 'BY', Order.NONE) || '1'
      // Blockly's block counts INCLUSIVELY ("from 1 to 10" visits 10) and
      // Python's `range` stops short, so the end needs a `+ 1`. Emitting it as
      // arithmetic rather than silently shifting a literal keeps the generated
      // line readable next to the block it came from — and `range(1, 10 + 1)`
      // is a better first meeting with the off-by-one than `range(1, 11)`.
      const end = /^-?\d+$/.test(to) ? String(Number(to) + 1) : `${to} + 1`
      const step = by === '1' ? '' : `, ${by}`
      return `for ${name} in range(${from}, ${end}${step}):\n${body(block, 'DO', gen)}`
    }
  },
  {
    type: 'controls_forEach',
    category: 'control',
    help: 'ref-flow',
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      const list = gen.valueToCode(block, 'LIST', Order.NONE) || '[]'
      return `for ${name} in ${list}:\n${body(block, 'DO', gen)}`
    }
  },
  {
    // `pass`, SAID DELIBERATELY (#1133, epic #1119).
    //
    // The generator already writes one for an EMPTY body, which is what makes
    // an unfinished `if` valid Python. This block is the other thing: saying
    // "nothing happens here" on purpose — sketching a structure before filling
    // it in, or an `except` that is meant to swallow the error.
    //
    // IT DOES NOT FIGHT THE IMPLICIT ONE. A body holding this block is not
    // empty, so the generator writes the learner's `pass` and not its own; an
    // empty body still gets the generator's. One `pass` either way.
    type: 'snakie_pass',
    category: 'control',
    help: 'ref-flow',
    json: {
      message0: 'do nothing',
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Deliberately nothing. Useful for sketching out the shape of a program before you fill it in, or for an "if that goes wrong" that is meant to carry on quietly. Python writes it `pass`.'
    },
    code: () => 'pass\n'
  },
  {
    type: 'controls_flow_statements',
    category: 'control',
    help: 'ref-flow',
    code: (block) => (block.getFieldValue('FLOW') === 'BREAK' ? 'break\n' : 'continue\n')
  }
]
