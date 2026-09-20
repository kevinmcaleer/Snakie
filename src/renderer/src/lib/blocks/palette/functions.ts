import { commentDocstring } from '../docstring'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { PyImport } from '../imports'
import type { BlockDefinition } from '../registry'
import * as Blockly from 'blockly/core'
import { registerCallRules } from '../python-to-blocks'
import { CLASSES } from './structure'
import {
  appendExtrasRow,
  EXTRAS_FIELD,
  EXTRAS_INPUT,
  extrasText,
  extrasVisible,
  hasExtrasRow,
  setExtrasVisible
} from '../params'

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
 * `*args` or a `**kwargs` has nowhere to live on it, so `def blink(times=3):`
 * could not be built and `def load(path, flip=None):` could not even be READ.
 *
 * SO THEY GO IN A FIELD, appended after the declared ones — and since B2
 * (#1221) that field, the row it hides in and the splitter that fills it live
 * in `../params.ts`, because the method block declares parameters too and
 * #1221 asks for one mechanism rather than two. What is left here is the line
 * that puts the two halves of a `def`'s signature together, and the re-exports
 * `BlocksCanvas.tsx` and the extras tests reach for.
 *
 * A DEFAULTED PARAMETER GETS NO CALLER SOCKET, which is correct rather than a
 * shortcoming: it is optional at the call site, which is the whole reason for
 * giving it a default.
 */
function signature(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const declared = params(block, gen)
  const extra = extrasText(block).replace(/,\s*$/, '')
  return [...declared, ...(extra === '' ? [] : [extra])].join(', ')
}

export { EXTRAS_FIELD, extrasVisible, hasExtrasRow, setExtrasVisible }

/**
 * DECORATORS, AS A LIST ON THE MUTATION (A1, #1215, epic #1206).
 * =============================================================================
 *
 * `@property`, `@micropython.native`, `@app.route("/")` — a decorator is not a
 * statement of its own. It belongs to the `def` under it, and a block for it
 * could be dragged away from the function it decorates, which is the same
 * argument `snakie_method` made when it put `@property` in a dropdown (#1093).
 * So the entries ride on the `def` block itself, as an ordered list.
 *
 * VERBATIM AND WITHOUT THE `@`, because the text between the `@` and the end of
 * the line is arbitrary Python — a dotted name, a call with arguments — and the
 * only representation that holds every form of it exactly is the text itself.
 * Storing the `@` too would mean deciding, on every read, whether a saved entry
 * had one.
 *
 * CARRIED IN THE MUTATION rather than in a field, because the list has no fixed
 * length and Blockly serialises exactly the fields a block declares. Both
 * halves of the serialisation are wrapped — the XML pair for old workspaces,
 * the JSON pair for new ones — around whatever the block already had, so the
 * procedure mutator's parameter list and the caller-rename bookkeeping go
 * through untouched. See {@link installDecorators}.
 */

/** The mutation attribute / JSON key the list is stored under. */
const DECORATORS_KEY = 'decorators'

/** The list, as it hangs off a block instance. */
interface DecoratedBlock {
  snakieDecoratorList_?: string[]
}

/** One entry, tidied: no leading `@`, no surrounding space. Blank entries go. */
function tidy(entries: readonly unknown[]): string[] {
  return entries
    .map((entry) =>
      String(entry ?? '')
        .trim()
        .replace(/^@+\s*/, '')
        .trim()
    )
    .filter((entry) => entry !== '')
}

/**
 * The decorators on a block, in the order they are written.
 *
 * THE OLD DROPDOWN IS READ AS A LIST OF ONE. `snakie_method` shipped with a
 * `DECORATOR` field (`property` / `staticmethod` / `classmethod`), and every
 * workspace saved since carries it. A block with no list of its own therefore
 * falls back to that field — so the migration happens the first time anything
 * asks, and the answer is persisted by the next save. B2 (#1216) removes the
 * field itself.
 */
export function getDecorators(block: Blockly.Block): string[] {
  const stored = (block as unknown as DecoratedBlock).snakieDecoratorList_
  if (stored) return [...stored]
  const legacy = String(block.getFieldValue(LEGACY_DECORATOR_FIELD) ?? '')
  return legacy === '' || legacy === 'NONE' ? [] : [legacy]
}

/**
 * Set the decorators on a block. Entries are tidied on the way in.
 *
 * EVERY WAY THE LIST CHANGES GOES THROUGH HERE — the cog, the right-click item,
 * and both halves of deserialisation — so this is the one place the `@` badge
 * (A3, #1217) needs to be brought back into step with it.
 */
export function setDecorators(block: Blockly.Block, entries: readonly string[]): void {
  ;(block as unknown as DecoratedBlock).snakieDecoratorList_ = tidy(entries)
  syncDecoratorBadge(block)
}

/** The dropdown `snakie_method` used to keep its one decorator in (#1093). */
export const LEGACY_DECORATOR_FIELD = 'DECORATOR'

/**
 * The entries that only work once something is imported.
 *
 * `@micropython.native` and `@micropython.viper` are the two a MicroPython
 * program actually reaches for, and both are a plain `import micropython` away
 * from working. Declared through the import manager like any other block's
 * `imports`, so they land in the file's head in the usual place rather than
 * being a rule the learner has to know.
 *
 * Keyed on the entry up to its first bracket, so `@micropython.viper` and a
 * decorator called with arguments are the same lookup.
 */
const DECORATOR_IMPORTS: Record<string, PyImport> = {
  'micropython.native': { module: 'micropython' },
  'micropython.viper': { module: 'micropython' }
}

/**
 * The `@…` lines for a block, ready to sit immediately above its `def`.
 *
 * Empty for a block with no decorators, so the `def` line is the first line of
 * the function and nothing about the source map changes for the programs that
 * have none. For the ones that do, the lines are part of the same emitted
 * chunk as the `def`, which is what keeps the block's own marker — and so the
 * traceback mapping and the hover highlight — on the first of them.
 */
export function decoratorLines(block: Blockly.Block, gen: MicroPythonGenerator): string {
  return getDecorators(block)
    .map((entry) => {
      const imp = DECORATOR_IMPORTS[entry.split('(')[0].trim()]
      if (imp) gen.need(imp)
      return `@${entry}\n`
    })
    .join('')
}

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
        `${decoratorLines(block, gen)}def ${name}(${signature(block, gen)}):\n${doc}${stack}`
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
      gen.defineFunction(
        block.id,
        `${decoratorLines(block, gen)}def ${name}(${signature(block, gen)}):\n${inner}`
      )
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
    level: 'advanced',
    category: 'functions',
    // On the Classes shelf since #1220, with the class block it names.
    group: CLASSES,
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
      // Above the body, where the rest of the signature is — appended, the row
      // would land at the bottom, under the `return` row.
      appendExtrasRow(this, 'STACK')
    }
    def.snakieExtras_ = true
  }
  installDecorators(['procedures_defnoreturn', 'procedures_defreturn'])
  // The editing UI (A3, #1217): the Decorators section in the cog, and the
  // badge row. After the extras wrap, so the badge lands above the extras row.
  installDecoratorCss()
  installDecoratorMutator(['procedures_defnoreturn', 'procedures_defreturn'])
}

