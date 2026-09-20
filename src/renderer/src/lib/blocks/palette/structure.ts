import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition, BlockGroup } from '../registry'
import { sanitise } from '../names'
import { DEFAULT_ARGS, argRowMixin, callArgs } from './python'
import {
  appendExtrasRow,
  EXTRAS_FIELD,
  EXTRAS_INPUT,
  extrasText,
  splitMethodSignature,
  type MethodLead
} from '../params'
import { methodLead } from '../signature'

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

/** The same, for the create-an-instance block (B5, #1224). */
export const NEW_INSTANCE = 'snakie_new_instance'

/** The property block's type, named here because the reader builds one too. */
export const PROPERTY_BLOCK = 'snakie_property'
/** The tick box that says this property can be set as well as read. */
export const HAS_SETTER = 'HAS_SETTER'
/** The row holding the setter's parameter name, hidden while the box is off. */
const SETTER_ROW = 'SETTER_ROW'
/** The extension that ties that tick box to the two rows it shows. */
const PROPERTY_SETTER_EXTENSION = 'snakie_property_setter'

/** Is the setter half of this property block switched on? */
function hasSetter(block: Blockly.Block): boolean {
  return block.getFieldValue(HAS_SETTER) === 'TRUE'
}

/**
 * Show or hide the setter's two rows. Called when the box is ticked, and once
 * as each block is built — including one being deserialised, whose field takes
 * its saved value through the same validator.
 */
