import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition, BlockGroup } from '../registry'
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

/**
 * The Control sub-drawer error handling lives in (#1131, epic #1119).
 *
 * Control is the honest category — `try` really is control flow — and putting
 * the two blocks loose in it takes a seven-block drawer to nine, half of which
 * a first-day learner has no use for. A shelf keeps `forever`, `repeat` and
 * `if` the first things in the flyout, which is what #1013's ordering argument
 * was about, and gives the pair a name that says when to reach for them.
 */
const WHEN_WRONG: BlockGroup = { id: 'when-wrong', name: 'When things go wrong' }

/**
 * The Functions sub-drawer classes live in (#1220, epic #1206).
 *
 * EPIC #1206's OPEN QUESTION 2, ANSWERED: a shelf inside Functions rather than a
 * top-level `classes` category with a colour of its own. A class is a named
 * group of steps with a name in front of it — the same idea Functions is
 * already about — and a tenth top-level category, one a simple-mode learner
 * would never see open, is a bigger claim on the toolbox than three blocks
 * earn. The shelf is also the cheap decision: promoting it later is a category
 * entry and a token, and nothing a saved workspace can notice.
 *
 * THE HINT is the drawer's own sentence, because three blocks and no verbs
 * reads like a drawer somebody forgot to finish. It says what the shelf is FOR
 * rather than listing what is on it, which is the job the `My parts` and
 * `Plugins` hints already do one level up.
 */
