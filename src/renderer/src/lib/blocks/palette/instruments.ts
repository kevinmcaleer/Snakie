import type * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { toPythonIdentifier } from '../names'
import { pyString } from '../py'
import { adc, i2c, pinField, pinOf, pwm } from './hardware'
import { registerCallRules, type CallRule } from '../python-to-blocks'
import type { SocketType } from '../registry'
import {
  INSTRUMENTS,
  type InstrumentBlockArg,
  type InstrumentBlockDef,
  type InstrumentDef
} from '../../../components/instruments-registry'

/**
 * INSTRUMENTS IN BLOCK MODE (#1014, epic #1007).
 * =============================================================================
 *
 * MOST OF THIS ALREADY WORKED, and that is the headline. Instruments are
 * surfaced by scanning the ACTIVE FILE'S SOURCE — `parse-pins.ts` for the
 * peripheral constructors, and each `InstrumentDef`'s `uses`/`hints` for driver
 * and import signals. Blocks generate source, so the dock already lit up the
 * right instruments in block mode with no new machinery. That is the entire
 * argument for generating real MicroPython instead of interpreting a block tree,
 * cashed in.
 *
 * What did NOT come free is the blocks themselves — and the answer to that is
 * not a hand-written palette. THE PALETTE IS DERIVED FROM THE REGISTRY. An
 * `InstrumentDef` declares its blocks beside the `uses`/`hints` it already had,
 * and this module turns each declaration into a Blockly definition, a
 * MicroPython emitter, a toolbox slot, a help link and the drag-reveal — so a
 * new instrument gets a block without anyone opening this file. The registry was
 * already the single source of truth for the dock, the palette and the
 * placeholder windows; now it is the source of truth for the blocks too.
 *
 * THREE BLOCKS ARE HAND-WRITTEN, at the bottom, and it is worth saying why: they
 * take a HARDWARE OBJECT rather than a number. `read_adc(adc)` wants a
 * `machine.ADC`, `read_pwm(pwm)` a `machine.PWM`, `i2c_scan(i2c)` a bus — so
 * each needs a pin dropdown and a hoisted constructor, which is #1012's
 * machinery and not something a declarative descriptor should learn to express.
 * A descriptor that could describe those could describe anything, which is the
 * point at which it stops being a description.
 *
 * EVERY EMITTER IS ONE CHEAP `print()` and safe in a tight loop. The scanners
 * are not, they say so on the block, and that distinction is `slow` in the
 * descriptor rather than a comment somebody has to remember to write.
 */

/**
 * `import instruments as inst`.
 *
 * Aliased because every example in `examples/`, and every line of
 * `docs/instruments-library.md`, is written `inst.scope(v)`. The generated code
 * is meant to be the code we teach: a learner who graduates to text (#1016) and
 * opens the docs should find the same three letters in front of every call. It
 * also keeps a sensor loop readable — `instruments.scope(v)` four times in five
 * lines is a wall.
 */
const NEEDS_INST = [{ module: 'instruments', alias: 'inst' }] as const

/** The alias, for the generated calls. */
const INST = 'inst'

/**
 * Every block the registry declares, in registry order.
 *
 * Order matters: the flyout reads top to bottom in the same order the dock's
 * toggle rows do, so the block for the instrument you are looking at is where
 * you expect it.
 */
export function derivedInstrumentBlocks(): BlockDefinition[] {
  const out: BlockDefinition[] = []
  for (const instrument of INSTRUMENTS) {
    for (const block of instrument.blocks ?? []) out.push(toBlockDefinition(instrument, block))
  }
  return out
}

/** One descriptor → one registered block. */
function toBlockDefinition(instrument: InstrumentDef, def: InstrumentBlockDef): BlockDefinition {
  const statement = true
  return {
    type: def.type,
    category: 'instruments',
    // The help article id is the instrument id, which is not a coincidence worth
    // hiding: `inst-scope.md` documents the Oscilloscope, and the block that
    // feeds it should open exactly that page.
    help: `inst-${instrument.id}`,
    // Dragging one out reveals its instrument (#1013's field). The readout is
    // then on screen BEFORE the program runs, which is the difference between a
    // learner seeing their sensor work and seeing nothing happen.
    instrument: instrument.id,
    json: {
      message0: def.label,
      ...(def.args.length > 0 ? { args0: def.args.map(fieldFor) } : {}),
      inputsInline: true,
      ...(statement ? { previousStatement: null, nextStatement: null } : {}),
      tooltip: def.slow
        ? `${def.tooltip} This one pauses for a moment — don't put it in a fast loop.`
        : def.tooltip
    },
    imports: NEEDS_INST,
    ...(shadowsFor(def) ? { toolbox: { inputs: shadowsFor(def) } } : {}),
    code: (block, gen) => `${INST}.${def.fn}(${callArgs(def, block, gen)})\n`
  }
}