/**
 * Give a block with no parameter mutator of its own a DECORATORS-ONLY cog.
 *
 * WHY THIS IS NOT {@link installDecoratorMutator}: that one wraps a
 * `decompose`/`compose` pair Blockly already put on the block, and appends our
 * section to the container it builds. `snakie_method` has no such pair. Since
 * B2 (#1221) it is built in code with one text field per parameter and `+`/`−`
 * buttons on the row (see `palette/structure.ts`), so there is no mini-workspace
 * for the parameters at all — the cog it grows here holds the decorators and
 * nothing else, and opens on {@link DECORATORS_CONTAINER_BLOCK}.
 *
 * A1 (#1215) did this through a `snakie_decorators` mutator EXTENSION, which
 * was right while the block was declared as JSON and the decorator list was the
 * whole of its extra state. It cannot be right now: the rebuilt block has a
 * `saveExtraState` pair of its own for `{ lead, params }`, a second registered
 * mutator would replace it rather than sit beside it, and `installDecorators`
 * already folds `decorators` into that state. So only the EDITING half is
 * installed here — hooks that Blockly's serialisation never looks at.
 *
 * `before` names the inputs the badge row should sit above, first one that
 * exists winning, for the reason {@link addBadgeRow} gives.
 *
 * Idempotent, like every other installer in this file: `installCorePalette`
 * runs once per test file and `Blockly.Blocks` is not reset between them.
 */
