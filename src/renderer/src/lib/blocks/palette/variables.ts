import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * VARIABLES (#1011, epic #1007).
 * =============================================================================
 *
 * Get, set, change by. Blockly's own blocks — the variable field carries the
 * dropdown, the rename and delete flow, and the bookkeeping that keeps every
 * block referring to a renamed variable up to date.
 *
 * THE RENAME PROMPT is the trap. Blockly's rename asks through
 * `Blockly.dialog.prompt`, whose default implementation is `window.prompt` —
 * which Electron's renderer does not implement, so it returns null and the
 * rename silently does nothing. The canvas routes that through the in-app
 * `usePrompt()` modal (#1009, `BlocksCanvas.tsx`), which is what makes these
 * blocks work at all here rather than only in a browser.
 *
 * NAMES are the generator's job: `my score` becomes `my_score`, `class` becomes
 * `class_`, and a variable named after an imported module loses to the module
 * (`names.ts`). A learner never sees an invalid identifier, and never sees the
 * `time` module vanish because they called something `time`.
 */
export const VARIABLE_BLOCKS: BlockDefinition[] = [
  {
    type: 'variables_get',
    category: 'variables',
    help: 'ref-types',
    code: (block, gen) => [gen.variableName(block.getFieldValue('VAR')), Order.ATOMIC]
  },
  {
    type: 'variables_set',
    category: 'variables',
    help: 'ref-types',
    toolbox: { inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      return `${name} = ${gen.valueToCode(block, 'VALUE', Order.NONE) || '0'}\n`
    }
  },
  {
    type: 'math_change',
    category: 'variables',
    help: 'ref-types',
    toolbox: { inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      // `+=` rather than `name = name + delta`: it is what a Python programmer
      // writes, it is shorter to read in the mirror, and it makes the "change
      // BY" on the block face and the code say the same thing.
      return `${name} += ${gen.valueToCode(block, 'DELTA', Order.ADDITIVE) || '0'}\n`
    }
  }
]
