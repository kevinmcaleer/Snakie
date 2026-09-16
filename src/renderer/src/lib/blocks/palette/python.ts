import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { FIELD_PYTHON_TYPE } from '../python-field'
import { isAtomicExpression } from '../python-check'

/**
 * THE ESCAPE HATCHES (#1018, epic #1007).
 * =============================================================================
 *
 * Layer 3 of the epic's answer to *"what about imports Blockly has never seen?"*
 * — **and the layer that can never fail.** #1017 makes the palette grow with the
 * parts library and the plugin ecosystem; these blocks remove the ceiling
 * entirely. Any MicroPython module on earth, driven from a block workspace,
 * today, with no manifest and no waiting for us. An unknown library stops being
 * a wall and becomes a slightly uglier block — and the code it generates is
 * still correct Python.
 *
 * THEY ARE ALSO A TEACHING DEVICE, and that is not a consolation prize. These
 * are the grey blocks that LOOK like code: mono-spaced text, syntax-highlighted
 * the moment you click into one, in the same colours as the mirror next door.
 * Reaching for one is the first taste of text, and it happens on the learner's
 * own initiative rather than at the end of a chapter.
 *
 * ONE LINE PER BLOCK, which is the decision everything else here follows from.
 * The obvious design is a textarea holding a snippet; a stack of one-line blocks
 * is better in four ways, and each of them is something a learner feels:
 *
 *  - **#1016's link works.** Every block owns exactly one line of the Python, so
 *    hovering it lights up that line and clicking that line selects it.
 *  - **#1015's tracebacks land.** An error on line 12 has one block to badge,
 *    not a five-line block with the badge somewhere inside it.
 *  - **It composes.** Indented code goes INSIDE a Control block, which is what
 *    the Control blocks are for and what Python's own structure looks like.
 *  - **Blockly 13 has no multiline field**, so the alternative is vendoring one.
 *
 * A multi-line PASTE is not lost: the field turns it into a stack of blocks, one
 * per line, which is the shape the learner wanted anyway (see `python-field.ts`).
 *
 * CHECKED, NOT TRUSTED. `python-check.ts` reads every one of these before Run
 * and the canvas badges the block. An unclosed bracket is a sentence on the
 * block, not a `SyntaxError` from a board naming a line in a file nobody wrote.
 */

/** The block types this module owns, for the canvas's syntax-check pass. */
export const PYTHON_STATEMENT = 'snakie_python_statement'
export const PYTHON_VALUE = 'snakie_python_value'
export const PYTHON_CALL = 'snakie_python_call'
export const PYTHON_CALL_VALUE = 'snakie_python_call_value'

/** The raw text a block's Python field holds, trimmed of nothing but the edges. */
export const rawPython = (block: Blockly.Block, field = 'CODE'): string =>
  String(block.getFieldValue(field) ?? '').trim()

/** `field_snakie_python`, with a placeholder that says what to type. */
const pythonField = (
  name: string,
  placeholder: string,
  /** The block type extra lines of a multi-line paste become; absent ⇒ join. */
  splitInto?: string
): Record<string, unknown> => ({
  type: FIELD_PYTHON_TYPE,
  name,
  text: '',
  placeholder,
  ...(splitInto ? { splitInto } : {})
})

// ---------------------------------------------------------------------------
// The call block's growable argument list
// ---------------------------------------------------------------------------

/** How many argument sockets a fresh call block has. */
const DEFAULT_ARGS = 1
/** And the most it will grow to — past this the learner wants a variable. */
const MAX_ARGS = 8