export function installDecoratorCog(
  types: readonly string[],
  before: readonly string[] = ['PARAMS_ROW', EXTRAS_INPUT, 'BODY']
): void {
  installDecoratorMutatorBlocks()
  installDecoratorCss()
  for (const type of types) {
    const def = Blockly.Blocks[type] as unknown as
      | {
          init?: (this: Blockly.Block) => void
          decompose?: (this: Blockly.Block, ws: Blockly.Workspace) => Blockly.Block
          compose?: (this: Blockly.Block, container: Blockly.Block) => void
          snakieDecoratorCog_?: boolean
        }
      | undefined
    if (!def || def.snakieDecoratorCog_) continue
    const init = def.init

    def.init = function (this: Blockly.Block): void {
      init?.call(this)
      addBadgeRow(this, before)
      const MutatorIcon = Blockly.icons.MutatorIcon
      if (this.getIcon?.(MutatorIcon.TYPE)) this.removeIcon(MutatorIcon.TYPE)
      // A no-op on a headless `Blockly.Block`, which is what the golden-file
      // suites build — the hooks below are what those exercise.
      this.setMutator(new MutatorIcon([DECORATOR_ARG_BLOCK], this as Blockly.BlockSvg))
    }

    def.decompose = function (this: Blockly.Block, ws: Blockly.Workspace): Blockly.Block {
      const container = ws.newBlock(DECORATORS_CONTAINER_BLOCK)
      ;(container as Blockly.BlockSvg).initSvg?.()
      fillContainer(container, getDecorators(this))
      return container
    }

    def.compose = function (this: Blockly.Block, container: Blockly.Block): void {
      setDecorators(this, containerDecorators(container))
      syncDecoratorBadge(this)
    }

    def.snakieDecoratorCog_ = true
  }
}

/** The four serialisation hooks, as they hang off a block definition. */
interface SerialisingBlock {
  mutationToDom?: (this: Blockly.Block, ...args: unknown[]) => Element | null
  domToMutation?: (this: Blockly.Block, xml: Element) => void
  saveExtraState?: (this: Blockly.Block, ...args: unknown[]) => object | null
  loadExtraState?: (this: Blockly.Block, state: object) => void
  snakieDecoratorsInstalled_?: boolean
}

/**
 * Give a block type a `decorators` list that survives being saved (#1215).
 *
 * WRAPPING, NOT REPLACING — the same move {@link installFunctionBlocks} makes
 * on `init`, and for the same reason: Blockly's `def` blocks keep their
 * parameter list in exactly these four hooks, and a definition of our own would
 * take the mutator, the caller sockets and the rename bookkeeping with it.
 *
 * BOTH PAIRS, because a block is serialised through whichever it has: the JSON
 * pair when it defines one (Blockly's procedure blocks do), the XML pair for a
 * workspace saved as XML. ONLY WHAT IS ALREADY THERE is wrapped — giving
 * `saveExtraState` to a block that has only `mutationToDom` would make Blockly
 * prefer ours and quietly drop the mutation it was saving before. A block with
 * neither would need a mixin of its own; the editing half is
 * {@link installDecoratorCog}.
 *
 * Idempotent, because `installCorePalette` runs again for every test file and
 * `Blockly.Blocks` is not reset between them.
 */
