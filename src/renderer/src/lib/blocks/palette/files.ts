import { Order } from '../generator'
import type * as Blockly from 'blockly/core'
import type { MicroPythonGenerator } from '../generator'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition, BlockGroup } from '../registry'

/**
 * FILES, AND THE `with` THAT KEEPS THEM SAFE (#1132, epic #1119).
 * =============================================================================
 *
 * `snakie_with` has existed since W7 (#1094) and was `hidden: true` — the
 * reader could emit it and nobody could drag it. On a microcontroller `with`
 * has one overwhelmingly common use: opening a file on the flash or the SD
 * card. Logging readings to `data.csv` and reading a config back are both
 * things learners ask for early, and neither was expressible in blocks at all —
 * not the `with`, and not the `open()` either.
 *
 * THIS IS THE ONE HIDDEN BLOCK WHOSE VALUE IS IN WHAT IT CONTAINS. Flipping it
 * on its own gives a learner a C-shape with nothing to put in it, so the file
 * blocks are not an optional extra here — they are the point.
 *
 * WHY `with` AND NOT `open` / `close`. A learner who forgets `close()` on a
 * Pico loses their data with no error at all — the file is simply never
 * flushed. `with` is the block that makes that impossible, which is a far
 * better reason to teach it than "it is idiomatic".
 *
 * TWO BLOCKS FOR `with`, AND THE SPLIT IS #1121'S. `use … as …` takes the thing
 * in a SOCKET and the name in a variable field, which is the shape a learner
 * meets — and the shape that lets the `open file` block plug straight into it.
 * `snakie_python_with` keeps its text field, stays hidden, and keeps everything
 * that shape cannot hold: two context managers on one line, `async with`, a
 * name that is not a plain identifier. The reader routes between them.
 *
 * WHERE THEY LIVE. Not a Files CATEGORY: the block palette carries fourteen
 * vivid hues at ~24° apart and #1120 took the last slot the wheel had at the
 * palette's depth, so a fifteenth colour would have to come out of somebody
 * else's drawer. A **Files** shelf inside Control instead — `use … as` and
 * `for each line` really are control flow, the other two only mean anything
 * inside them, and Control is where a learner who has just met `with` is
 * standing.
 *
 * CIRCUITPYTHON IS HONEST RATHER THAN HIDDEN. `open` is core in both runtimes
 * and READING works on both, so the blocks are unscoped. Writing is the
 * difference: a CircuitPython board's filesystem is read-only to your program
 * unless `boot.py` remounts it, and a write without that raises
 * `OSError: Read-only filesystem`. Scoping the family to MicroPython would take
 * reading away from a board that does it perfectly well, so the tooltip and the
 * help page say it instead.
 */

/** The Control sub-drawer the file blocks live in. */
const FILES: BlockGroup = { id: 'files', name: 'Files' }

/** A statement input's body, or `pass` — an empty suite is a syntax error. */
function body(block: Blockly.Block, name: string, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
}

export const FILE_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_use',
    category: 'control',
    group: FILES,
    help: 'ref-files',
    json: {
      message0: 'use %1 as %2',
      args0: [
        { type: 'input_value', name: 'THING' },
        { type: 'field_variable', name: 'VAR', variable: 'file' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'BODY' }],
      message2: 'and close it afterwards',
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Borrow something for the length of this block — a file, a lock — and give it back however the block ends, even if something goes wrong inside. Python calls this `with`.'
    },
    code: (block, gen) => {
      const thing = gen.valueToCode(block, 'THING', Order.NONE) || 'None'
      const name = gen.variableName(block.getFieldValue('VAR'))
      return `with ${thing} as ${name}:\n${body(block, 'BODY', gen)}`
    }
  },
  {
    type: 'snakie_file_open',
    category: 'control',
    group: FILES,
    help: 'ref-files',
    read: {
      fn: 'open',
      args: ['PATH'],
      shape: 'value',
      argFields: {
        1: {
          field: 'MODE',
          // BOTH QUOTE STYLES. The generator writes single quotes, and a file
          // somebody typed may use either — a mode the table does not list
          // (`'rb'`, `'w+'`) declines the rule and keeps the line verbatim.
          values: {
            "'r'": 'r',
            '"r"': 'r',
            "'w'": 'w',
            '"w"': 'w',
            "'a'": 'a',
            '"a"': 'a'
          }
        }
      }
    },
    json: {
      message0: 'open file %1 for %2',
      args0: [
        { type: 'input_value', name: 'PATH' },
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['reading', 'r'],
            ['writing (start again)', 'w'],
            ['adding to the end', 'a']
          ]
        }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Open a file on the board. "Writing" empties it first; "adding" keeps what is there. Plug this into "use … as" so it is always closed again. On a CircuitPython board you can read files, but writing needs boot.py to remount the filesystem first.'
    },
    toolbox: { inputs: { PATH: { shadow: { type: 'text', fields: { TEXT: 'data.csv' } } } } },
    code: (block, gen) => {
      const path = gen.valueToCode(block, 'PATH', Order.NONE) || "''"
      return [`open(${path}, '${String(block.getFieldValue('MODE') ?? 'r')}')`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_file_write',
    category: 'control',
    group: FILES,
    help: 'ref-files',
    read: { fn: 'write', on: 'FILE', args: ['TEXT'], shape: 'statement' },
    json: {
      message0: 'write %1 to %2',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        { type: 'input_value', name: 'FILE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Put a piece of text into an open file. Nothing is added for you — end the text with a newline if you want the next write on its own line.'
    },
    code: (block, gen) => {
      const file = gen.valueToCode(block, 'FILE', Order.MEMBER) || 'file'
      return `${file}.write(${gen.valueToCode(block, 'TEXT', Order.NONE) || "''"})\n`
    }
  },
  {
    // READING A FILE IS A LOOP, not a value. `for line in f:` hands one line at
    // a time and never holds the whole file in memory, which on a board with
    // 264 KB of RAM is the difference between a program that works and one that
    // dies on a log file.
    type: 'snakie_file_lines',
    category: 'control',
    group: FILES,
    help: 'ref-files',
    json: {
      message0: 'for every line %1 of %2',
      args0: [
        { type: 'field_variable', name: 'VAR', variable: 'line' },
        { type: 'input_value', name: 'FILE' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Go through an open file one line at a time. Each line still has its newline on the end — "with spaces trimmed" takes it off.'
    },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      const file = gen.valueToCode(block, 'FILE', Order.NONE) || 'file'
      return `for ${name} in ${file}:\n${body(block, 'DO', gen)}`
    }
  }
]

/**
 * How the file blocks read back (#1132).
 *
 * `open` carries its mode as a FIELD, which is `CallRule.argFields` — a mode
 * the dropdown cannot hold (`'rb'`, `'w+'`) declines the rule and the line
 * stays verbatim. `use … as` and `for every line` are suite headers rather than
 * calls, and are read in `python-to-blocks.ts` beside the `with` and `for` they
 * are versions of.
 */
registerCallRules(
  FILE_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)