/** A `+` / `−` button, as an inline SVG data URI (the CSP allows `data:`). */
function stepperIcon(sign: '+' | '−'): string {
  const glyph =
    sign === '+'
      ? '<path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.22)"/>${glyph}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * The `call` blocks' shared behaviour: a method name, an object socket, and a
 * row of argument sockets that GROWS WITH A BUTTON.
 *
 * A pair of `+` / `−` buttons rather than Blockly's gear mutator, which is the
 * conventional answer and the wrong one here. The gear opens a second, miniature
 * workspace in a bubble and asks the learner to drag rows into a container — a
 * mechanism with nothing else like it in the app, discovered by accident if at
 * all. Two buttons on the block are visible, obvious, and need no explanation.
 *
 * The count is serialised through `saveExtraState`/`loadExtraState`, so a saved
 * file re-opens with the sockets it had. Blockly 13's JSON serialisation is the
 * only mechanism here; there is no XML mutator to keep in step with it.
 */
function callBlockMixin(valueShape: boolean): Record<string, unknown> {
  return {
    // ZERO, not the default: `init` calls `updateArgs_(DEFAULT_ARGS)` and that
    // only adds the sockets it can see are missing. Starting at the target
    // would make it a no-op and build a block with no argument socket at all.
    argCount_: 0,

    init(this: Blockly.Block): void {
      this.setStyle('python_blocks')
      const head = this.appendDummyInput('HEAD')
      if (valueShape) {
        head
          .appendField(new Blockly.FieldTextInput('read'), 'METHOD')
          .appendField('of')
      } else {
        head
          .appendField('call')
          .appendField(new Blockly.FieldTextInput('update'), 'METHOD')
          .appendField('on')
      }
      this.appendValueInput('OBJ').setCheck(null)
      this.setInputsInline(true)
      if (valueShape) this.setOutput(true, null)
      else {
        this.setPreviousStatement(true, null)
        this.setNextStatement(true, null)
      }
      this.setTooltip(
        valueShape
          ? 'Call a method on any object and use what it gives back. For a driver Snakie has never heard of.'
          : 'Call a method on any object. For a driver Snakie has never heard of — type the name from its documentation.'
      )
      ;(this as unknown as { updateArgs_: (n: number) => void }).updateArgs_(DEFAULT_ARGS)
    },

    /** Blockly 13's JSON serialisation — the only state this block carries. */
    saveExtraState(this: Blockly.Block): { args: number } {
      return { args: (this as unknown as { argCount_: number }).argCount_ }
    },

    loadExtraState(this: Blockly.Block, state: { args?: number }): void {
      const n = Math.max(0, Math.min(MAX_ARGS, Number(state?.args ?? DEFAULT_ARGS)))
      ;(this as unknown as { updateArgs_: (n: number) => void }).updateArgs_(n)
    },

    /** Add or remove argument sockets so there are exactly `n`, and re-label. */
    updateArgs_(this: Blockly.Block, n: number): void {
      const self = this as unknown as { argCount_: number }
      const target = Math.max(0, Math.min(MAX_ARGS, n))
      for (let i = self.argCount_ ?? 0; i > target; i--) this.removeInput(`ARG${i - 1}`, true)
      for (let i = self.argCount_ ?? 0; i < target; i++) {
        this.appendValueInput(`ARG${i}`)
          .setCheck(null)
          // "with" once, then commas — so the block reads like the call it makes.
          .appendField(i === 0 ? 'with' : ',')
      }
      self.argCount_ = target
      // The buttons live on their own input at the end, so they stay to the
      // right of whatever the argument row currently is.
      if (this.getInput('STEP')) this.removeInput('STEP')
      this.appendDummyInput('STEP')
        .appendField(
          new Blockly.FieldImage(stepperIcon('+'), 16, 16, 'add an argument', () =>
            (this as unknown as { updateArgs_: (n: number) => void }).updateArgs_(target + 1)
          ),
          'ADD'
        )
        .appendField(
          new Blockly.FieldImage(stepperIcon('−'), 16, 16, 'remove an argument', () =>
            (this as unknown as { updateArgs_: (n: number) => void }).updateArgs_(target - 1)
          ),
          'REMOVE'
        )
    }
  }
}

/** The arguments a call block's sockets hold, empty ones dropped. */
function callArgs(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const count = (block as unknown as { argCount_?: number }).argCount_ ?? 0
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    // An EMPTY socket contributes nothing, rather than `None`. A learner who
    // pressed `+` once too often should get `sensor.read()`, not a TypeError
    // about an argument they cannot see.
    const code = gen.valueToCode(block, `ARG${i}`, Order.NONE)
    if (code) parts.push(code)
  }
  return parts.join(', ')
}