function setSetterVisible(block: Blockly.Block, visible: boolean): void {
  let changed = false
  for (const name of [SETTER_ROW, 'SET']) {
    const input = block.getInput(name)
    if (!input || input.isVisible() === visible) continue
    input.setVisible(visible)
    changed = true
  }
  if (changed) (block as Blockly.BlockSvg).queueRender?.()
}

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
    // A CLASS ARRIVES WITH ITS `__init__` ALREADY IN IT (B5, #1224).
    //
    // An empty class is not a class anybody can use: the first thing every
    // learner has to do with one is write the method that makes a Thing, and
    // `def __init__(self):` is a line nothing in the drawer hints at — the
    // dunder name least of all. Seeding it means the block that comes out of
    // the flyout is a class you can already create one of.
    //
    // A REAL BLOCK RATHER THAN A SHADOW, because a shadow disappears the moment
    // anything is dropped on it and a learner filling the body would lose the
    // constructor they were given. It is a toolbox preset, which is the other
    // half of the rule: the seed is what the FLYOUT hands out, so a class read
    // back from a file — empty or not — is untouched.
    toolbox: {
      inputs: {
        BODY: {
          block: {
            type: 'snakie_method',
            // The rebuilt method block's own shape (#1221): `self` is the
            // fixed lead in the `extraState` rather than text in a field.
            extraState: { lead: 'self', params: [] },
            fields: { DECORATOR: 'NONE', KIND: 'SYNC', NAME: '__init__' }
          }
        }
      }
    },
    code: (block, gen) => {
      const bases = String(block.getFieldValue('BASES') ?? '').trim()
      return `class ${nameOf(block, 'NAME', 'Thing')}${bases}:\n${body(block, gen)}`
    }
  },
  // -------------------------------------------------------------------- method
  {
    // DRAGGABLE SINCE #1221 (B2, epic #1206), on the Classes shelf B1 built.
    // B1 left it hidden deliberately: a method block whose whole signature was
    // one free-text box is a block a learner has to already know Python to
    // fill in, and offering it before it had a real parameter list would have
    // put `self` — the one name they must not rename — in an editable field
    // with nothing to say so.
    type: 'snakie_method',
    category: 'functions',
    group: CLASSES,
    help: 'ref-classes',
    // No `json`: the parameters come and go, so the shape is built in
    // `installStructureBlocks` — the same reason the `try` block's arms are.
    toolbox: { extraState: { params: [], lead: 'self' } },
    code: (block, gen) => {
      const decorator = String(block.getFieldValue('DECORATOR') ?? 'NONE')
      const at = decorator === 'NONE' ? '' : `@${decorator}\n`
      const async = block.getFieldValue('KIND') === 'ASYNC' ? 'async ' : ''
      return `${at}${async}def ${nameOf(block, 'NAME', 'go')}(${methodSignature(block)}):\n${body(block, gen)}`
    }
  },
  // ------------------------------------------------------------------ property
  {
    // A PROPERTY IS A PAIR OF METHODS AND ONE IDEA (B3, #1222, epic #1206).
    //
    // `@property` is already a setting on `snakie_method`, which is enough to
    // READ a getter and enough to build one. What it cannot do is hold the
    // other half: a settable property is `@property def x(self)` and
    // `@x.setter def x(self, value)` — two methods whose names must agree,
    // whose decorators must agree, and which mean nothing apart. As two method
    // blocks either can be dragged away from the other, and renaming one
    // silently breaks the pair.
    //
    // So ONE block, with the name written once and used in both lines, and the
    // setter behind a tick box: a read-only property is the common case, and
    // the row for the new value is not on the block until it has a job.
    type: PROPERTY_BLOCK,
    level: 'advanced',
    category: 'functions',
    group: CLASSES,
    help: 'ref-classes',
    json: {
      message0: 'property %1 can be set too %2',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'name' },
        { type: 'field_checkbox', name: HAS_SETTER, checked: false }
      ],
      message1: 'when it is read %1',
      args1: [{ type: 'input_statement', name: 'GET' }],
      // The setter's parameter as a FIELD: `value` is the convention, and a
      // learner who would rather say `speed` can — the same trade the method
      // block's PARAMS field makes.
      message2: 'when it is set, call the new value %1 %2',
      args2: [
        { type: 'field_input', name: 'PARAM', text: 'value' },
        { type: 'input_dummy', name: SETTER_ROW }
      ],
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'SET' }],
      // THE ROWS COME AND GO BY VISIBILITY, not by being added and removed —
      // the `def` block's extra-parameters row (`functions.ts`) rather than the
      // `try` block's rebuild. A hidden input keeps what is plugged into it, so
      // unticking the box and ticking it again gives back the setter body the
      // learner wrote.
      extensions: [PROPERTY_SETTER_EXTENSION],
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'A value on this class that is worked out by running some steps — read it like `thing.name`, with no brackets. Tick the box to let it be set as well.'
    },
    code: (block, gen) => {
      const name = nameOf(block, 'NAME', 'value')
      const arm = (input: string): string =>
        gen.statementToCode(block, input) || `${gen.INDENT}pass\n`
      const getter = `@property\ndef ${name}(self):\n${arm('GET')}`
      if (!hasSetter(block)) return getter
      // ONE BLANK LINE BETWEEN THE TWO — what PEP 8 puts between two methods,
      // and what the reader requires before it will fold a pair back into this
      // block. So what this writes is exactly what reading it gives back.
      const param = nameOf(block, 'PARAM', 'value')
      return `${getter}\n@${name}.setter\ndef ${name}(self, ${param}):\n${arm('SET')}`
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
  },
  // ------------------------------------------------------------ create <Class>
  {
    // `robot = Robot("Bob", speed=3)` (B5, #1224) — the other half of a class.
    // Defining one is half the job; the line that makes one is the line a
    // learner writes next, and until now it was a grey block or a call block
    // whose "call … on …" face is about METHODS and has no object to take.
    //
    // NO `json`: the arguments come and go, so the shape is built in
    // `installStructureBlocks` the way the `try` and `call` blocks are.
    type: NEW_INSTANCE,
    category: 'functions',
    help: 'ref-functions',
    level: 'advanced',
    code: (block, gen) => [`${instanceClass(block)}(${callArgs(block, gen)})`, Order.FUNCTION_CALL]
  }
]

