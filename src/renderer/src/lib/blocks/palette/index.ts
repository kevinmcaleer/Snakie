// Blockly's own block DEFINITIONS — the shapes, the mutators, the field
// bookkeeping. Importing this registers all of them into `Blockly.Blocks`;
// which of them a learner can actually reach is decided by the registry below,
// and the ones we don't register appear in no category and no flyout.
import 'blockly/blocks'
import { defineBlocks } from '../registry'
import { installBlockMessages } from './messages'
import { CONTROL_BLOCKS } from './control'
import { FUNCTION_BLOCKS } from './functions'
import { LIST_BLOCKS } from './lists'
import { LOGIC_BLOCKS } from './logic'
import { MATHS_BLOCKS } from './maths'
import { TEXT_BLOCKS } from './text'
import { VARIABLE_BLOCKS } from './variables'
import { WAIT_BLOCKS } from './wait'

/**
 * THE CORE PALETTE (#1011, epic #1007).
 * =============================================================================
 *
 * The Scratch-shaped fundamentals, generating MicroPython: control, wait, logic,
 * maths, text, lists, variables, functions.
 *
 * MOST OF THE BLOCKS ARE BLOCKLY'S. `controls_if` has the gear that adds an
 * `else if`; `procedures_defreturn` renames every caller when you rename it;
 * the variable field carries its own rename and delete flow. Rebuilding those
 * would be weeks spent on the half of this problem that is already solved. The
 * work here is the other half: what each one generates, what it SAYS, and which
 * of Blockly's eighty-odd blocks a ten-year-old should be shown at all.
 *
 * WHAT WAS TRIMMED, and why it matters as much as what was kept: trigonometry,
 * `atan2`, mathematical constants, prime tests, list sorting and splitting,
 * substring and case conversion, `text_prompt` (which asks for typed input on a
 * device with no keyboard), and the ternary `if` expression. Every one of them
 * is a real thing Python can do; none of them is a thing a beginner needs to
 * scroll past on their first day. A palette is a curriculum, and the blocks you
 * leave out are part of it.
 *
 * THREE BLOCKS NOBODY SHIPS, added because every hardware lesson needs them:
 * `forever` (the Scratch block, generating `while True:`), the two `wait`
 * blocks in a category of their own, and `map a number from one range to
 * another` — the one that turns a dial reading into a servo angle, without
 * which that lesson is a line of arithmetic the teacher types for them.
 *
 * Registration is a side effect of importing this module, before any canvas
 * exists, which is what lets the toolbox be built from the registry.
 */
export function installCorePalette(): void {
  installBlockMessages()
  defineBlocks([
    ...WAIT_BLOCKS,
    ...CONTROL_BLOCKS,
    ...LOGIC_BLOCKS,
    ...MATHS_BLOCKS,
    ...TEXT_BLOCKS,
    ...LIST_BLOCKS,
    ...VARIABLE_BLOCKS,
    ...FUNCTION_BLOCKS
  ])
}