/** One argument's Blockly field/input JSON. */
function fieldFor(arg: InstrumentBlockArg): Record<string, unknown> {
  if (arg.kind === 'field' || arg.kind === 'keyword') {
    return { type: 'field_input', name: arg.name, text: String(arg.default) }
  }
  return {
    type: 'input_value',
    name: arg.name,
    ...(arg.kind === 'number' ? { check: 'Number' } : {}),
    ...(arg.kind === 'boolean' ? { check: 'Boolean' } : {}),
    // A wrapped socket is checked as a String so a list block cannot be plugged
    // in and come out doubly wrapped — see `list` in the registry.
    ...(arg.list ? { check: 'String' } : {})
  }
}

/** The shadow blocks that fill a dragged block's sockets, or undefined. */
function shadowsFor(def: InstrumentBlockDef): Record<string, unknown> | undefined {
  const inputs: Record<string, unknown> = {}
  for (const arg of def.args) {
    if (arg.kind === 'number') {
      inputs[arg.name] = { shadow: { type: 'math_number', fields: { NUM: Number(arg.default) } } }
    } else if (arg.kind === 'boolean') {
      inputs[arg.name] = {
        shadow: { type: 'logic_boolean', fields: { BOOL: String(arg.default).toUpperCase() } }
      }
    } else if (arg.kind === 'text') {
      inputs[arg.name] = { shadow: { type: 'text', fields: { TEXT: String(arg.default) } } }
    }
  }
  return Object.keys(inputs).length > 0 ? inputs : undefined
}

/**
 * The call's arguments, as Python.
 *
 * A KEYWORD ARGUMENT IS ONLY EMITTED WHEN IT DIFFERS from the library's own
 * default, which is what keeps the common call short: a learner who never
 * touches the channel gets `inst.scope(value)`, and one who does gets
 * `inst.scope(value, ch="ch2")` — the shape they would have written either way.
 */
function callArgs(
  def: InstrumentBlockDef,
  block: Blockly.Block,
  gen: MicroPythonGenerator
): string {
  const parts: string[] = []
  // A `keyword` arg names the argument AFTER it: `plot(temp=21.4)`, where the
  // learner types `temp` on the block face. Carried forward rather than looked
  // up, so the descriptor stays a flat list in call order.
  let pendingKeyword: string | null = null
  for (const arg of def.args) {
    if (arg.kind === 'keyword') {
      // Through the identifier sanitiser: a series called `my reading` has to
      // become `my_reading=` or the line is a SyntaxError, and a child naming a
      // series after a space is not making a mistake.
      pendingKeyword = toPythonIdentifier(String(block.getFieldValue(arg.name) ?? arg.default))
      continue
    }
    const value = valueOf(arg, block, gen)
    if (pendingKeyword) {
      parts.push(`${pendingKeyword}=${value}`)
      pendingKeyword = null
    } else if (arg.keyword) {
      if (value !== literal(arg.default)) parts.push(`${arg.keyword}=${value}`)
    } else {
      parts.push(value)
    }
  }
  return parts.join(', ')
}

/** One argument's value, as Python. */
function valueOf(
  arg: InstrumentBlockArg,
  block: Blockly.Block,
  gen: MicroPythonGenerator
): string {
  if (arg.kind === 'field') {
    return pyString(String(block.getFieldValue(arg.name) ?? arg.default))
  }
  const value = gen.valueToCode(block, arg.name, Order.NONE) || literal(arg.default)
  return arg.list ? `[${value}]` : value
}

/** A descriptor default, as the Python literal an untouched socket would give. */
function literal(value: string | number): string {
  if (typeof value === 'number') return String(value)
  if (value === 'True' || value === 'False') return value
  return pyString(value)
}

/**
 * The three blocks a descriptor cannot describe: they take a hardware object.
 *
 * `read_adc` and `read_pwm` are VALUE blocks, as the issue asks, because they
 * return the reading as well as emitting it — so `set temperature to (read
 * voltage on GP26)` reads like a sentence and the program can use the number it
 * just put on the dial.
 */