/**
 * THE CLASS NAME IS A DROPDOWN OF THE CLASSES THIS PROGRAM DEFINES (#1224).
 * ---------------------------------------------------------------------------
 *
 * A class name is not free text in the way a method name on a grey call block
 * is: the class is right there on the canvas, and a learner who types `robto`
 * gets a `NameError` from the board rather than anything the editor could have
 * told them. So the field offers what the workspace has.
 *
 * AND FALLS BACK TO A TEXT BOX, which is not a nicety either — a workspace with
 * no class block in it yet (a class in a module this file imports, a program
 * being built top-down) would otherwise have an empty menu and no way to say
 * any name at all. The last entry in the menu is "type a name…", and choosing
 * it reveals the text field beside the dropdown; that is the same
 * show-it-when-it-holds-something mechanism the call block's keyword-name boxes
 * use (#1163), for the same reason: a box that is empty and inert is worse than
 * no box.
 *
 * LIKE `FieldPin`, IT NEVER REJECTS A VALUE. A file naming a class the reader
 * has not built a block for yet — the block is loaded before its class, or the
 * class lives in another file — keeps saying what it says, rather than being
 * silently reset to whatever happens to be first in the menu.
 */
const TYPE_A_NAME = 'type a name…'

/**
 * The dropdown value that means "the text box beside me holds the name".
 *
 * A `!` because no Python identifier can contain one: whatever a learner calls
 * their class, it can never collide with this sentinel and turn a real name
 * into the text box.
 */
const OWN_NAME = '!own'

/** The fields the block's head carries: the menu, and the box behind it. */
const CLASS_FIELD = 'CLASS'
const TYPED_FIELD = 'TYPED'

/** What a class is called when nothing says otherwise. */
const DEFAULT_CLASS = 'Thing'

