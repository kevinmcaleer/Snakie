// Blockly's own block DEFINITIONS — the shapes, the mutators, the field
// bookkeeping. Importing this registers all of them into `Blockly.Blocks`;
// which of them a learner can actually reach is decided by the registry below,
// and the ones we don't register appear in no category and no flyout.
import 'blockly/blocks'
import { defineBlocks, scoped, scopedByEmitters } from '../registry'
import { installBlockMessages } from './messages'
import { installPinField } from '../pin-field'
import { installColourField } from '../colour-field'
import { installPythonField } from '../python-field'
import { CONTROL_BLOCKS } from './control'
import { HARDWARE_BLOCKS } from './hardware'
import { instrumentBlocks } from './instruments'
import { FUNCTION_BLOCKS, installFunctionBlocks } from './functions'
import { STRUCTURE_BLOCKS, installStructureBlocks } from './structure'
import { LIST_BLOCKS } from './lists'
import { TUPLE_BLOCKS, installTupleBlocks } from './tuples'
import { DICT_BLOCKS, installDictBlocks } from './dicts'
import { SLICE_BLOCKS } from './slices'
import { BUFFER_BLOCKS } from './buffers'
import { FILE_BLOCKS } from './files'
import { LOGIC_BLOCKS } from './logic'
import { MATHS_BLOCKS } from './maths'
import { TEXT_BLOCKS, installTextBlocks } from './text'
import { TURTLE_BLOCKS } from './turtle'
import { PYTHON_BLOCKS, installPythonBlocks } from './python'
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
  // The pin dropdowns and the pen-colour swatch are custom field types, and a
  // JSON definition naming a field type Blockly has never heard of throws while
  // the block is built — so both have to be registered before the definitions
  // below are installed.
  installPinField()
  installColourField()
  installPythonField()
  // The two `call` blocks have inputs that come and go, so their shapes are
  // built in code rather than declared as JSON — and, like Blockly's own
  // `controls_if`, they must exist in `Blockly.Blocks` before anything tries to
  // build one.
  installPythonBlocks()
  // And the `try` block, whose arms come and go for the same reason.
  installStructureBlocks()
  // And the literals that grow a socket at a time (#1119): a tuple, a
  // dictionary, a buffer, a `print` with several things in it.
  installTupleBlocks()
  installDictBlocks()
  // `print`, which grew from one socket to as many as you like (#1125) and so
  // is no longer Blockly's own shape.
  installTextBlocks()
  // And Blockly's two `def` blocks, which gain a field for the parameters its
  // mutator cannot hold — a default, `*args`, `**kwargs` (#1134).
  installFunctionBlocks()
  defineBlocks([
    ...TURTLE_BLOCKS,
    // HARDWARE IS SCOPED BY WHAT IT CAN GENERATE (#1039 → #1040). Nine of the
    // twelve now have a CircuitPython template as well, so their scope is
    // `both`; servo and buzzer do not, because CircuitPython has no core
    // equivalent — they want `adafruit_motor` and `simpleio`, which are
    // third-party libraries and not the same promise. Derived rather than
    // written down twice, so a block cannot be hidden from a board it works on.
    //
    // Scope HIDES, it never deregisters: a hardware program written on a Pico
    // still opens, still edits and still saves when a Feather is plugged in.
    ...scopedByEmitters(HARDWARE_BLOCKS),
    // `bytes` and `bytearray` (#1135, epic #1119), in a Buffers drawer inside
    // Hardware — next to the I²C and SPI blocks that ask for one. NOT through
    // `scopedByEmitters`, unlike everything above: these four are plain Python,
    // core and identical in both runtimes, so they stay unscoped like the rest
    // of the plain-Python palette. See the file header.
    ...BUFFER_BLOCKS,
    // INSTRUMENTS STAY MICROPYTHON (#1040). `instruments.py` is telemetry over
    // `print()`, which CircuitPython runs happily — but the sensor reads
    // underneath it are `machine`-based, and #1038 made those DEGRADE rather
    // than work. A block that draws an empty oscilloscope is worse than a block
    // the board never offered.
    //
    // Derived from `instruments-registry.ts` rather than listed (#1014): an
    // instrument that declares a block gets one, with no edit here.
    ...scoped('micropython', instrumentBlocks()),
    ...WAIT_BLOCKS,
    ...CONTROL_BLOCKS,
    // Files, and the `use … as` that closes them (#1132, epic #1119). A shelf
    // inside Control rather than a category of its own — see the file header
    // for why the palette has no sixteenth colour to give.
    ...FILE_BLOCKS,
    ...LOGIC_BLOCKS,
    ...MATHS_BLOCKS,
    ...TEXT_BLOCKS,
    ...LIST_BLOCKS,
    // Tuples, unpacking and the multi-value loops (#1121, epic #1119). They
    // spread across three drawers rather than gathering in one, because each
    // belongs where a learner is standing when they want it: the literal in
    // Lists, `set … and … to` in Variables, the loops in Control.
    ...TUPLE_BLOCKS,
    // Slicing (#1123, epic #1119) — one set of blocks for lists, strings and
    // buffers, with no `Array` check on any socket. See the file header.
    ...SLICE_BLOCKS,
    // The Dictionaries drawer (#1120, epic #1119) — the biggest hole the audit
    // found, and the only one that was a whole missing CATEGORY.
    ...DICT_BLOCKS,
    ...VARIABLE_BLOCKS,
    ...FUNCTION_BLOCKS,
    // Class, method and `self` (#1093). Registered, never listed — a class is
    // the reader's vocabulary rather than a first drawer's; see §4.5.
    ...STRUCTURE_BLOCKS,
    // Last, and last in the toolbox: the escape hatches (#1018) are where you
    // go when nothing above does what you need, and a palette is a curriculum.
    ...PYTHON_BLOCKS
  ])
}
