import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * COMPREHENSIONS (#1126, epic #1119).
 * =============================================================================
 *
 * There was no comprehension block of any kind. `docs/blocks-coverage-epic.md`
 * §3.5 put them in "deliberately not doing", and the evidence there is worth
 * repeating because it is about READING rather than authoring:
 *
 * > **Comprehensions** — 26 projects write them; they cost **3** raw lines, for
 * > exactly the same reason [they sit inside a statement that is already a real
 * > block].
 *
 * That is a correct argument for not teaching the READER comprehensions, and it
 * says nothing about whether a learner should be able to BUILD one. #1119 asks
 * the second question, and 26 of 73 projects is how the person whose editor
 * this is actually writes — a learner graduating to text meets one immediately.
 *
 * THE READER SPIKE CAME BACK YES, which is why this ships with rules rather
 * than with the argued exception §4.1 expected. `[<expr> for <name> in <seq>]`
 * is a single logical line with two fixed keywords in it, and the lexer already
 * finds a top-level `for` — the literal readers have used it since #1135 to
 * tell a comprehension from a display. Splitting at that `for`, then at the
 * `in`, then at an optional `if`, is a dozen lines and no parser. So a learner
 * who drags one, saves and reopens gets their block back rather than the grey
 * value block the issue warned them to expect.
 *
 * WHAT THE READER STILL DECLINES, and each is declined because the BLOCK cannot
 * say it back: a nested comprehension (two `for`s), two filters, an `else` in
 * the expression, a loop target that is not a plain name, and a set
 * comprehension — this palette has no set blocks, which #1119 argued
 * deliberately.
 *
 * THE FILTER IS AN OPTIONAL SOCKET, NOT A MUTATOR ARM. The issue proposed a
 * mutator, "one shape that grows"; an optional socket is the same shape and
 * grows with nothing to serialise, nothing to migrate, and no second way to
 * edit a block. An empty socket means "all of them", which is the reading
 * `snakie_return` and `snakie_raise` already establish for an empty socket that
 * is a complete statement on its own.
 */
export const COMPREHENSION_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_list_comprehension',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'list of %1 for each %2 in %3',
      args0: [
        { type: 'input_value', name: 'EXPR' },
        { type: 'field_variable', name: 'VAR', variable: 'item' },
        { type: 'input_value', name: 'SEQ' }
      ],
      message1: 'only when %1',
      args1: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
      inputsInline: true,
      output: 'Array',
      tooltip:
        'Build a new list out of an old one in a single step — Python calls it a list comprehension. Leave "only when" empty to keep everything; fill it in to keep just the ones that match.'
    },
    code: (block, gen) => [comprehension(block, gen, expression(block, gen)), Order.ATOMIC]
  },
  {
    type: 'snakie_dict_comprehension',
    category: 'dicts',
    help: 'ref-dicts',
    json: {
      message0: 'dictionary of %1 to %2 for each %3 in %4',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_variable', name: 'VAR', variable: 'item' },
        { type: 'input_value', name: 'SEQ' }
      ],
      message1: 'only when %1',
      args1: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
      inputsInline: true,
      output: null,
      tooltip:
        'Build a dictionary out of a list in a single step — a name-to-value table from the names. Leave "only when" empty to use everything.'
    },
    code: (block, gen) => {
      const key = gen.valueToCode(block, 'KEY', Order.NONE) || "''"
      const value = gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'
      return [comprehension(block, gen, `${key}: ${value}`, '{', '}'), Order.ATOMIC]
    }
  }
]

/** The head of a list comprehension — the thing collected for each item. */
function expression(
  block: Parameters<BlockDefinition['code']>[0],
  gen: Parameters<BlockDefinition['code']>[1]
): string {
  return gen.valueToCode(block, 'EXPR', Order.NONE) || 'None'
}

/**
 * `[<head> for <name> in <seq>]`, with the filter when there is one.
 *
 * `Order.NONE` on the sequence rather than something tighter: a comprehension's
 * brackets already close round the whole of it, so nothing here can be
 * mis-grouped by an operator outside.
 */
function comprehension(
  block: Parameters<BlockDefinition['code']>[0],
  gen: Parameters<BlockDefinition['code']>[1],
  head: string,
  open = '[',
  close = ']'
): string {
  const name = gen.variableName(block.getFieldValue('VAR'))
  const seq = gen.valueToCode(block, 'SEQ', Order.NONE) || '[]'
  const cond = gen.valueToCode(block, 'COND', Order.NONE)
  // AN EMPTY FILTER IS "ALL OF THEM", not `if None`. The learner reached for a
  // block that collects things; the filter is the part they may not need.
  const when = cond ? ` if ${cond}` : ''
  return `${open}${head} for ${name} in ${seq}${when}${close}`
}