export function installDecorators(types: readonly string[]): void {
  for (const type of types) {
    const def = Blockly.Blocks[type] as unknown as SerialisingBlock | undefined
    if (!def || def.snakieDecoratorsInstalled_) continue

    const { mutationToDom, domToMutation, saveExtraState, loadExtraState } = def
    if (saveExtraState) {
      def.saveExtraState = function (this: Blockly.Block, ...args: unknown[]): object | null {
        const state = saveExtraState.apply(this, args) ?? null
        const list = getDecorators(this)
        if (list.length === 0) return state
        return { ...(state ?? {}), [DECORATORS_KEY]: list }
      }
      def.loadExtraState = function (this: Blockly.Block, state: object): void {
        loadExtraState?.call(this, state)
        const list = (state as Record<string, unknown>)[DECORATORS_KEY]
        if (Array.isArray(list)) setDecorators(this, tidy(list))
      }
    }

    if (mutationToDom) {
      def.mutationToDom = function (this: Blockly.Block, ...args: unknown[]): Element | null {
        const xml = mutationToDom.apply(this, args)
        const list = getDecorators(this)
        if (xml && list.length > 0) xml.setAttribute(DECORATORS_KEY, JSON.stringify(list))
        return xml
      }
      def.domToMutation = function (this: Blockly.Block, xml: Element): void {
        domToMutation?.call(this, xml)
        const raw = xml.getAttribute(DECORATORS_KEY)
        if (raw === null) return
        try {
          const list: unknown = JSON.parse(raw)
          if (Array.isArray(list)) setDecorators(this, tidy(list))
        } catch {
          // A hand-edited or truncated attribute is not worth refusing to open
          // the file for: the function still loads, without its decorators.
        }
      }
    }

    def.snakieDecoratorsInstalled_ = true
  }
}

/**
 * THE DECORATOR LIST'S UI (A3, #1217, epic #1206).
 * =============================================================================
 *
 * OPEN QUESTION 3 ON THE EPIC — *should the cog be replaced by a Snakie-owned
 * popover covering parameters, extras and decorators together?* — IS DECIDED
 * HERE AS **NO**: the mini-workspace mutator is EXTENDED, with a second
 * section in the same bubble.
 *
 * The popover is the bigger, more tempting change, and the argument against it
 * is the one this file already makes twice. Blockly's parameter mutator is not
 * a form: each `procedures_mutatorarg` in it IS a workspace variable, and
 * dragging, renaming or deleting one runs the bookkeeping that renames every
 * caller of the function. A popover would have to reimplement all of it —
 * `saveConnections`, the caller sockets, the rename flow — against Blockly
 * internals with no public API, for the second time, in a second place that can
 * disagree with the first. That is the cost #1134 refused when it put the extra
 * parameters in a field rather than extending the mutator.
 *
 * AND THE COG IS ALREADY WHERE THE LEARNER LOOKS. It is where they added the
 * parameters, and a decorator belongs to the same `def`. Two doors — a cog for
 * parameters and a popover for everything about parameters — is the split the
 * epic complains about in `snakie_method`'s dropdown, rebuilt at a larger size.
 *
 * WHAT IT COSTS INSTEAD is one mutator-only block type
 * ({@link DECORATOR_ARG_BLOCK}) and a `decompose`/`compose` wrap in the same
 * shape as the serialisation wrap above: our section is read and written around
 * Blockly's, which never sees it. A learner who does not want to open the cog
 * at all has the right-click **Add decorator…** (`BlocksCanvas.tsx`), which is
 * the same door #1134 and #1163 put on their own hidden rows.
 *
 * #1218 may still fold the extras row into this bubble. That is a third section
 * here, not a different mechanism.
 */

