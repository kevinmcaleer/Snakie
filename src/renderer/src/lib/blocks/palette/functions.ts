import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import type * as Blockly from 'blockly/core'

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

/** A statement input's body, or `pass` — an empty `def` is a syntax error. */
function body(block: Blockly.Block, name: string, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
}

export const FUNCTION_BLOCKS: BlockDefinition[] = [
  {
    type: 'procedures_defnoreturn',
    category: 'functions',
    help: 'ref-functions',
    code: (block, gen) => {
      const name = gen.functionName(block.getFieldValue('NAME') ?? 'do_something')
      gen.defineFunction(
        block.id,
        `def ${name}(${params(block, gen).join(', ')}):\n${body(block, 'STACK', gen)}`
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
      const answer = gen.valueToCode(block, 'RETURN', Order.NONE)
      // The body first, THEN the return — and `pass` only when there is neither,
      // because `def f(): return 1` needs no filler.
      const stack = gen.statementToCode(block, 'STACK')
      const tail = answer ? `${gen.INDENT}return ${answer}\n` : ''
      const inner = stack + tail || `${gen.INDENT}pass\n`
      gen.defineFunction(block.id, `def ${name}(${params(block, gen).join(', ')}):\n${inner}`)
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