const HARDWARE_INSTRUMENT_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_inst_read_adc',
    category: 'instruments',
    help: 'inst-meter',
    instrument: 'meter',
    pin: { field: 'PIN', role: 'analogue read', needs: 'adc' },
    json: {
      message0: 'read volts on %1 and show on the multimeter',
      args0: [pinField('PIN', 'adc', 26)],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Measure an analogue pin, send the reading to the Multimeter, and use the volts here too.'
    },
    imports: [
      { module: 'machine', name: 'ADC' },
      { module: 'machine', name: 'Pin' },
      ...NEEDS_INST
    ],
    code: (block, gen) => {
      const name = adc(gen, pinOf(block), block)
      // `ch` defaults to `adc0`; naming it after the pin means two meters on two
      // pins are two channels rather than one channel fighting itself.
      return [`${INST}.read_adc(${name}, ch=${pyString(`adc${pinOf(block)}`)})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_inst_read_pwm',
    category: 'instruments',
    help: 'inst-scope',
    instrument: 'scope',
    pin: { field: 'PIN', role: 'PWM read', needs: 'pwm' },
    json: {
      message0: 'read the PWM on %1 and show on the oscilloscope',
      args0: [pinField('PIN', 'pwm', 15)],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Send a pin’s PWM frequency and duty to the Oscilloscope, and use the duty (0 to 1) here.'
    },
    imports: [{ module: 'machine', name: 'PWM' }, { module: 'machine', name: 'Pin' }, ...NEEDS_INST],
    code: (block, gen) => {
      const name = pwm(gen, pinOf(block), block)
      return [`${INST}.read_pwm(${name}, ch=${pyString(`pwm${pinOf(block)}`)})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_inst_i2c_scan',
    category: 'instruments',
    help: 'inst-i2c-detect',
    instrument: 'i2c-detect',
    json: {
      message0: 'scan the I²C bus on SDA %1 SCL %2',
      args0: [pinField('SDA', 'i2c', 4), pinField('SCL', 'i2c', 5)],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        "List everything plugged into the I²C wires. This one pauses for a moment — don't put it in a fast loop."
    },
    imports: [{ module: 'machine', name: 'I2C' }, { module: 'machine', name: 'Pin' }, ...NEEDS_INST],
    code: (block, gen) => `${INST}.i2c_scan(${i2c(gen, block)})\n`
  },
  {
    type: 'snakie_inst_gamepad_axis',
    category: 'instruments',
    help: 'inst-gamepad',
    instrument: 'gamepad',
    json: {
      message0: 'gamepad %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'AXIS',
          options: [
            ['left/right', 'x'],
            ['up/down', 'y'],
            ['turn', 'r'],
            ['throttle', 't']
          ]
        }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'How far the on-screen gamepad stick is pushed, from -1 to 1. Needs "let Snakie drive this board".'
    },
    imports: NEEDS_INST,
    code: (block) => {
      // `teleop()` hands back `(axes, payload)`; the axes dict is the half a
      // block wants. `.get(name, 0)` rather than `[name]`, because an axis the
      // gamepad has not sent yet must read as centred, not raise KeyError in the
      // middle of a robot's drive loop.
      const axis = pyString(String(block.getFieldValue('AXIS') ?? 'x'))
      return [`${INST}.teleop()[0].get(${axis}, 0)`, Order.FUNCTION_CALL]
    }
  }
]

/** Everything the Instruments category holds. */
export function instrumentBlocks(): BlockDefinition[] {
  return [...derivedInstrumentBlocks(), ...HARDWARE_INSTRUMENT_BLOCKS]
}

/**
 * How an instrument block reads BACK out of Python (W2, #1089, epic #1086).
 *
 * Derived from the same descriptor the block and its emitter come from, so an
 * instrument that changes its call changes both sides at once — which is the
 * property this whole module was built for.
 *
 * ONLY THE PLAIN ONES, and the exclusions are not laziness. A descriptor arg may
 * be a FIELD (a channel name typed on the block face), a KEYWORD (the learner's
 * own series name, which becomes the Python keyword of the argument after it),
 * or a LIST-WRAPPED socket (`screen(["Hello"])`). Each of those is a place where
 * the text in the file and the sockets on the block are not one-to-one, and a
 * rule that guessed would put a learner's series name in the wrong half of
 * `plot(temp=21.4)`. A keyword argument only appears at all when it DIFFERS from
 * the library default, so its absence is not even evidence of its value.
 *
 * The four hand-written hardware blocks are excluded for a different reason:
 * their calls take an object the generator hoisted (`inst.read_adc(adc26, …)`),
 * which is `CallReceiver`'s shape and belongs to #1012's machinery, not here.
 */
export function registerInstrumentReadRules(): void {
  const rules: CallRule[] = []
  for (const instrument of INSTRUMENTS) {
    for (const def of instrument.blocks ?? []) {
      const plain = def.args.every(
        (arg) => !arg.keyword && !arg.list && (arg.kind === 'number' || arg.kind === 'boolean' || arg.kind === 'text')
      )
      if (!plain) continue
      rules.push({
        module: INST,
        fn: def.fn,
        type: def.type,
        args: def.args.map((arg) => arg.name),
        shape: 'statement',
        checks: Object.fromEntries(
          def.args.flatMap((arg): [string, SocketType][] =>
            arg.kind === 'number'
              ? [[arg.name, 'Number']]
              : arg.kind === 'boolean'
                ? [[arg.name, 'Boolean']]
                : []
          )
        )
      })
    }
  }
  registerCallRules(rules)
}

registerInstrumentReadRules()
