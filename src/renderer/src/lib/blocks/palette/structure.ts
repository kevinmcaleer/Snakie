import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { sanitise } from '../names'
import type * as Blockly from 'blockly/core'

/**
 * STRUCTURE: CLASSES AND METHODS (W6, #1093, epic #1086).
 * =============================================================================
 *
 * **The single biggest theme in the corpus — 32.8% of all grey lines** once the
 * `self.` assignments and calls W1 fixed are counted with it. 2,692 raw lines of
 * nested `def` across 53 projects, 604 `class` headers across 46, and 340
 * decorators across 29. The old reader's own placeholder text admitted the gap:
 * `snakie_python_suite`'s field prompt is literally *"a Python block, e.g.
 * class Thing:"*.
 *
 * THE BLOCKLY DESIGN QUESTION, WHICH IS THE WHOLE OF WHY THIS IS ITS OWN FILE.
 * `procedures_defnoreturn` is a **hat**, and a hat cannot nest. That is exactly
 * why #1063 stopped hoisting methods out of their class: a class was losing its
 * header and its twelve methods were walking off to become twelve top-level
 * functions, each generated un-indented and none of them attached to the object
 * they belong to. So this needs two shapes Blockly's procedure blocks cannot
 * give:
 *
 *  - a **class block with a statement input**, so a body can live inside it;
 *  - **method blocks that are ordinary stackable blocks** rather than hats, so
 *    they can sit in that input.
 *
 * `self` IS NOT A VARIABLE, and this is the third shape. Blockly variables are
 * global to the workspace and renameable from a dropdown — a learner renaming
 * `self` in one method would rename it in twelve and generate a class that no
 * longer works. So `self` is its own tiny value block, and a method's parameter
 * list is a FIELD rather than a set of workspace variables: that also means a
 * signature `procedures_def` could never hold (`def load(path, flip_x=None)`,
 * `*args`, a type annotation) comes back exactly as written.
 *
 * READING IS NOT TOOLBOX SURFACE (`docs/blocks-coverage-epic.md` §4.5). These
 * are `hidden`: a class belongs in the reader's vocabulary and not in a
 * ten-year-old's first drawer. Whether that should change is a curriculum
 * decision — epic #1086's open question 2 — and it is one field on each
 * definition when somebody makes it.
 */

/** A name written back into the program, made legal but never renamed. */
function nameOf(block: Blockly.Block, field: string, fallback: string): string {
  const raw = String(block.getFieldValue(field) ?? '').trim()
  // `sanitise`, NOT `toPythonIdentifier`: the second one renames a name that
  // would shadow a builtin, which is right for a name a learner typed into a
  // variable block and wrong for a class somebody called `Property` in a file we
  // are reading back. A legal identifier passes through untouched.
  return raw === '' ? fallback : sanitise(raw)
}

/** A statement input's body, or `pass` — an empty suite is a syntax error. */
function body(block: Blockly.Block, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, 'BODY') || `${gen.INDENT}pass\n`
}

export const STRUCTURE_BLOCKS: BlockDefinition[] = [
  // --------------------------------------------------------------------- class
  {
    type: 'snakie_class',
    category: 'functions',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'class %1 %2',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'Thing' },
        // THE BASE CLASSES, VERBATIM AND WITH THEIR BRACKETS — `(Wheels)`, or
        // `(Base, Mixin)`, or nothing at all. Kept as the text that goes in the
        // line rather than as a list, because multiple bases, a keyword base
        // (`metaclass=`) and an empty one are then all the same case, and
        // because #1093 asks for inheritance to be a field FROM THE START:
        // retrofitting it would mean migrating saved workspaces.
        { type: 'field_input', name: 'BASES', text: '' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'BODY' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'A class: a kind of thing, with the methods it can do inside it. The brackets after the name are the classes it builds on.'
    },
    code: (block, gen) => {
      const bases = String(block.getFieldValue('BASES') ?? '').trim()
      return `class ${nameOf(block, 'NAME', 'Thing')}${bases}:\n${body(block, gen)}`
    }
  },
  // -------------------------------------------------------------------- method
  {
    type: 'snakie_method',
    category: 'functions',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: '%1 %2 ( %3 )',
      args0: [
        {
          // `@property` AS A MODIFIER, not a block of its own (#1093). A
          // decorator on its own line would be a block that means nothing
          // without the block under it, and could be dragged away from it.
          type: 'field_dropdown',
          name: 'DECORATOR',
          options: [
            ['method', 'NONE'],
            ['property', 'property'],
            ['static method', 'staticmethod'],
            ['class method', 'classmethod']
          ]
        },
        { type: 'field_input', name: 'NAME', text: 'go' },
        // THE WHOLE PARAMETER LIST AS TEXT — `self`, `self, speed`,
        // `self, flip_x=None`, `*args`. `procedures_def` can only hold bare
        // names, because its parameters ARE workspace variables; #1063 records
        // what that cost (`def load(path, flip_x=None)` came back as
        // `def load(path)`, and every call to it still passed three arguments).
        // A field holds any signature exactly.
        { type: 'field_input', name: 'PARAMS', text: 'self' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'BODY' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Something this class can do. The first parameter is almost always `self` — the particular thing the method was called on.'
    },
    code: (block, gen) => {
      const decorator = String(block.getFieldValue('DECORATOR') ?? 'NONE')
      const at = decorator === 'NONE' ? '' : `@${decorator}\n`
      const params = String(block.getFieldValue('PARAMS') ?? '').trim()
      return `${at}def ${nameOf(block, 'NAME', 'go')}(${params}):\n${body(block, gen)}`
    }
  },
  // ---------------------------------------------------------------------- self
  {
    type: 'snakie_self',
    category: 'functions',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'self',
      output: null,
      tooltip:
        'The particular thing this method was called on — the one whose `self.` values it reads and changes.'
    },
    // NOT A VARIABLE, which is the entire point (#1093, §4.3 of the delivery
    // plan). A workspace variable named `self` would appear in the Variables
    // drawer and be renameable from a dropdown that renames every use of it in
    // the file — twelve methods at once, and a class that no longer works.
    code: () => ['self', Order.ATOMIC]
  }
]