/** The object a call or attribute block acts on. */
function callTarget(block: Blockly.Block, gen: MicroPythonGenerator): string {
  // `MEMBER`, so an object that is itself an expression is parenthesised before
  // the dot: `(a or b).read()` rather than `a or b.read()`.
  return gen.valueToCode(block, 'OBJ', Order.MEMBER) || 'None'
}

/** A method or attribute name, defaulted so the emitter never writes a bare dot. */
function memberName(block: Blockly.Block, field: string, fallback: string): string {
  const raw = String(block.getFieldValue(field) ?? '').trim()
  return raw === '' ? fallback : raw
}

/** Define the two call blocks imperatively — they have dynamic inputs. */
export function installPythonBlocks(): void {
  Blockly.Blocks[PYTHON_CALL] = callBlockMixin(false) as never
  Blockly.Blocks[PYTHON_CALL_VALUE] = callBlockMixin(true) as never
}

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

export const PYTHON_BLOCKS: BlockDefinition[] = [
  // ------------------------------------------------------------ raw statement
  {
    type: PYTHON_STATEMENT,
    category: 'python',
    help: 'blocks-python',
    json: {
      message0: '%1',
      args0: [pythonField('CODE', 'your Python here', PYTHON_STATEMENT)],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'One line of Python, written into your program exactly as you type it. For anything no block does yet.'
    },
    code: (block) => {
      const text = rawPython(block)
      // NOTHING for an empty block — not a blank line. A block somebody dragged
      // out and has not filled in yet must not put a gap in their program.
      return text === '' ? '' : `${text}\n`
    }
  },
  // ---------------------------------------------------------------- raw value
  {
    type: PYTHON_VALUE,
    category: 'python',
    help: 'blocks-python',
    json: {
      message0: '%1',
      args0: [pythonField('CODE', 'a value in Python')],
      inputsInline: true,
      output: null,
      tooltip:
        'A piece of Python that works out a value, to plug into any socket. For a reading no block does yet.'
    },
    code: (block) => {
      const text = rawPython(block)
      if (text === '') return ['None', Order.ATOMIC]
      // A name, a call or a literal binds as tightly as anything and reads best
      // unwrapped — `motor.go()`, not `(motor).go()`. ANYTHING ELSE is treated
      // as the loosest thing there is and parenthesised wherever it is nested,
      // because we cannot know what the learner's expression binds tighter than
      // and a missing bracket there is a wrong answer, not an untidy one.
      return [text, isAtomicExpression(text) ? Order.ATOMIC : Order.NONE]
    }
  },
  // ------------------------------------------------------------------ imports
  //
  // THREE BLOCKS RATHER THAN ONE WITH A DROPDOWN. A single block would have to
  // rearrange its own words — `import x`, `import x as y`, `from x import y`
  // put the module in a different place each time — which means hiding and
  // showing inputs under a menu nobody opens. Three tiny blocks in a flyout are
  // a menu, and each one already reads like the line it writes.
  {
    type: 'snakie_python_import',
    category: 'python',
    help: 'ref-imports',
    json: {
      message0: 'import %1',
      args0: [{ type: 'field_input', name: 'MODULE', text: 'machine' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Make a module available. The import line appears at the TOP of your program, where Python wants it.'
    },
    code: (block, gen) => needImport(gen, block, { module: moduleOf(block) })
  },
  {
    type: 'snakie_python_import_as',
    category: 'python',
    help: 'ref-imports',
    json: {
      message0: 'import %1 as %2',
      args0: [
        { type: 'field_input', name: 'MODULE', text: 'instruments' },
        { type: 'field_input', name: 'ALIAS', text: 'inst' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Import a module under a shorter name.'
    },
    code: (block, gen) =>
      needImport(gen, block, {
        module: moduleOf(block),
        alias: String(block.getFieldValue('ALIAS') ?? '').trim() || undefined
      })
  },
  {
    type: 'snakie_python_from_import',
    category: 'python',
    help: 'ref-imports',
    json: {
      message0: 'from %1 import %2',
      args0: [
        { type: 'field_input', name: 'MODULE', text: 'machine' },
        { type: 'field_input', name: 'NAME', text: 'Pin' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Take one name out of a module, so you can use it without the module in front.'
    },
    code: (block, gen) =>
      needImport(gen, block, {
        module: moduleOf(block),
        name: String(block.getFieldValue('NAME') ?? '').trim() || undefined
      })
  },
  // -------------------------------------------------------------------- calls
  {
    type: PYTHON_CALL,
    category: 'python',
    help: 'blocks-python',
    // No `json`: the shape is built imperatively in `installPythonBlocks`,
    // because the argument sockets are added and removed at runtime.
    toolbox: { extraState: { args: 1 } },
    code: (block, gen) =>
      `${callTarget(block, gen)}.${memberName(block, 'METHOD', 'update')}(${callArgs(block, gen)})\n`
  },
  {
    type: PYTHON_CALL_VALUE,
    category: 'python',
    help: 'blocks-python',
    toolbox: { extraState: { args: 0 } },
    code: (block, gen) => [
      `${callTarget(block, gen)}.${memberName(block, 'METHOD', 'read')}(${callArgs(block, gen)})`,
      // A call binds as tightly as anything in Python, so it never needs
      // wrapping where it is plugged in.
      Order.FUNCTION_CALL
    ]
  },
  // --------------------------------------------------------------- attributes
  {
    type: 'snakie_python_attr_get',
    category: 'python',
    help: 'blocks-python',
    json: {
      message0: '%1 . %2',
      args0: [
        { type: 'input_value', name: 'OBJ' },
        { type: 'field_input', name: 'NAME', text: 'value' }
      ],
      inputsInline: true,
      output: null,
      tooltip: "Read something off an object — a setting or a reading that isn't a method call."
    },
    code: (block, gen) => [
      `${callTarget(block, gen)}.${memberName(block, 'NAME', 'value')}`,
      Order.MEMBER
    ]
  },
  {
    type: 'snakie_python_attr_set',
    category: 'python',
    help: 'blocks-python',
    json: {
      message0: 'set %1 . %2 to %3',
      args0: [
        { type: 'input_value', name: 'OBJ' },
        { type: 'field_input', name: 'NAME', text: 'value' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Change something on an object.'
    },
    code: (block, gen) => {
      const value = gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'
      return `${callTarget(block, gen)}.${memberName(block, 'NAME', 'value')} = ${value}\n`
    }
  }
]

/** The module name a raw import block holds. */
function moduleOf(block: Blockly.Block): string {
  return String(block.getFieldValue('MODULE') ?? '').trim()
}

/**
 * Route an import through the generator's import manager (#1010) and emit
 * nothing where the block stands.
 *
 * THROUGH the manager, not around it: an `import machine` block and a hardware
 * block that also needs `machine` produce one import line between them, in the
 * right section, sorted with the rest — instead of a second copy fighting the
 * first. That is the entire reason this is a block rather than a raw statement
 * saying `import machine`.
 *
 * The block id goes with it, so #1016's hover still links: hover the import
 * block and the line it caused lights up at the top of the mirror, which is the
 * only way to SEE that a block generating nothing where it stands did anything
 * at all.
 */
function needImport(
  gen: MicroPythonGenerator,
  block: Blockly.Block,
  imp: { module: string; name?: string; alias?: string }
): string {
  if (imp.module) gen.need(imp, block)
  return ''
}