/** Every class this workspace defines, in the order the canvas holds them. */
function classNames(workspace: Blockly.Workspace | null): string[] {
  if (!workspace) return []
  const names: string[] = []
  for (const block of workspace.getBlocksByType('snakie_class', false)) {
    const name = String(block.getFieldValue('NAME') ?? '').trim()
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** The menu: this program's classes, whatever the field holds, then the box. */
function classOptions(this: Blockly.FieldDropdown): Blockly.MenuOption[] {
  const names = classNames(this.getSourceBlock()?.workspace ?? null)
  const held = String(this.getValue() ?? '')
  if (held !== '' && held !== OWN_NAME && !names.includes(held)) names.push(held)
  return [...names.map((name): Blockly.MenuOption => [name, name]), [TYPE_A_NAME, OWN_NAME]]
}

/** A dropdown of the workspace's classes that will take any name it is given. */
class FieldClassName extends Blockly.FieldDropdown {
  constructor() {
    super(classOptions)
  }

  /** Accept a class this workspace has no block for. See the note above. */
  protected override doClassValidation_(value?: string): string | null {
    return value === undefined || value === null ? null : String(value)
  }

  /** The name, or the invitation to type one. */
  override getText(): string {
    const value = String(this.getValue() ?? '')
    return value === OWN_NAME ? TYPE_A_NAME : value
  }
}

/**
 * Show the text box exactly when the menu is standing aside for it.
 *
 * NOTHING HAPPENS WHEN NOTHING CHANGED, which matters because `onchange` runs
 * this for every event on the workspace: a re-render queued on each of them
 * would be a block redrawn while somebody drags another one past it.
 */
function applyTypedName(block: Blockly.Block): void {
  const typed = block.getField(TYPED_FIELD)
  const wanted = block.getFieldValue(CLASS_FIELD) === OWN_NAME
  if (!typed || typed.isVisible() === wanted) return
  typed.setVisible(wanted)
  ;(block as Blockly.BlockSvg).queueRender?.()
}

/** The class being created: the menu's choice, or the box behind it. */
function instanceClass(block: Blockly.Block): string {
  const chosen = String(block.getFieldValue(CLASS_FIELD) ?? '')
  const raw = chosen === OWN_NAME ? String(block.getFieldValue(TYPED_FIELD) ?? '') : chosen
  // `sanitise`, not `toPythonIdentifier`, for the reason {@link nameOf} gives:
  // a class somebody called `Property` is theirs to call that.
  const name = raw.trim()
  return name === '' ? DEFAULT_CLASS : sanitise(name)
}

/**
 * The create-instance block's shape: a class name, then the call block's own
 * growable argument row — the same `+`/`−` steppers and the same keyword-name
 * boxes, so `Robot("Bob", speed=3)` is built the way every other call is.
 */
function newInstanceMixin(): Record<string, unknown> {
  return {
    ...argRowMixin(),

    init(this: Blockly.Block): void {
      this.setStyle('functions_blocks')
      this.appendDummyInput('HEAD')
        .appendField('create')
        // Cast because `appendField` is typed for a field whose value may be
        // undefined and `FieldDropdown`'s never is; the dropdown IS one of the
        // fields it takes, as every JSON `field_dropdown` in the palette is.
        .appendField(new FieldClassName() as unknown as Blockly.Field, CLASS_FIELD)
        .appendField(new Blockly.FieldTextInput(DEFAULT_CLASS), TYPED_FIELD)
      this.setInputsInline(true)
      this.setOutput(true, null)
      this.setTooltip(
        'Make one of a kind of thing — a new Robot, a new Dog — and hand it whatever its `__init__` asks for.'
      )
      ;(this as unknown as { updateArgs_: (n: number) => void }).updateArgs_(DEFAULT_ARGS)
      // A CLASS ALREADY ON THE CANVAS IS THE ANSWER MOST OF THE TIME, so the
      // block arrives holding the first one rather than the text box. In a
      // flyout there are no class blocks, so it arrives ready to be typed into.
      const first = classNames(this.workspace)[0]
      this.setFieldValue(first ?? OWN_NAME, CLASS_FIELD)
      applyTypedName(this)
    },

    /** The text box follows the menu, whoever moved it — a load, or a learner. */
    loadExtraState(this: Blockly.Block, state: { args?: number }): void {
      ;(argRowMixin().loadExtraState as (this: Blockly.Block, s: unknown) => void).call(this, state)
      applyTypedName(this)
    },

    onchange(this: Blockly.Block): void {
      applyTypedName(this)
    }
  }
}

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

// ---------------------------------------------------------------------------
// The method block's parameter list (B2, #1221, epic #1206)
// ---------------------------------------------------------------------------

/** The block type, named here because the palette and the reader both want it. */
export const METHOD_BLOCK = 'snakie_method'

/** What a method block is holding: its fixed lead, and its plain parameters. */
export interface MethodState {
  /** `self`, `cls`, or none at all. Shown on the block, never editable. */
  lead: MethodLead
  /** One editable name field each — `PARAM0`, `PARAM1`, … */
  params: string[]
}

/** A method block's state, read back off the block. */
function methodState(block: Blockly.Block): MethodState {
  return (block as unknown as { methodState_: MethodState }).methodState_ ?? {
    lead: 'self',
    params: []
  }
}

/** Anything, as a `MethodState` — a saved file, a toolbox entry, a partial. */
function readMethodState(state: unknown): MethodState {
  const raw = (state ?? {}) as Partial<MethodState>
  const lead = raw.lead === 'cls' || raw.lead === 'none' ? raw.lead : 'self'
  return {
    lead,
    params: Array.isArray(raw.params) ? raw.params.map((p) => String(p)) : []
  }
}

/** The parameter list a method block writes: lead, names, extras — in order. */
function methodSignature(block: Blockly.Block): string {
  const state = methodState(block)
  const lead = methodLead(state.lead, String(block.getFieldValue('DECORATOR') ?? 'NONE'))
  const names = state.params
    .map((_, i) => String(block.getFieldValue(`PARAM${i}`) ?? '').trim())
    // A NAME FIELD EMPTIED IS A PARAMETER REMOVED, not `def go(self, ):`. The
    // `−` button is the way to take one off, and a half-finished rename should
    // not write a syntax error into the mirror while it is happening.
    .filter((name) => name !== '')
    .map((name) => sanitise(name))
  // THE EXTRAS VERBATIM, trailing comma and all — unlike the `def` blocks,
  // which tidy one away. A `def load(path,):` the reader could not split at all
  // lands here whole, and this is the block that promises to give it back.
  const extras = extrasText(block)
  return [...(lead === 'none' ? [] : [lead]), ...names, ...(extras === '' ? [] : [extras])].join(
    ', '
  )
}

/**
 * The old free-text `PARAMS` field, migrated the moment a saved file sets it.
 *
 * EVERY WORKSPACE SAVED BEFORE #1221 carries `PARAMS: 'self, path, flip_x=None'`
 * and no parameter list at all, so the block keeps the field — invisible, and
 * spent as soon as it is filled. Splitting on load is exactly what the reader
 * does with a `def` header, which is why both call the same splitter.
 *
 * THE FIELD IS EMPTIED once it has been read, so the block that gets saved back
 * is a new-shaped one and the migration never runs twice — a second run after a
 * learner had edited the parameters would put the old signature back.
 */
class LegacyParamsField extends Blockly.FieldLabel {
  constructor() {
    super('')
  }

  // `loadState`, NOT a validator: this has to fire for the value a saved file
  // gives the field and for nothing else. An empty `PARAMS` is a real old
  // signature — `def go():` — and a validator could not tell it apart from the
  // blank the field is constructed with.
  //
  // A FieldLabel is not serialisable, so the migrated block saves no `PARAMS`
  // at all and the migration can never run a second time over a learner's
  // edits.
  override loadState(state: unknown): void {
    const { lead, params, extras } = splitMethodSignature(String(state ?? ''))
    const block = this.getSourceBlock()
    if (!block) return
    updateMethodShape(block, { lead, params })
    block.setFieldValue(extras, EXTRAS_FIELD)
  }
}

/**
 * THE METHOD BLOCK, REBUILT (B2, #1221, epic #1206).
 *
 * W6 (#1093) gave it one free-text field for the whole signature, and the
 * argument was sound as far as it went: `procedures_def`'s parameters ARE
 * workspace variables, so a default or a `*args` could not live on it and
 * `def load(path, flip_x=None)` came back as `def load(path)`. A text box holds
 * any signature exactly.
 *
 * WHAT IT COST was the block nobody could be offered. A learner dragging it out
 * of a drawer got a box saying `self` and no way to know what else may go in
 * it, `self` itself was editable — rename it here and the eleven `self.`
 * blocks in the body mean nothing — and #1134's extras machinery, built for
 * exactly the half of a signature a name field cannot hold, was sitting one
 * file away being used by `def` alone.
 *
 * So: one editable field per plain name with `+`/`−` at the end of the row,
 * `self` as a LABEL that no click can reach, and the shared extras row for the
 * rest. The lead follows the decorator — `@staticmethod` takes none,
 * `@classmethod` takes `cls` — which is the one thing a learner would otherwise
 * have to know to go and do by hand.
 *
 * BUILT IN CODE rather than from JSON, and with `+`/`−` buttons rather than
 * Blockly's gear, for the reasons the `try` block above records: the gear opens
 * a miniature workspace in a bubble with nothing else like it in the app, and a
 * field count that comes and goes is not a shape JSON can declare.
 */
function methodBlockMixin(): Record<string, unknown> {
  return {
    methodState_: { lead: 'self', params: [] } as MethodState,

    init(this: Blockly.Block): void {
      this.setStyle('functions_blocks')
      this.appendDummyInput('HEAD')
        .appendField(
          // `@property` AS A MODIFIER, not a block of its own (#1093). A
          // decorator on its own line would be a block that means nothing
          // without the block under it, and could be dragged away from it.
          // A1 (#1215) folds this dropdown into a decorators list; until it
          // lands, the three Python has a setting for are the three here.
          new Blockly.FieldDropdown(
            [
              ['method', 'NONE'],
              ['property', 'property'],
              ['static method', 'staticmethod'],
              ['class method', 'classmethod']
            ],
            // The lead follows the setting, so the row is redrawn with the new
            // one. The STATE is untouched — a method read out of a file whose
            // signature has no lead never grows one.
            (value) => {
              if (this.getInput('PARAMS_ROW')) {
                updateMethodShape(this, methodState(this), String(value))
              }
              return undefined
            }
          ),
          'DECORATOR'
        )
        .appendField(
          // `async` IS THE SAME KIND OF MODIFIER (W9, #1096). A block saved
          // before this field existed has no `KIND` and gets the first option,
          // which is what it always meant.
          new Blockly.FieldDropdown([
            ['def', 'SYNC'],
            ['async def', 'ASYNC']
          ]),
          'KIND'
        )
        .appendField(new Blockly.FieldTextInput('go'), 'NAME')
      // The pre-#1221 signature, invisible and spent on load — see
      // {@link LegacyParamsField}.
      this.appendDummyInput('LEGACY').appendField(new LegacyParamsField(), 'PARAMS').setVisible(false)
      this.appendStatementInput('BODY')
      // #1134's row, shared rather than rebuilt (`../params.ts`), above the
      // body where the rest of the signature is.
      appendExtrasRow(this, 'BODY')
      this.setInputsInline(true)
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setTooltip(
        'Something this class can do. `self` is the particular thing it was called on — it is on the block rather than in a box because renaming it would break every `self.` inside.'
      )
      updateMethodShape(this, { lead: 'self', params: [] })
    },

    saveExtraState(this: Blockly.Block): MethodState {
      return methodState(this)
    },

    loadExtraState(this: Blockly.Block, state: unknown): void {
      updateMethodShape(this, readMethodState(state))
    }
  }
}

/**
 * Rebuild the parameter row.
 *
 * Whole rather than diffed, as the `try` block's arms are — and for the same
 * reason the `rebuild` below it exists, the names already typed into the fields
 * are read back out first so a `+` does not wipe them.
 */
function updateMethodShape(
  block: Blockly.Block,
  next: MethodState,
  decorator = String(block.getFieldValue('DECORATOR') ?? 'NONE')
): void {
  const self = block as unknown as { methodState_: MethodState }
  const state: MethodState = {
    lead: next.lead,
    params: next.params.map((name, i) => {
      const typed = block.getField(`PARAM${i}`)
      return typed ? String(typed.getValue() ?? name) : name
    })
  }
  block.removeInput('PARAMS_ROW', true)
  const row = block.appendDummyInput('PARAMS_ROW').appendField('(')
  const lead = methodLead(state.lead, decorator)
  // A LABEL, NOT A FIELD: `self` is the one name in a method a learner must not
  // rename, because the `self.` blocks in the body are not renamed with it.
  if (lead !== 'none') row.appendField(lead)
  state.params.forEach((name, i) => {
    if (i > 0 || lead !== 'none') row.appendField(',')
    row.appendField(new Blockly.FieldTextInput(name), `PARAM${i}`)
  })
  row
    .appendField(
      new Blockly.FieldImage(armIcon('+'), 16, 16, 'one more parameter', () =>
        updateMethodShape(block, { ...state, params: [...state.params, nextParamName(state)] })
      ),
      'ADD_PARAM'
    )
    .appendField(
      new Blockly.FieldImage(armIcon('-'), 16, 16, 'one fewer parameter', () =>
        updateMethodShape(block, { ...state, params: state.params.slice(0, -1) })
      ),
      'REMOVE_PARAM'
    )
    .appendField(')')
  // Above the extras row, which is the rest of the same signature, and so above
  // the body under it.
  if (block.getInput(EXTRAS_INPUT)) block.moveInputBefore('PARAMS_ROW', EXTRAS_INPUT)
  self.methodState_ = state
}

/** A name for a new parameter that is not one of the names already there. */
function nextParamName(state: MethodState): string {
  const taken = new Set(state.params)
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'value' : `value${n}`
    if (!taken.has(name)) return name
  }
}

/** Register the blocks whose inputs come and go. Called before the definitions. */
export function installStructureBlocks(): void {
  Blockly.Blocks[TRY_BLOCK] = tryBlockMixin() as never
  Blockly.Blocks[NEW_INSTANCE] = newInstanceMixin() as never
  Blockly.Blocks[METHOD_BLOCK] = methodBlockMixin() as never
  // The property block's tick box (#1222). An EXTENSION rather than a wrapped
  // `init`: the block itself is ordinary JSON, and a validator is the one thing
  // JSON cannot declare. Guarded, because `installCorePalette` runs again for
  // every test file and Blockly throws on a name it has already been given.
  if (!Blockly.Extensions.isRegistered(PROPERTY_SETTER_EXTENSION)) {
    Blockly.Extensions.register(PROPERTY_SETTER_EXTENSION, function (this: Blockly.Block) {
      this.getField(HAS_SETTER)?.setValidator((value: unknown) => {
        setSetterVisible(this, value === true || value === 'TRUE')
        return value
      })
      setSetterVisible(this, hasSetter(this))
    })
  }
}
