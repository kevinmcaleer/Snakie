import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition } from '../registry'
import { growableMixin, itemCount } from './growable'

/**
 * DICTIONARIES (#1120, epic #1119).
 * =============================================================================
 *
 * **There were no dictionary blocks at all** — no drawer, no theme token, not
 * one block. A dict is not an exotic construct in device code: it is the shape
 * of a config, a note→frequency table, a pin map, a JSON payload, a state
 * machine's transitions. A learner who wanted one had to type the literal into
 * `snakie_python_value`, which is the escape hatch (#1018) doing a job the
 * palette should do.
 *
 * KEYS ARE SOCKETS, NOT FIELDS. A key is as often a variable or a number — a
 * note, a pin — as it is a literal, and a field could only ever hold the third
 * one. The create block's key sockets arrive with a `text` shadow, so the first
 * drag produces something that runs.
 *
 * `get … or …` IS THE ONE THE FLYOUT OFFERS FIRST. `d['k']` raises a `KeyError`
 * and a beginner meeting that has no idea what happened; `.get(k, default)`
 * hands back the default and carries on. Both ship, because the plain one is
 * what they will read everywhere else — but the order in the drawer is a
 * curriculum decision and this is it.
 *
 * TWO BLOCKS THIS DRAWER DELIBERATELY DOES NOT HAVE.
 *
 *  - **`has key`.** It would generate `'k' in d`, and #1128 has just finished
 *    making sure exactly one block writes `a in b` — the general membership
 *    block in Logic, whose haystack stopped checking `Array` for precisely this
 *    case. A second block writing the same line is the outcome that issue named
 *    as the one to avoid.
 *  - **`how many things in`.** `len(d)` is already written by `length of`, and
 *    read back as `text_length`; a third block writing `len(x)` would be the
 *    same trade for no gain. The Lists block's socket checks nothing, so it
 *    takes a dictionary today.
 *
 * ITERATING a dictionary — `for key, value in d.items():` — is the multi-value
 * loop from #1121, not a block of its own.
 */

/** The dictionary literal's block type — its shape is built in code. */
export const DICT_BLOCK = 'snakie_dict_create'

