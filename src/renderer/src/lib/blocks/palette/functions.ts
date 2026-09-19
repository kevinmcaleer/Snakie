import { commentDocstring } from '../docstring'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import * as Blockly from 'blockly/core'
import { registerCallRules } from '../python-to-blocks'

/**
 * FUNCTIONS (#1011, epic #1007).
 * =============================================================================
 *
 * Define one, with or without an answer; call it; give it arguments. Blockly's
 * own procedure blocks, which carry the mutator that adds parameters, the
 * bookkeeping that renames every caller when the definition is renamed, and the
 * caller blocks that appear in the toolbox as soon as a definition exists.
 *
 * DEFINITIONS ARE HOISTED, by `defineFunction` on the generator. A `def` block
 * sits wherever the learner dropped it — very often below the code that calls
 * it, because that is where there was room on the canvas. Emitted in place, the
 * call would run first and die with a `NameError` about something they did
 * nothing wrong to cause. Collecting them into their own section above the
 * program is both the fix and where a Python programmer would have put them.
 *
 * A definition block therefore generates NOTHING where it stands, which is the
 * one place in the palette where an emitter returning `''` is correct rather
 * than a bug.
 */

/** Python identifiers for a definition block's parameters, in order. */
function params(block: Blockly.Block, gen: MicroPythonGenerator): string[] {
  const models = block.getVarModels?.() ?? []
  return models.map((m) => gen.variableName(m.getId(), m.getName()))
}

/**
 * THE PARAMETERS BLOCKLY'S LIST CANNOT HOLD (#1134, epic #1119).
 *
 * Blockly's procedure mutator models a parameter as a bare NAME — it becomes a
 * workspace variable, and renaming it renames every caller, which is exactly the
 * machinery `palette/index.ts` says is worth not rebuilding. A default value, a
 * `*args` or a `**kwargs` has nowhere to live on it, so
 * `def blink(times=3):` could not be built and `def load(path, flip=None):`
 * could not even be READ — `modellableParams` sent the whole `def` to a raw
 * suite rather than drop a parameter.
 *
 * SO THEY GO IN A FIELD, appended after the declared ones. That is the same
 * decision `snakie_method` made for its whole parameter list and `snakie_with`
 * made for its head: the text is exact for every form, where sockets would
 * model the common case and lose the rest.
 *
 * AND IT IS THE DECISION THAT KEEPS EVERY SAVED WORKSPACE LOADING. The issue
 * names extending the mutator's serialisation as the whole cost of this work;
 * a field on the block is serialised by name, a block saved before it existed
 * simply has none, and Blockly's own procedure machinery is untouched.
 *
 * A DEFAULTED PARAMETER GETS NO CALLER SOCKET, which is correct rather than a
 * shortcoming: it is optional at the call site, which is the whole reason for
 * giving it a default.
 */
function signature(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const declared = params(block, gen)
  const extra = String(block.getFieldValue(EXTRAS_FIELD) ?? '').trim().replace(/,\s*$/, '')
  return [...declared, ...(extra === '' ? [] : [extra])].join(', ')
}

/** The field the extra parameters live in, and the input that carries it. */
export const EXTRAS_FIELD = 'EXTRAS'
const EXTRAS_INPUT = 'SNAKIE_EXTRAS'

/** A statement input's body, or `pass` — an empty `def` is a syntax error. */
function body(block: Blockly.Block, name: string, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
}

/**
 * THE BLOCK'S DESCRIPTION, AS A DOCSTRING.
 *
 * Blockly's comment bubble and a Python docstring say the same thing about the
 * same function, so a `def` block writes its bubble out as the first line of the
 * body and `python-to-blocks.ts` reads it straight back in. See `docstring.ts`
 * for why the reading half only ever accepts what it can reproduce exactly.
 *
 * `getCommentText` is on the rendered block, not the definition, so a workspace
 * loaded from a file carries it: Blockly serialises the bubble as the block's
 * `icons.comment`.
 */
function docstring(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const line = commentDocstring(block.getCommentText?.() ?? null)
  return line === null ? '' : `${gen.INDENT}${line}\n`
}