/**
 * The decorators a MicroPython program actually reaches for, as suggestions.
 *
 * SUGGESTIONS, NOT A CHOICE. The field is a text input with these on a
 * `<datalist>`, so `@app.route("/")` and anything else a library defines is
 * typed in exactly as it is written — which is the whole reason the list is
 * stored verbatim (see {@link getDecorators}).
 *
 * `micropython.asm_thumb` is DELIBERATELY ABSENT (the issue asks). It is not
 * something you reach for without already knowing Thumb assembly, its body is
 * not Python at all — so nothing else in the blocks editor could fill it in —
 * and offering it beside `@property` would suggest otherwise. Typing it in
 * still works, like any other entry.
 */
export const DECORATOR_SUGGESTIONS: readonly string[] = [
  'property',
  'staticmethod',
  'classmethod',
  'micropython.native',
  'micropython.viper'
]

/** The mutator-only block that holds one entry, and the field on it. */
export const DECORATOR_ARG_BLOCK = 'snakie_decorator_arg'
const DECORATOR_ARG_FIELD = 'NAME'

/** The container's section for them. */
const DECORATORS_INPUT = 'SNAKIE_DECORATORS'

/** The container a block with no parameter mutator of its own opens. */
export const DECORATORS_CONTAINER_BLOCK = 'snakie_decorators_container'

/** The badge row on a decorated block, and the label field in it. */
const BADGE_INPUT = 'SNAKIE_DECORATOR_BADGE'
export const DECORATOR_BADGE_FIELD = 'SNAKIE_BADGE'

/** The id of the `<datalist>` every decorator field points at. */
const DATALIST_ID = 'snakie-decorator-suggestions'

/**
 * The one `<datalist>` the suggestions live on, created on first use.
 *
 * On `document.body` rather than inside Blockly's widget div, because the
 * widget div is emptied every time an editor closes and the list has to outlive
 * that. Returns `null` outside a browser — the golden-file suites build these
 * blocks in plain node, where there is no document to put it in.
 */
function decoratorDatalist(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(DATALIST_ID)
  if (existing) return existing
  const list = document.createElement('datalist')
  list.id = DATALIST_ID
  for (const name of DECORATOR_SUGGESTIONS) {
    const option = document.createElement('option')
    option.value = name
    list.appendChild(option)
  }
  document.body.appendChild(list)
  return list
}

/**
 * A text field whose editor offers the known decorators (#1217).
 *
 * Blockly has no field for "a text box with suggestions" — `field_dropdown` is
 * a closed choice and `field_input` has none. The editor it opens is a real
 * `<input>` in the DOM, though, so the browser's own `list=` gives exactly the
 * behaviour wanted: the five known names drop down, and anything at all can be
 * typed over them.
 *
 * A leading `@` is stripped on the way in, so pasting `@property` — which is
 * how the decorator is written everywhere else — stores `property` rather than
 * putting a doubled `@@property` on the line.
 */
export class DecoratorField extends Blockly.FieldTextInput {
  constructor() {
    super('', (value) => String(value ?? '').replace(/^@+\s*/, ''))
  }

  protected override widgetCreate_(): HTMLInputElement | HTMLTextAreaElement {
    const input = super.widgetCreate_()
    if (decoratorDatalist() && input instanceof HTMLInputElement) {
      input.setAttribute('list', DATALIST_ID)
    }
    return input
  }
}

/** The entries on a container block's decorator stack, in order. */
function containerDecorators(container: Blockly.Block): string[] {
  const entries: string[] = []
  let block: Blockly.Block | null = container.getInputTargetBlock(DECORATORS_INPUT)
  while (block) {
    if (block.type === DECORATOR_ARG_BLOCK) {
      entries.push(String(block.getFieldValue(DECORATOR_ARG_FIELD) ?? ''))
    }
    block = block.getNextBlock()
  }
  return tidy(entries)
}