export const CLASSES: BlockGroup = {
  id: 'classes',
  name: 'Classes',
  hint: 'A class is a kind of thing. Build one here, and use `self` inside it for the particular one a method was called on.'
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
    // DRAGGABLE SINCE #1220 (epic #1206, track B). W6 registered it `hidden`,
    // on §4.5's rule that the reader is comprehensive and the toolbox curated.
    // The simple/advanced switch (#1209/#1210) is what makes the answer change:
    // "not in a ten-year-old's first drawer" is now a tier rather than a
    // deletion, so a class can be offered to the learner who has turned the
    // advanced blocks on without ever appearing in front of the one who has not.
    type: 'snakie_class',
    level: 'advanced',
    category: 'functions',
    group: CLASSES,
    help: 'ref-classes',
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
      message0: '%1 %2 %3 ( %4 )',
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
        {
          // `async` IS THE SAME KIND OF MODIFIER (W9, #1096), which is the whole
          // argument for scheduling async last: once W6 had built a method block
          // with settings on it, `async def` was one more setting rather than a
          // new shape. A block saved before this field existed has no `KIND` and
          // gets the first option, which is what it always meant.
          type: 'field_dropdown',
          name: 'KIND',
          options: [
            ['def', 'SYNC'],
            ['async def', 'ASYNC']
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
      const async = block.getFieldValue('KIND') === 'ASYNC' ? 'async ' : ''
      const params = String(block.getFieldValue('PARAMS') ?? '').trim()
      return `${at}${async}def ${nameOf(block, 'NAME', 'go')}(${params}):\n${body(block, gen)}`
    }
  },
  // ---------------------------------------------------------------------- self
  {
    // DRAGGABLE SINCE #1220, beside the class block it belongs to: a class with
    // no way to say `self` is a class whose methods cannot touch it.
    type: 'snakie_self',
    level: 'advanced',
    category: 'functions',
    group: CLASSES,
    help: 'ref-classes',
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
    // DRAGGABLE SINCE #1131 (epic #1119). W7 built it and registered it
    // `hidden: true`, on the rule §4.5 states: the reader is comprehensive and
    // the toolbox is curated, and most of the time the answer is no.
    //
    // #1119 re-took that decision, and `try` is the strongest candidate in the
    // hidden set. Error handling is not an advanced topic on hardware — it is
    // the difference between a robot that stops dead when a sensor is unplugged
    // and one that carries on — and `KeyboardInterrupt` is how you get out of a
    // `while True:` cleanly, which is the first thing anybody hits.
    //
    // FLIPPING THE FIELD WAS NOT THE WORK. The wording was: `try`, `except`,
    // `finally` are Python's words and not a child's, so the block says what it
    // MEANS and the mirror shows the translation — the same job `is nothing`
    // does for `is None`.
    //
    // THE FLYOUT COPY NAMES AN ERROR KIND, and that is a safety decision rather
    // than a default. A bare `except:` catches `KeyboardInterrupt` too, which
    // makes a program you cannot Ctrl-C out of — the worst possible first
    // experience of this block. `OSError` is what an unplugged sensor raises.
    type: TRY_BLOCK,
    category: 'control',
    group: WHEN_WRONG,
    help: 'ref-exceptions',
    // No `json`: the arms come and go, so the shape is built in
    // `installStructureBlocks` — the same reason the call blocks are.
    toolbox: { extraState: { excepts: ['OSError'], hasElse: false, hasFinally: false } },
    code: (block, gen) => {
      const state = tryState(block)
      const arm = (name: string): string =>
        gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
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
      message0: '%1 %2',
      args0: [
        // The same modifier trick as the method block (W9, #1096): `async with`
        // is 8 projects, and it is one setting rather than a second block.
        {
          type: 'field_dropdown',
          name: 'KIND',
          options: [
            ['with', 'SYNC'],
            ['async with', 'ASYNC']
          ]
        },
        { type: 'field_input', name: 'ITEMS', text: 'open(path) as handle' }
      ],
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
      const async = block.getFieldValue('KIND') === 'ASYNC' ? 'async ' : ''
      return `${async}with ${items}:\n${body(block, gen)}`
    }
  },
  // ---------------------------------------------------------------------- await
  //
  // TWO SHAPES OF ONE KEYWORD (W9, #1096), which is the same pair
  // `snakie_python_call` and `snakie_python_call_value` already are: `await` is
  // a statement on a line of its own (`await asyncio.sleep(1)`) and an
  // expression inside something else (`data = await sensor.read()`), and a
  // Blockly block has an output or a pair of statement connections, never both.
  {
    type: 'snakie_await',
    category: 'control',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'await %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Wait for something that takes time, and let the rest of the program run while it does. Only inside an `async def`.'
    },
    code: (block, gen) => `await ${gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'}\n`
  },
  {
    type: 'snakie_await_value',
    category: 'control',
    help: 'ref-functions',
    hidden: true,
    json: {
      message0: 'await %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      output: null,
      tooltip: 'Wait for something that takes time, and use what it gives back.'
    },
    // `await x` binds looser than a call and tighter than arithmetic; Python
    // puts it at unary-operator level, which is what this is.
    code: (block, gen) => [
      `await ${gen.valueToCode(block, 'VALUE', Order.UNARY_SIGN) || 'None'}`,
      Order.UNARY_SIGN
    ]
  },
  // ---------------------------------------------------------------------- raise
  {
    // DRAGGABLE SINCE #1131, beside the block that catches what it throws. The
    // two belong in one drawer: a learner who has just met "if that goes wrong"
    // is one step from "stop, and say what went wrong".
    type: 'snakie_raise',
    category: 'control',
    group: WHEN_WRONG,
    help: 'ref-exceptions',
    json: {
      message0: 'report a problem %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Stop, and report a problem the code around this cannot handle — Python writes it `raise`. With nothing plugged in it reports the problem being handled again, which is what a bare `raise` inside an "if that goes wrong" does.'
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
      // "try to" rather than "try": the block says what it MEANS and the mirror
      // shows `try:`, which is the translation the mirror is there to make
      // (#1131). Python's own words are in the tooltip, so the graduation is
      // visible rather than sprung.
      this.appendDummyInput('HEAD').appendField('try to')
      this.appendStatementInput('TRY')
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setTooltip(
        'Try something that might go wrong — a sensor that may be unplugged, a network that may be down — and say what to do when it does. Python calls this try / except / finally.'
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
      this.removeInput('ARMS', true)
      state.excepts.forEach((spec, i) => {
        this.appendDummyInput(`EXCEPT${i}`)
          // The learner's words on the face; `except` in the mirror.
          .appendField(i === 0 ? 'if that goes wrong' : 'or if it goes wrong')
          .appendField(new Blockly.FieldTextInput(spec), `EXCEPT${i}`)
        this.appendStatementInput(`DO${i}`)
      })
      if (state.hasElse) {
        this.appendDummyInput('ELSE_LABEL').appendField('if nothing went wrong')
        this.appendStatementInput('ELSE')
      }
      if (state.hasFinally) {
        this.appendDummyInput('FINALLY_LABEL').appendField('either way, afterwards')
        this.appendStatementInput('FINALLY')
      }
      // THE ARMS HAVE TO BE REACHABLE (#1131). W7 built `updateShape_` for the
      // READER, which knows how many arms a file has; a learner dragging this
      // out of a flyout had one `except` and no way to ask for another, or for
      // a `finally`. Four buttons at the foot of the block say so.
      //
      // FieldImage BUTTONS RATHER THAN A CHECKBOX, and rather than Blockly's
      // gear mutator, for the two reasons `python.ts` gives: the gear opens a
      // miniature workspace in a bubble with nothing else like it in the app,
      // and a click handler that rebuilds the block is a shape this codebase
      // already runs safely. A checkbox validator would be disposed mid-update
      // by the very rebuild it asked for.
      this.appendDummyInput('ARMS')
        .appendField(
          new Blockly.FieldImage(armIcon('+'), 16, 16, 'another "if that goes wrong"', () =>
            rebuild(this, { ...state, excepts: [...state.excepts, ''] })
          ),
          'ADD_EXCEPT'
        )
        .appendField(
          new Blockly.FieldImage(armIcon('-'), 16, 16, 'one fewer', () =>
            rebuild(this, {
              ...state,
              // NEVER TO ZERO. A `try` with no `except` and no `finally` is not
              // valid Python, and `readTryState` already puts one back — which
              // would make the button look like it did nothing.
              excepts:
                state.excepts.length > 1 || state.hasFinally
                  ? state.excepts.slice(0, -1)
                  : state.excepts
            })
          ),
          'REMOVE_EXCEPT'
        )
        .appendField(
          new Blockly.FieldImage(
            armIcon(state.hasElse ? 'on' : 'off'),
            16,
            16,
            'show "if nothing went wrong"',
            () => rebuild(this, { ...state, hasElse: !state.hasElse })
          ),
          'TOGGLE_ELSE'
        )
        .appendField('if nothing went wrong')
        .appendField(
          new Blockly.FieldImage(
            armIcon(state.hasFinally ? 'on' : 'off'),
            16,
            16,
            'show "either way, afterwards"',
            () => rebuild(this, { ...state, hasFinally: !state.hasFinally })
          ),
          'TOGGLE_FINALLY'
        )
        .appendField('either way')
      self.tryState_ = state
    }
  }
}

