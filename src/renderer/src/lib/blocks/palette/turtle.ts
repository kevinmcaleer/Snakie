import { Order } from '../generator'
import type { BlockDefinition } from '../registry'
import { DEFAULT_PEN_COLOUR, FIELD_COLOUR_TYPE } from '../colour-field'
import { pyString } from '../py'

/**
 * TURTLE GRAPHICS (#1013, epic #1007).
 * =============================================================================
 *
 * The first hour. `micropython/turtle.py` and the Turtle instrument (#1003) are
 * the closest thing Snakie has to Scratch's stage — a sprite that moves when you
 * tell it to, drawing as it goes, **with nothing wired up**. Paired with blocks
 * that is a complete first lesson: on a Pico, or in the simulator, on a
 * Chromebook, in a classroom with no hardware budget at all.
 *
 * WHY `import turtle` AND `turtle.forward(100)`, and not `from turtle import
 * forward`. Both are the module-level functions the issue asks for rather than
 * the `Turtle` class, and the second is shorter. The qualified call wins on
 * three counts:
 *
 *  1. **It says where `forward` comes from.** A program that also has hardware
 *     blocks in it is a file where a bare `forward(100)` is one name among many;
 *     `turtle.forward(100)` is self-describing, which is the property that makes
 *     generated code worth reading.
 *  2. **The import section doesn't grow.** One `import turtle` covers eighteen
 *     functions. A from-import would add a name per block type used, so the head
 *     of the file would visibly lengthen as the drawing got more interesting —
 *     the thing #1010's import manager exists to prevent.
 *  3. **It cannot collide with the learner's own names.** `forward` and `left`
 *     are exactly the words a child names their own function or variable. The
 *     generator guards variables against imported MODULE names (`names.ts`), so
 *     one `turtle` is one word to protect instead of eighteen.
 *
 * ONE BLOCK PER LIBRARY FUNCTION, which is why `pen up` and `pen down` are two
 * blocks rather than one with a dropdown — and why `turn right` and `turn left`
 * are too. It is what Scratch does, so the muscle memory transfers; it means the
 * block face tells you what will happen without reading a dropdown; and it keeps
 * every emitter a one-liner with nothing to get wrong. (#1012's hardware blocks
 * DO use dropdowns, because there a pin block and its twelve neighbours were
 * competing for one flyout. Here the pairs are the point.)
 *
 * THE TURTLE'S CONVENTIONS ARE NOT CPYTHON'S, deliberately (see `turtle.py`):
 * heading `0` points UP and increases CLOCKWISE, so `right(90)` faces east —
 * like turning right in real life. The block text says "turn right", never
 * "clockwise", because that is the sentence a child already knows.
 */

/** A number socket. The default that fills it lives in the toolbox shadow below. */
const num = (name: string): Record<string, unknown> => ({
  type: 'input_value',
  name,
  check: 'Number'
})

/** The shadow that puts `value` in `name`'s socket in the flyout. */
const shadowNum = (name: string, value: number): Record<string, unknown> => ({
  [name]: { shadow: { type: 'math_number', fields: { NUM: value } } }
})

/** `import turtle` — every block here needs it and nothing else. */
const NEEDS_TURTLE = [{ module: 'turtle' }] as const

/**
 * The instrument every block here belongs to, by its `instruments-registry.ts` id.
 *
 * Dragging any one of them opens the Turtle instrument, because the drawing IS
 * the output: a `forward 100` whose line goes into a panel nobody opened is
 * indistinguishable from a block that did nothing at all, and "nothing happened"
 * is the impression that loses a beginner for good.
 */
const TURTLE_INSTRUMENT = 'turtle'

/** A block that calls one turtle function with no arguments. */
const call = (
  type: string,
  message0: string,
  fn: string,
  tooltip: string,
  help: string
): BlockDefinition => ({
  type,
  category: 'turtle',
  instrument: TURTLE_INSTRUMENT,
  help,
  json: {
    message0,
    previousStatement: null,
    nextStatement: null,
    tooltip
  },
  imports: NEEDS_TURTLE,
  code: () => `turtle.${fn}()\n`
})

/** A block that calls one turtle function with a single number socket. */
const callWithNumber = (
  type: string,
  message0: string,
  fn: string,
  arg: string,
  fallback: number,
  tooltip: string,
  help: string
): BlockDefinition => ({
  type,
  category: 'turtle',
  instrument: TURTLE_INSTRUMENT,
  help,
  json: {
    message0,
    args0: [num(arg)],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    tooltip
  },
  imports: NEEDS_TURTLE,
  toolbox: { inputs: shadowNum(arg, fallback) },
  code: (block, gen) =>
    `turtle.${fn}(${gen.valueToCode(block, arg, Order.NONE) || String(fallback)})\n`
})

/** A value block reading one turtle accessor. */
const sensor = (
  type: string,
  message0: string,
  fn: string,
  tooltip: string
): BlockDefinition => ({
  type,
  category: 'turtle',
  instrument: TURTLE_INSTRUMENT,
  help: 'inst-turtle',
  json: {
    message0,
    output: 'Number',
    tooltip
  },
  imports: NEEDS_TURTLE,
  // FUNCTION_CALL, not ATOMIC: `turtle.xcor()` is a call, so an exponent or a
  // unary minus around it needs no brackets but `(turtle.xcor())[0]` would.
  code: () => [`turtle.${fn}()`, Order.FUNCTION_CALL]
})