export const DICT_BLOCKS: BlockDefinition[] = [
  {
    type: DICT_BLOCK,
    category: 'dicts',
    help: 'ref-dicts',
    // TWO PAIRS AND A SHADOW IN EACH KEY, so a block dragged out of the flyout
    // is a dictionary that runs rather than four holes to discover.
    toolbox: {
      extraState: { items: 2 },
      inputs: {
        KEY0: { shadow: { type: 'text', fields: { TEXT: 'name' } } },
        KEY1: { shadow: { type: 'text', fields: { TEXT: 'other' } } }
      }
    },
    code: (block, gen) => {
      const pairs: string[] = []
      for (let i = 0; i < itemCount(block); i++) {
        const key = gen.valueToCode(block, `KEY${i}`, Order.NONE)
        // A PAIR WITH NO KEY IS NOT A PAIR. An empty socket would write
        // `None: 1`, which is legal Python and never what somebody meant — the
        // row is skipped instead, the way the call blocks skip an empty
        // argument.
        if (!key) continue
        pairs.push(`${key}: ${gen.valueToCode(block, `VALUE${i}`, Order.NONE) || 'None'}`)
      }
      return [`{${pairs.join(', ')}}`, Order.ATOMIC]
    }
  },
  {
    type: 'snakie_dict_get_default',
    category: 'dicts',
    help: 'ref-dicts',
    read: { fn: 'get', on: 'DICT', args: ['KEY', 'DEFAULT'], shape: 'value' },
    json: {
      message0: 'get %1 of %2 or %3',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'DICT' },
        { type: 'input_value', name: 'DEFAULT' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Look a key up, and hand back the other value when it is not there. This is the safe one: the plain "get" stops the program with a KeyError instead.'
    },
    toolbox: {
      inputs: {
        KEY: { shadow: { type: 'text', fields: { TEXT: 'name' } } },
        DEFAULT: { shadow: { type: 'math_number', fields: { NUM: 0 } } }
      }
    },
    code: (block, gen) => {
      const dict = gen.valueToCode(block, 'DICT', Order.MEMBER) || '{}'
      const key = gen.valueToCode(block, 'KEY', Order.NONE) || "''"
      const fallback = gen.valueToCode(block, 'DEFAULT', Order.NONE) || 'None'
      return [`${dict}.get(${key}, ${fallback})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_dict_get',
    category: 'dicts',
    help: 'ref-dicts',
    json: {
      message0: 'get %1 of %2',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'DICT' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Look a key up. If the key is not there the program stops with a KeyError — use "get … or …" when it might not be.'
    },
    toolbox: { inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'name' } } } } },
    code: (block, gen) => {
      const dict = gen.valueToCode(block, 'DICT', Order.MEMBER) || '{}'
      return [`${dict}[${gen.valueToCode(block, 'KEY', Order.NONE) || "''"}]`, Order.MEMBER]
    }
  },
  {
    type: 'snakie_dict_set',
    category: 'dicts',
    help: 'ref-dicts',
    json: {
      message0: 'set %1 of %2 to %3',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'DICT' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Put a value under a key. If the key is already there its value is replaced; if it is not, it is added.'
    },
    toolbox: { inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'name' } } } } },
    code: (block, gen) => {
      const dict = gen.valueToCode(block, 'DICT', Order.MEMBER) || '{}'
      const key = gen.valueToCode(block, 'KEY', Order.NONE) || "''"
      const value = gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'
      return `${dict}[${key}] = ${value}\n`
    }
  },
  {
    // TAKING A KEY OUT IS `del`, which is why #1133 gates this one: there is no
    // method for it. `d.pop(k)` exists and hands the value back, which is a
    // different block and a different lesson.
    type: 'snakie_dict_remove',
    category: 'dicts',
    help: 'ref-dicts',
    json: {
      message0: 'remove %1 from %2',
      args0: [
        { type: 'input_value', name: 'KEY' },
        { type: 'input_value', name: 'DICT' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Take a key, and the value under it, out of a dictionary. Python writes it `del`. Removing a key that is not there stops the program.'
    },
    toolbox: { inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'name' } } } } },
    code: (block, gen) => {
      const dict = gen.valueToCode(block, 'DICT', Order.MEMBER) || '{}'
      return `del ${dict}[${gen.valueToCode(block, 'KEY', Order.NONE) || "''"}]\n`
    }
  },
  {
    // ONE BLOCK WITH A DROPDOWN, not three. `keys`, `values` and `items` are the
    // same sentence with one word changed — the argument `snakie_cast` and
    // `snakie_math_min_max` already make, and three near-identical shapes in a
    // six-block drawer would be half of it.
    type: 'snakie_dict_parts',
    category: 'dicts',
    help: 'ref-dicts',
    json: {
      message0: 'the %1 of %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'WHAT',
          options: [
            ['keys', 'keys'],
            ['values', 'values'],
            ['key-and-value pairs', 'items']
          ]
        },
        { type: 'input_value', name: 'DICT' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'All the keys, all the values, or both together. Put the pairs into a "for each … and … in" loop to go through a whole dictionary.'
    },
    code: (block, gen) => {
      const dict = gen.valueToCode(block, 'DICT', Order.MEMBER) || '{}'
      return [`${dict}.${String(block.getFieldValue('WHAT') ?? 'keys')}()`, Order.FUNCTION_CALL]
    }
  }
]

/**
 * How these blocks read BACK out of Python (#1120).
 *
 * `.get(k, d)` and the three `.keys()`/`.values()`/`.items()` are calls on a
 * receiver the learner named, which is `CallRule.on` — the shape
 * `snakie_list_append` has used since #1089.
 *
 * THE OTHER THREE ARE NOT CALLS. `d['k']`, `d['k'] = v` and `del d['k']` are a
 * subscript, an assignment and a statement, and the reader claims each of them
 * only where the key is a STRING LITERAL — see `python-to-blocks.ts`. `xs[i]`
 * with a variable in it could be either a list or a dictionary, and guessing
 * wrong would put somebody's line in the wrong drawer.
 */
registerCallRules([
  ...DICT_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : [])),
  ...(['keys', 'values', 'items'] as const).map((what) => ({
    fn: what,
    type: 'snakie_dict_parts',
    on: 'DICT',
    args: [] as const,
    shape: 'value' as const,
    fields: { WHAT: what }
  }))
])

/** Register the dictionary literal, whose pairs come and go. */
export function installDictBlocks(): void {
  Blockly.Blocks[DICT_BLOCK] = growableMixin({
    style: 'dicts_blocks',
    head: 'dictionary of',
    defaults: 2,
    first: '',
    separator: 'and',
    noun: 'pair',
    value: true,
    pair: { keyPrefix: 'KEY', valuePrefix: 'VALUE', between: 'is' },
    tooltip:
      'A set of values you look up by name — a config, a pin map, a note-to-frequency table. Python writes it {"name": value}.'
  }) as never
}