export const FUNCTION_BLOCKS: BlockDefinition[] = [
  {
    type: 'procedures_defnoreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => {
      const name = gen.functionName(block.getFieldValue('NAME') ?? 'do_something')
      // The docstring goes FIRST, where Python looks for one, and the `pass`
      // filler is only needed when there is neither it nor a body.
      const doc = docstring(block, gen)
      const stack = doc ? gen.statementToCode(block, 'STACK') : body(block, 'STACK', gen)
      gen.defineFunction(
        block.id,
        `def ${name}(${signature(block, gen)}):\n${doc}${stack}`
      )
      return ''
    }
  },
  {
    type: 'procedures_defreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => {
      const name = gen.functionName(block.getFieldValue('NAME') ?? 'get_something')
      // AN EMPTY SOCKET IS `None`, NOT NO RETURN AT ALL.
      //
      // This used to drop the whole `return` line while the socket was empty, so
      // dropping the returning `def` block out of the drawer put
      // `def do_something():\n    pass` in the mirror — a block with a `return`
      // row on it and a function that does not return, which is precisely the
      // disagreement between the two halves that the mirror exists to rule out.
      //
      // Every other empty value socket in this palette substitutes a placeholder
      // rather than deleting the construct around it: `if` with nothing in it is
      // `if False:`, `repeat` is `range(0)`, `for each` is over `[]`. The
      // learner reached for the block that has an answer, so the answer is
      // `None` until they say otherwise — and it fills in the moment they plug
      // anything into the socket.
      const answer = gen.valueToCode(block, 'RETURN', Order.NONE) || 'None'
      // The body first, THEN the return. No `pass` branch any more: a `def` that
      // always ends in `return` can never have an empty body to fill.
      const inner =
        docstring(block, gen) +
        gen.statementToCode(block, 'STACK') +
        `${gen.INDENT}return ${answer}\n`
      gen.defineFunction(block.id, `def ${name}(${signature(block, gen)}):\n${inner}`)
      return ''
    }
  },
  // THE TWO CALLER BLOCKS ARE REGISTERED BUT NEVER LISTED (#1045).
  //
  // They must stay in the registry: the generator looks a block's emitter up by
  // type, and `workspace-check.ts` refuses to open a file containing a type this
  // build does not know — so dropping them would strand every saved program that
  // calls a function.
  //
  // They must NOT appear in the flyout, which is why the Functions category is
  // `custom: 'PROCEDURE'` (see `buildToolbox`). Listed statically they render as
  // what they are with no procedure to name: two BLANK, nameless blocks. Blockly
  // generates a named caller per defined function instead.
  {
    // `super()` — THE CLASS THIS ONE IS BUILT ON (#1134, epic #1119).
    //
    // W6 (#1093) gave `snakie_class` inheritance, which makes this live rather
    // than theoretical: the standard way to write a subclass's `__init__` is to
    // call the parent's, and there was no block that could name it.
    //
    // A VALUE BLOCK, so it goes in the object socket of a `call` block and
    // reads as what it is: *call (__init__) on (the class this is built on)*.
    type: 'snakie_super',
    category: 'functions',
    help: 'ref-classes',
    read: { fn: 'super', args: [], shape: 'value' },
    json: {
      message0: 'the class this one is built on',
      output: null,
      tooltip:
        'The class your class was built on — Python writes it super(). Call a method on it to run the version your class replaced, which is how a subclass’s setup runs its parent’s first.'
    },
    code: () => ['super()', Order.FUNCTION_CALL]
  },
  {
    type: 'procedures_callnoreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => `${callCode(block, gen)}\n`
  },
  {
    type: 'procedures_callreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => [callCode(block, gen), Order.FUNCTION_CALL]
  },
  // -------------------------------------------------------------- return
  //
  // A REAL RETURN STATEMENT (W3, #1090, epic #1086).
  //
  // 2,359 raw lines across 57 of 73 projects, and the gap is a deliberate
  // retreat rather than an oversight: a mid-function `return` USED to become
  // `procedures_ifreturn` below, whose code is `if <COND>: return <VALUE>` — and
  // with nothing in COND the generator wrote `if False:`, so every early return
  // in the program silently became dead code. #1063 pulled it back to a raw
  // block, which is honest and grey.
  //
  // This is the block that was missing. No condition, a value socket that may be
  // empty, and — unlike `controls_flow_statements` — A NEXT CONNECTION: `return`
  // mid-function is ordinary Python, and a block with nothing after it cannot
  // hold the rest of a guard clause's function. The terminal-block rule (#1068)
  // is about blocks that CANNOT be followed; this one can.
  //
  // AN EMPTY SOCKET IS A BARE `return`, not `return None`. Everywhere else in
  // this palette an empty socket takes a placeholder, because the learner
  // reached for a block that needs a value; here the empty block is itself a
  // complete, common statement — the guard clause that leaves early with no
  // answer — and writing `return None` would be putting words in their mouth.
  {
    type: 'snakie_return',
    category: 'functions',
    help: 'ref-functions',
    json: {
      message0: 'return %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Leave this function, and give back what is plugged in. With nothing plugged in it just leaves — which is what a check at the top of a function does when there is nothing to do.'
    },
    code: (block, gen) => {
      const value = gen.valueToCode(block, 'VALUE', Order.NONE)
      return value === '' ? 'return\n' : `return ${value}\n`
    }
  },
  {
    type: 'procedures_ifreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => {
      const cond = gen.valueToCode(block, 'CONDITION', Order.NONE) || 'False'
      // `hasReturnValue_` is Blockly's own flag for "this sits in a def that
      // returns something", set by the mutator when the block is attached.
      const hasValue = (block as unknown as { hasReturnValue_?: boolean }).hasReturnValue_
      const value = hasValue ? ` ${gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'}` : ''
      return `if ${cond}:\n${gen.INDENT}return${value}\n`
    }
  }
]