/** Give the container block one entry block per decorator, in order. */
function fillContainer(container: Blockly.Block, entries: readonly string[]): void {
  let connection = container.getInput(DECORATORS_INPUT)?.connection ?? null
  for (const entry of entries) {
    const arg = container.workspace.newBlock(DECORATOR_ARG_BLOCK)
    arg.setFieldValue(entry, DECORATOR_ARG_FIELD)
    ;(arg as Blockly.BlockSvg).initSvg?.()
    connection?.connect(arg.previousConnection!)
    connection = arg.nextConnection
  }
}

/** Append the Decorators section to a container block the cog has just built. */
function addContainerSection(container: Blockly.Block, entries: readonly string[]): void {
  container.appendDummyInput().appendField('decorators')
  container.appendStatementInput(DECORATORS_INPUT)
  fillContainer(container, entries)
}

/**
 * The badge that says a block is decorated, without opening the cog (#1217).
 *
 * The first decorator BY NAME — `@property` tells a reader what the block is,
 * where a bare `@` only says that something is there — with `+2` after it when
 * there are more. Hidden entirely when the list is empty, the rule the extras
 * row follows and for the same reason: the ordinary `def` stays ordinary.
 */
export function syncDecoratorBadge(block: Blockly.Block): void {
  const input = block.getInput(BADGE_INPUT)
  const field = block.getField(DECORATOR_BADGE_FIELD)
  if (!input || !field) return
  const list = getDecorators(block)
  const rest = list.length > 1 ? `  +${list.length - 1}` : ''
  field.setValue(list.length === 0 ? '' : `@${list[0]}${rest}`)
  if (input.isVisible() !== list.length > 0) {
    input.setVisible(list.length > 0)
    ;(block as Blockly.BlockSvg).queueRender?.()
  }
}

/** Is the badge row on screen? False for a block that has no such row. */
export function decoratorBadgeVisible(block: Blockly.Block): boolean {
  return !!block.getInput(BADGE_INPUT)?.isVisible()
}

/**
 * Can this block take decorators? True for the two `def` blocks and the method
 * block, false for every other block on the canvas.
 *
 * Asked of the BLOCK rather than of a list of type names, because the badge row
 * is installed by the same call that gives the block its decorator list — so
 * the two can never get out of step, and a block type that gains the list later
 * gains the right-click item with it.
 */
export function hasDecorators(block: Blockly.Block): boolean {
  return !!block.getInput(BADGE_INPUT)
}

/**
 * Give a block the badge row, above the first of `before` it actually has.
 *
 * `appendDummyInput` puts a row at the very bottom — under the `return` socket
 * on `procedures_defreturn`, and under the whole body on the method block —
 * which is nowhere near the `def` line the decorators belong to. The row is
 * moved up to just above the signature it annotates.
 */
function addBadgeRow(block: Blockly.Block, before: readonly string[]): void {
  if (block.getInput(BADGE_INPUT)) return
  block
    .appendDummyInput(BADGE_INPUT)
    .appendField(new Blockly.FieldLabel('', 'snakieDecoratorBadge'), DECORATOR_BADGE_FIELD)
  const anchor = before.find((name) => block.getInput(name))
  if (anchor) block.moveInputBefore(BADGE_INPUT, anchor)
  block.getInput(BADGE_INPUT)?.setVisible(false)
}

/**
 * The mutator-only blocks: one entry, and a container for a block whose cog
 * has nothing else in it.
 *
 * Defined straight on `Blockly.Blocks` rather than through the registry,
 * because they only ever exist inside a mutator bubble: never in the toolbox,
 * never on the canvas, never serialised into a file — so they need neither a
 * generator emitter nor a place in the list of types `workspace-check` will
 * open a file for.
 */