/**
 * Rebuild a `try` block's arms, keeping the text already typed into them.
 *
 * `updateShape_` tears every arm down and puts it back, which would otherwise
 * lose the exception kinds a learner has written — the fields are recreated
 * from `state.excepts`, so the state has to carry them.
 */
function rebuild(block: Blockly.Block, next: TryState): void {
  const excepts = next.excepts.map((spec, i) => {
    const typed = block.getField(`EXCEPT${i}`)
    return typed ? String(typed.getValue() ?? spec) : spec
  })
  ;(block as unknown as { updateShape_: (s: TryState) => void }).updateShape_({
    ...next,
    excepts
  })
}

/**
 * The little buttons at the foot of the `try` block, as data URIs.
 *
 * The same visual language as the `+`/`−` steppers on the growable blocks —
 * a pale disc with a glyph — so the two read as one mechanism.
 */
function armIcon(kind: '+' | '-' | 'on' | 'off'): string {
  const glyph = {
    '+': '<path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    '-': '<path d="M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    on: '<path d="M4.5 8.5l2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    off: ''
  }[kind]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.22)"/>${glyph}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Register the blocks whose inputs come and go. Called before the definitions. */
export function installStructureBlocks(): void {
  Blockly.Blocks[TRY_BLOCK] = tryBlockMixin() as never
}