export const TURTLE_BLOCKS: BlockDefinition[] = [
  // -------------------------------------------------------------------- movement
  callWithNumber(
    'snakie_turtle_forward',
    'move forward %1',
    'forward',
    'STEPS',
    100,
    'Move the turtle forwards along the way it is facing, drawing if the pen is down.',
    'inst-turtle'
  ),
  callWithNumber(
    'snakie_turtle_backward',
    'move backward %1',
    'backward',
    'STEPS',
    100,
    'Move the turtle backwards without turning it round.',
    'inst-turtle'
  ),
  callWithNumber(
    'snakie_turtle_right',
    'turn right %1 degrees',
    'right',
    'ANGLE',
    90,
    'Turn the turtle clockwise, on the spot. 90 is a quarter turn.',
    'inst-turtle'
  ),
  callWithNumber(
    'snakie_turtle_left',
    'turn left %1 degrees',
    'left',
    'ANGLE',
    90,
    'Turn the turtle anticlockwise, on the spot. 90 is a quarter turn.',
    'inst-turtle'
  ),
  {
    type: 'snakie_turtle_goto',
    category: 'turtle',
    instrument: TURTLE_INSTRUMENT,
    help: 'inst-turtle',
    json: {
      message0: 'go to x %1 y %2',
      args0: [num('X'), num('Y')],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Jump straight to a point. (0, 0) is the middle of the screen; y counts upwards.'
    },
    imports: NEEDS_TURTLE,
    toolbox: { inputs: { ...shadowNum('X', 0), ...shadowNum('Y', 0) } },
    code: (block, gen) => {
      const x = gen.valueToCode(block, 'X', Order.NONE) || '0'
      const y = gen.valueToCode(block, 'Y', Order.NONE) || '0'
      return `turtle.goto(${x}, ${y})\n`
    }
  },
  callWithNumber(
    'snakie_turtle_setheading',
    'point in direction %1 degrees',
    'setheading',
    'ANGLE',
    0,
    'Face an absolute direction: 0 is up, 90 is right, 180 is down, 270 is left.',
    'inst-turtle'
  ),
  call(
    'snakie_turtle_home',
    'go home',
    'home',
    'Go back to the middle of the screen, facing up. The drawing stays.',
    'inst-turtle'
  ),

  // ------------------------------------------------------------------------- pen
  call(
    'snakie_turtle_penup',
    'pen up',
    'penup',
    'Lift the pen: the turtle moves without leaving a line.',
    'inst-turtle'
  ),
  call(
    'snakie_turtle_pendown',
    'pen down',
    'pendown',
    'Lower the pen: the turtle draws as it moves.',
    'inst-turtle'
  ),
  {
    type: 'snakie_turtle_pencolour',
    category: 'turtle',
    instrument: TURTLE_INSTRUMENT,
    help: 'inst-turtle',
    json: {
      message0: 'set pen colour to %1',
      args0: [{ type: FIELD_COLOUR_TYPE, name: 'COLOUR', colour: DEFAULT_PEN_COLOUR }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Choose the colour of the lines the turtle draws from now on.'
    },
    imports: NEEDS_TURTLE,
    // The colour is a NAME in the code (`'red'`, not `'#ff0000'`) — see
    // `colour-field.ts`. Through `pyString` rather than hand-quoting, so the
    // whole generated file quotes its strings one way.
    code: (block) =>
      `turtle.pencolor(${pyString(String(block.getFieldValue('COLOUR') ?? DEFAULT_PEN_COLOUR))})\n`
  },
  callWithNumber(
    'snakie_turtle_pensize',
    'set pen size to %1',
    'pensize',
    'WIDTH',
    2,
    'How thick the turtle draws, in pixels.',
    'inst-turtle'
  ),

  // ---------------------------------------------------------------------- screen
  call(
    'snakie_turtle_clear',
    'clear the drawing',
    'clear',
    'Wipe the lines but leave the turtle exactly where it is.',
    'inst-turtle'
  ),
  call(
    'snakie_turtle_reset',
    'start again',
    'reset',
    'Wipe the drawing AND send the turtle home — a clean screen.',
    'inst-turtle'
  ),
  callWithNumber(
    'snakie_turtle_speed',
    'set speed to %1',
    'speed',
    'SPEED',
    6,
    'How fast the Turtle instrument animates the drawing: 1 is slow, 10 is quick.',
    'inst-turtle'
  ),
  call(
    'snakie_turtle_hide',
    'hide the turtle',
    'hideturtle',
    'Hide the turtle sprite, leaving just the drawing.',
    'inst-turtle'
  ),
  call(
    'snakie_turtle_show',
    'show the turtle',
    'showturtle',
    'Show the turtle sprite again.',
    'inst-turtle'
  ),

  // --------------------------------------------------------------------- sensing
  sensor('snakie_turtle_x', 'x position', 'xcor', "The turtle's distance right of the middle."),
  sensor('snakie_turtle_y', 'y position', 'ycor', "The turtle's distance above the middle."),
  sensor(
    'snakie_turtle_heading',
    'direction',
    'heading',
    'Which way the turtle is facing, in degrees: 0 is up, 90 is right.'
  )
]