/** `name(arg, arg)` for a caller block. */
function callCode(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const name = gen.functionName(block.getFieldValue('NAME') ?? 'do_something')
  const args: string[] = []
  // The caller's sockets are ARG0, ARG1, … — one per parameter the definition
  // has, kept in step by Blockly as the mutator adds and removes them.
  for (let i = 0; block.getInput(`ARG${i}`); i++) {
    args.push(gen.valueToCode(block, `ARG${i}`, Order.NONE) || 'None')
  }
  return `${name}(${args.join(', ')})`
}

/**
 * How `super()` reads back (#1134).
 *
 * A one-liner, the same shape as the `len`/`abs` entries in the reader's own
 * table — which is the whole reason it could be filed with the keyword
 * arguments rather than as work of its own.
 */
registerCallRules(
  FUNCTION_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)

/**
 * Give Blockly's two `def` blocks the extra-parameters field (#1134).
 *
 * WRAPPING `init` RATHER THAN REDEFINING THE BLOCK. Both are built in code and
 * carry the mutator, the caller bookkeeping and the rename flow; handing them a
 * JSON definition would replace all of it. Appending one input afterwards
 * leaves every bit of that machinery exactly where it was.
 *
 * Idempotent, because `installCorePalette` runs again for every test file and
 * `Blockly.Blocks` is not reset between them — a second wrap would append the
 * field twice and Blockly throws on a duplicate input name.
 */
export function installFunctionBlocks(): void {
  for (const type of ['procedures_defnoreturn', 'procedures_defreturn']) {
    const def = Blockly.Blocks[type] as unknown as {
      init: (this: Blockly.Block) => void
      snakieExtras_?: boolean
    }
    if (!def || def.snakieExtras_) continue
    const init = def.init
    def.init = function (this: Blockly.Block): void {
      init.call(this)
      this.appendDummyInput(EXTRAS_INPUT)
        .appendField('and also')
        .appendField(new Blockly.FieldTextInput(''), EXTRAS_FIELD)
      // Above the body, where the rest of the signature is — `appendDummyInput`
      // puts it at the bottom, under the `return` row.
      if (this.getInput('STACK')) this.moveInputBefore(EXTRAS_INPUT, 'STACK')
    }
    def.snakieExtras_ = true
  }
}
