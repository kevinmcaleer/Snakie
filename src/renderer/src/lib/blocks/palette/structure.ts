import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { sanitise } from '../names'

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
 * ERROR HANDLING AND RESOURCES LIVE HERE TOO (W7, #1094): `try`/`except`, `with`
 * and `raise`. They are the same kind of thing — structure a program is built
 * out of rather than something it computes — and `try` in particular needs the
 * same trick the class block does: a block whose inputs come and go, built in
 * code rather than declared as JSON.
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

/** The block type, named here because both the palette and the reader want it. */
export const TRY_BLOCK = 'snakie_try'

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
  },
  // ----------------------------------------------------------------- try / with
  //
  // THE ERROR-HANDLING AND RESOURCE SHAPES (W7, #1094): 1,271 raw lines of
  // `try` across 40 projects, 322 of `raise` across 26, 198 of `with` across 27.
  // All three are line-shaped headers, which is why none of them is an argument
  // for a parser.
  {
    type: TRY_BLOCK,
    category: 'control',
    help: 'ref-functions',
    hidden: true,
    // No `json`: the arms come and go, so the shape is built in
    // `installStructureBlocks` — the same reason the call blocks are.
    toolbox: { extraState: { excepts: [''], hasElse: false, hasFinally: false } },
    code: (block, gen) => {
      const state = tryState(block)
      const arm = (name: string): string => gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
      let out = `try:\n${arm('TRY')}`
      state.excepts.forEach((_, i) => {
        // The exception spec VERBATIM — `OSError`, `OSError as e`,
        // `(ValueError, TypeError) as e`, or nothing at all for a bare
        // `except:`. `except ... as e` alone is 34 of 73 projects, so the bound
        // name is part of the shape rather than an optional extra.
        const spec = String(block.getFieldValue(`EXCEPT${i}`) ?? '').trim()
        out += `except${spec === '' ? '' : ` ${spec}`}:\n${arm(`DO${i}`)}`
      })
      if (state.hasElse) out += `else:\n${arm('ELSE')}`
      if (state.hasFinally) out += `finally:\n${arm('FINALLY')}`
      return out
    }
  },
  {
    type: 'snakie_with',
    category: 'control',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'with %1',
      args0: [{ type: 'field_input', name: 'ITEMS', text: 'open(path) as handle' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'BODY' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Borrow something for the length of this block — a file, a lock — and give it back afterwards, however the block ends.'
    },
    // THE WHOLE HEAD AS ONE FIELD, and that is a decision rather than laziness.
    // `with open(a) as f, open(b) as g:` is two context managers and two
    // bindings, and a binding is a NAME the body then uses — so a socket for the
    // expression plus a field for the name would model the common case and
    // silently lose the other one. The text is exact for both.
    code: (block, gen) => {
      const items = String(block.getFieldValue('ITEMS') ?? '').trim()
      if (items === '') return ''
      return `with ${items}:\n${body(block, gen)}`
    }
  },
  // ---------------------------------------------------------------------- raise
  {
    type: 'snakie_raise',
    category: 'control',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'raise %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Stop, and report a problem the code around this cannot handle. With nothing plugged in it re-raises the error being handled, which is what a bare `raise` inside an `except` does.'
    },
    // AN EMPTY SOCKET IS A BARE `raise`, exactly as it is on the return block: a
    // bare `raise` inside an `except` re-raises what is being handled, which is a
    // complete and common statement rather than a socket somebody forgot.
    code: (block, gen) => {
      const value = gen.valueToCode(block, 'VALUE', Order.NONE)
      return value === '' ? 'raise\n' : `raise ${value}\n`
    }
  }
]

/** What a `try` block is holding: its arms, and whether it has the two tails. */
export interface TryState {
  /** One entry per `except` arm — the exception spec, `''` for a bare one. */
  excepts: string[]
  hasElse: boolean
  hasFinally: boolean
}

/** A `try` block's state, read back off the block. */
function tryState(block: Blockly.Block): TryState {
  return (block as unknown as { tryState_: TryState }).tryState_
}

/** Anything, as a `TryState` — a saved file, a toolbox entry, a partial. */
function readTryState(state: unknown): TryState {
  const raw = (state ?? {}) as Partial<TryState>
  const excepts = Array.isArray(raw.excepts) ? raw.excepts.map((e) => String(e)) : []
  return {
    // A `try` with no `except` and no `finally` is not valid Python, so a block
    // with neither gets one empty `except` rather than nothing.
    excepts: excepts.length > 0 || raw.hasFinally ? excepts : [''],
    hasElse: Boolean(raw.hasElse),
    hasFinally: Boolean(raw.hasFinally)
  }
}

/**
 * The `try` block's shape, built in code because its arms come and go.
 *
 * ONE STATEMENT INPUT PER ARM, named so the layout estimator in
 * `python-to-blocks.ts` can see them: `TRY`, `DO0…DOn`, `ELSE`, `FINALLY`. A
 * statement body adds height to a root and a value socket does not, and a root
 * measured short is a root the next one is drawn on top of (#1062).
 */
function tryBlockMixin(): Record<string, unknown> {
  return {
    tryState_: { excepts: [], hasElse: false, hasFinally: false } as TryState,

    init(this: Blockly.Block): void {
      this.setStyle('control_blocks')
      this.appendDummyInput('HEAD').appendField('try')
      this.appendStatementInput('TRY')
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setTooltip(
        'Try something that might go wrong, and say what to do when it does.'
      )
      ;(this as unknown as { updateShape_: (s: TryState) => void }).updateShape_({
        excepts: [''],
        hasElse: false,
        hasFinally: false
      })
    },

    saveExtraState(this: Blockly.Block): TryState {
      return tryState(this)
    },

    loadExtraState(this: Blockly.Block, state: unknown): void {
      ;(this as unknown as { updateShape_: (s: TryState) => void }).updateShape_(
        readTryState(state)
      )
    },

    /** Rebuild the arms. Whole rather than diffed — a `try` is never half-edited. */
    updateShape_(this: Blockly.Block, state: TryState): void {
      const self = this as unknown as { tryState_: TryState }
      for (let i = 0; i < (self.tryState_?.excepts.length ?? 0); i++) {
        this.removeInput(`EXCEPT${i}`, true)
        this.removeInput(`DO${i}`, true)
      }
      this.removeInput('ELSE_LABEL', true)
      this.removeInput('ELSE', true)
      this.removeInput('FINALLY_LABEL', true)
      this.removeInput('FINALLY', true)
      state.excepts.forEach((spec, i) => {
        this.appendDummyInput(`EXCEPT${i}`)
          .appendField('except')
          .appendField(new Blockly.FieldTextInput(spec), `EXCEPT${i}`)
        this.appendStatementInput(`DO${i}`)
      })
      if (state.hasElse) {
        this.appendDummyInput('ELSE_LABEL').appendField('otherwise')
        this.appendStatementInput('ELSE')
      }
      if (state.hasFinally) {
        this.appendDummyInput('FINALLY_LABEL').appendField('and in any case')
        this.appendStatementInput('FINALLY')
      }
      self.tryState_ = state
    }
  }
}

/** Register the blocks whose inputs come and go. Called before the definitions. */
export function installStructureBlocks(): void {
  Blockly.Blocks[TRY_BLOCK] = tryBlockMixin() as never
}