export function installDecoratorMutatorBlocks(): void {
  if (!Blockly.Blocks[DECORATOR_ARG_BLOCK]) {
    Blockly.Blocks[DECORATOR_ARG_BLOCK] = {
      init: function (this: Blockly.Block): void {
        this.appendDummyInput()
          .appendField('@')
          .appendField(new DecoratorField(), DECORATOR_ARG_FIELD)
        this.setPreviousStatement(true)
        this.setNextStatement(true)
        this.setStyle('procedure_blocks')
        this.setTooltip(
          'One decorator, written on its own line above the function — property, micropython.native, or anything else you type.'
        )
      }
    }
  }
  if (!Blockly.Blocks[DECORATORS_CONTAINER_BLOCK]) {
    Blockly.Blocks[DECORATORS_CONTAINER_BLOCK] = {
      init: function (this: Blockly.Block): void {
        this.appendDummyInput().appendField('decorators')
        this.appendStatementInput(DECORATORS_INPUT)
        this.setStyle('procedure_blocks')
        this.setTooltip('One @ line for every decorator dragged in here.')
      }
    }
  }
}

/** The blocks a `def` block's cog offers: Blockly's parameter, and ours. */
const DEF_MUTATOR_FLYOUT = ['procedures_mutatorarg', DECORATOR_ARG_BLOCK]

/**
 * Add the Decorators section to a block whose cog Blockly already built.
 *
 * WRAPPED, NOT REPLACED — the same move {@link installDecorators} makes on the
 * serialisation hooks. `decompose` builds Blockly's container and we append one
 * statement input to it; `compose` reads our section and then hands the very
 * same container to Blockly's, which looks only at `STACK` and never sees ours.
 *
 * The cog's flyout is re-pointed at both block types in the `init` wrap, which
 * is the one place the icon is built. `setMutator` is a no-op on a headless
 * `Blockly.Block`, so the generator's node-only suites are unaffected.
 */
export function installDecoratorMutator(types: readonly string[]): void {
  installDecoratorMutatorBlocks()
  for (const type of types) {
    const def = Blockly.Blocks[type] as unknown as {
      init?: (this: Blockly.Block) => void
      decompose?: (this: Blockly.Block, ws: Blockly.Workspace) => Blockly.Block
      compose?: (this: Blockly.Block, container: Blockly.Block) => void
      snakieDecoratorMutator_?: boolean
    }
    if (!def || def.snakieDecoratorMutator_ || !def.decompose || !def.compose) continue
    const { init, decompose, compose } = def

    def.init = function (this: Blockly.Block): void {
      init?.call(this)
      addBadgeRow(this, [EXTRAS_INPUT, 'STACK'])
      // A FRESH ICON: `flyoutBlockTypes` is fixed when a MutatorIcon is built,
      // and Blockly refuses a second icon of the same type on one block.
      const MutatorIcon = Blockly.icons.MutatorIcon
      if (this.getIcon?.(MutatorIcon.TYPE)) this.removeIcon(MutatorIcon.TYPE)
      this.setMutator(new MutatorIcon(DEF_MUTATOR_FLYOUT, this as Blockly.BlockSvg))
    }

    def.decompose = function (this: Blockly.Block, ws: Blockly.Workspace): Blockly.Block {
      const container = decompose.call(this, ws)
      addContainerSection(container, getDecorators(this))
      return container
    }

    def.compose = function (this: Blockly.Block, container: Blockly.Block): void {
      setDecorators(this, containerDecorators(container))
      compose.call(this, container)
      syncDecoratorBadge(this)
    }

    def.snakieDecoratorMutator_ = true
  }
}

/**
 * The badge's own look: quieter than the block's own text, so it reads as a
 * note about the block rather than part of the sentence on it. Registered with
 * Blockly rather than written into a stylesheet, because a block is SVG and the
 * Soft Shell font token is the one thing about it worth sharing with the DOM.
 */
export function installDecoratorCss(): void {
  if (decoratorCssInstalled) return
  decoratorCssInstalled = true
  Blockly.Css.register(`
.snakieDecoratorBadge {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  opacity: 0.85;
}
`)
}

let decoratorCssInstalled = false
