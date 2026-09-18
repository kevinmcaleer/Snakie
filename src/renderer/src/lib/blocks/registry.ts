import * as Blockly from 'blockly/core'
import type { BlockCategoryId } from './theme'
import type { PyImport } from './imports'
import type { DialectScope } from '../../../../shared/dialect-api'
import type { MicroPythonGenerator } from './generator'

/**
 * THE BLOCK REGISTRY (#1010, epic #1007).
 * =============================================================================
 *
 * One place a block is declared, and everything that needs to know about it —
 * Blockly's definition table, the generator's emitter table, and the toolbox
 * category it appears in — is derived from that one declaration.
 *
 * The alternative, and the reason this exists, is three lists: a block defined
 * in one file, its generator function in a god-file of emitters, and its name
 * typed a third time into a toolbox. Two of those three go stale silently — a
 * block with no emitter generates `undefined` into a child's program, and a
 * block in no category simply cannot be reached. Here they cannot disagree,
 * because there is only one of them.
 *
 * The palettes (#1011–#1014), the `blocks.yml` manifest (#1017) and the escape
 * hatches (#1018) all arrive through {@link defineBlocks}.
 */

/**
 * What a block's emitter returns.
 *
 * A STATEMENT block returns its lines, newline-terminated. A VALUE block returns
 * `[expression, precedence]` — Blockly's own convention, so the expression is
 * parenthesised only where it has to be.
 */
export type BlockCode = string | [string, number]

/** Emit the code for one block. `gen` carries the imports and the setup section. */
export type BlockEmitter = (block: Blockly.Block, gen: MicroPythonGenerator) => BlockCode

export interface BlockDefinition {
  /** Blockly block type id, e.g. `snakie_turtle_forward`. */
  type: string
  /** The toolbox category it lives in — from the theme's one category list. */
  category: BlockCategoryId
  /**
   * The Blockly JSON definition (`message0`, `args0`, `previousStatement`, …).
   * `style` is filled in from `category` when absent, so a block can't end up a
   * different colour from the category it sits in.
   *
   * ABSENT means Blockly already defines this type — the core palette (#1011)
   * uses Blockly's own `controls_if`, `math_arithmetic` and friends, which come
   * with mutators (the gear icon that adds an `else if`) that would be a poor
   * use of anyone's time to rebuild. Those entries contribute the MicroPython
   * emitter and the toolbox slot, and nothing else.
   */
  json?: Record<string, unknown>
  /** What this block needs in scope, whenever it emits. */
  imports?: readonly PyImport[]
  /** Emit the code. */
  code: BlockEmitter
  /**
   * This block claims a pin (#1012) — which field holds it, what the block does
   * with it, and what the pin has to be able to do.
   *
   * Declared HERE rather than inferred from the block's fields, because "is this
   * a pin?" and "does it need an ADC?" are facts about the block's meaning that
   * only the block knows. The canvas uses these to flag two blocks fighting over
   * one pin, a pin the board doesn't have, and a pin that can't do the job.
   */
  pin?: {
    field: string
    role: string
    needs?: string
    /**
     * Which way this block drives the pin, when it cares.
     *
     * Only consulted for a NAMED pin, where the direction is chosen once on the
     * `name pin` block and the object is built there — so a block that writes to
     * a pin named `for input` does nothing at all, silently, which is the
     * failure `pin-conflicts.ts` exists to catch. An unnamed pin builds its own
     * object with the direction the block needs, so there is nothing to disagree
     * with and this is left off.
     */
    direction?: 'in' | 'out'
  }
  /**
   * This block belongs to an instrument (#1013) — the id from
   * `instruments-registry.ts`, e.g. `turtle`.
   *
   * Dragging one out REVEALS that instrument in the dock. A turtle block whose
   * drawing goes into a panel nobody opened looks like a block that did nothing,
   * which is the worst thing a first block can look like. #1014's whole category
   * is built on this field.
   */
  instrument?: string
  /**
   * The in-app help article this block's Help menu item opens, e.g. `ref-flow`.
   *
   * IN-APP, not a URL. Blockly's own `helpUrl` opens a web page, and a child on
   * a school network — or on a Chromebook with no connection (epic #267) — gets
   * nothing. The help library is already in the app, already offline, and
   * already written for exactly these topics.
   */
  help?: string
  /**
   * Toolbox entry overrides — shadow blocks for the number inputs, mostly, so a
   * block dragged out of the flyout already has sensible values in it rather
   * than empty sockets a beginner has to discover how to fill.
   */
  toolbox?: Record<string, unknown>
  /**
   * A SUB-CATEGORY within {@link category} (#1017).
   *
   * The categories are a fixed, curated list — a curriculum, as the palette's
   * own comment says — but "My parts" holds whatever the learner happens to have
   * wired up this afternoon. Those group by part, one drawer each, rather than
   * spilling forty blocks from four sensors into one flyout nobody can read.
   */
  group?: BlockGroup
  /**
   * Which dynamic set this block belongs to, e.g. `part:snakie-standard.vl53l0x`
   * (#1017). Absent for the built-in palette.
   *
   * The identity {@link defineDynamicBlocks} replaces on: a part that is
   * unwired, re-wired, or edited in the Part Editor re-registers its whole set,
   * and the previous one has to go — otherwise a block whose part is gone stays
   * in the flyout, draggable, generating code for hardware that isn't there.
   */
  source?: string
  /**
   * How to read this block's generated call BACK into a block (#1019).
   *
   * The half of the round trip a generator cannot provide: `code` says what the
   * block writes, and this says what that line looked like — the module, the
   * function and the socket each argument came from. Declared on the definition
   * so the two sides cannot drift, and absent on every block whose line is not a
   * plain call (a `for`, an assignment, anything with a field in the middle of
   * it), which the converter answers with a raw Python block instead.
   */
  read?: {
    module?: string
    fn: string
    args: readonly string[]
    shape?: 'statement' | 'value'
    /**
     * This call is made on a HOISTED OBJECT rather than a module (#1058).
     *
     * A hardware line is not `led.set(15, True)` — it is `led_15.set(True)`,
     * called on an object the generator hoisted into the setup section, whose
     * NAME carries the pin. Without this, every hardware line came back from
     * #1019 as a raw Python block: the program was readable and unbuildable.
     */
    receiver?: CallReceiver
    /**
     * Positional arguments that are FIELDS rather than sockets, by index.
     *
     * `led_15.set(True)` has no socket — `True` is the ON/OFF dropdown, and
     * reading it back means mapping the Python text to the option value.
     */
    argFields?: Readonly<Record<number, ArgField>>
  }
  /**
   * The part this block belongs to (#1017) — so USING one can offer to install
   * that part's driver, the same consent-first banner the Board View shows when
   * the part is placed.
   */
  part?: { libraryId: string; partId: string }
  /**
   * The same block, generating CIRCUITPYTHON (#1040, epic #209).
   *
   * One block, two templates — decided in `docs/blockly-epic.md` §9. The
   * alternative was a second set of blocks, and it loses the property this file
   * format exists for: a learner's program should be a program, not a
   * program-for-a-Pico. A canvas built in a classroom's MicroPython half opens
   * and runs in its CircuitPython half, and the mirror shows what it generated
   * either way.
   *
   * ABSENT means this block only knows MicroPython — which is not a gap to be
   * ashamed of but a fact to be honest about, and {@link scopedByEmitters}
   * turns it into a `scope` so the toolbox never offers the block to a board
   * that cannot run it.
   */
  circuitpython?: {
    imports?: readonly PyImport[]
    code: BlockEmitter
  }
  /**
   * Which runtimes this block is true for (#1039, epic #209).
   *
   * Absent means BOTH, matching `DialectScope`'s own default — most of the
   * palette is plain Python and needs no annotation. Hardware and instruments
   * are `'micropython'`, because what they generate goes through `machine`.
   *
   * THIS FILTERS THE TOOLBOX, NEVER THE REGISTRY. A block out of scope is one
   * the learner cannot reach FOR; it is emphatically still registered, because
   * `workspace-check.ts` refuses to open a file containing a type this build
   * does not know. Deregistering would make every existing hardware program
   * unopenable the moment a CircuitPython board was plugged in — the file still
   * there, and Snakie declining to show it.
   */
  scope?: DialectScope
}

/**
 * Mark a whole palette with a {@link BlockDefinition.scope} (#1039).
 *
 * At the REGISTRATION site rather than on each literal, because the scope here
 * is a fact about the PALETTE and not about any one block: everything in
 * `hardware.ts` reaches `machine` through the `snakie` umbrella, and a block
 * added to it tomorrow will too. Written out twenty-nine times it would be
 * twenty-nine chances to forget, and the one that was forgotten is the one a
 * learner is offered on a board that cannot run it.
 *
 * A definition that states its own scope keeps it, so a single exception does
 * not have to be lifted out of the list it belongs in.
 */
export function scoped(
  scope: DialectScope,
  defs: readonly BlockDefinition[]
): BlockDefinition[] {
  return defs.map((def) => (def.scope ? def : { ...def, scope }))
}

/**
 * How a hoisted object is recognised on the way back in (#1058).
 *
 * The generator writes TWO lines for one block — a constructor in the setup
 * section and the call that uses it — so reading one block back means reading
 * both, and then making sure the constructor does not ALSO become a block of
 * its own. Declared here beside the emitter for the same reason everything else
 * in this file is: the two halves of the round trip cannot drift.
 */
export interface CallReceiver {
  /** The name prefix the generator hoists under — `led` in `led_15`. */
  name: string
  /** The block field the pin out of that name goes into. */
  pinField: string
  /**
   * The constructor, as a template. `{PIN}` is the pin; any other `{FIELD}` is
   * a dropdown whose possible texts are listed in {@link options}.
   *
   * MATCHED EXACTLY, which is the point: a constructor that is not character
   * for character what this block would have written is not this block's, and
   * consuming it would delete a line somebody meant.
   */
  ctor: string
  /** For each `{FIELD}` in {@link ctor}: the exact Python each option writes. */
  options?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** An argument that is a field: the field it fills, and what each text means. */
export interface ArgField {
  field: string
  /** Python text → field value. `{ True: 'ON', False: 'OFF' }`. */
  values: Readonly<Record<string, string>>
}

/**
 * Scope a palette by what it can actually GENERATE (#1040).
 *
 * `scoped('micropython', …)` was right when nothing could speak CircuitPython.
 * Now that some blocks can, saying so twice — once as an emitter, once as a
 * scope — is two things to keep in step, and the one that drifts is the one
 * that hides a working block from the board it works on. So the scope is
 * derived: a block with a CircuitPython emitter is for both, and a block
 * without one is MicroPython's.
 *
 * A definition that states its own scope keeps it, as always.
 */
export function scopedByEmitters(defs: readonly BlockDefinition[]): BlockDefinition[] {
  return defs.map((def) =>
    def.scope ? def : { ...def, scope: def.circuitpython ? 'both' : ('micropython' as const) }
  )
}

/** A sub-category inside a toolbox category (#1017). */
export interface BlockGroup {
  /** Stable id — the flyout's identity, so re-registering doesn't reorder it. */
  id: string
  /** What the drawer is called: the part's or the plugin's name. */
  name: string
}

const REGISTRY = new Map<string, BlockDefinition>()

/**
 * Register blocks. Idempotent per type: re-registering the same type replaces
 * it, so a hot reload doesn't end up with two definitions racing.
 */
export function defineBlocks(defs: readonly BlockDefinition[]): void {
  for (const def of defs) REGISTRY.set(def.type, def)
}

/**
 * Register (or re-register) one DYNAMIC set of blocks (#1017).
 *
 * A part's or a plugin's blocks are not a fact about this build — they are a
 * fact about what is wired up and installed right now, and both change while the
 * app is running. So a set is replaced WHOLE: everything previously registered
 * under `source` is forgotten first, and what is passed in takes its place.
 *
 * Blockly's own definition table is not pruned to match, and that is deliberate.
 * A workspace on screen may still hold a block from the set being replaced, and
 * un-defining its type would strand it as an unrenderable shape mid-session. The
 * REGISTRY is what the toolbox is built from, so dropping it here is enough for
 * the block to stop being reachable, which is the thing that matters.
 */
export function defineDynamicBlocks(source: string, defs: readonly BlockDefinition[]): void {
  for (const [type, def] of [...REGISTRY]) {
    if (def.source === source) REGISTRY.delete(type)
  }
  for (const def of defs) REGISTRY.set(def.type, { ...def, source })
}

/** Forget every dynamic set whose source is not in `keep` (#1017). */
export function pruneDynamicBlocks(keep: ReadonlySet<string>, prefix?: string): void {
  for (const [type, def] of [...REGISTRY]) {
    if (!def.source || keep.has(def.source)) continue
    // A PREFIX SCOPES THE SWEEP (#1048). Two hooks now register dynamic sets —
    // parts and plugins from the breadboard, modules from the program's own
    // imports — and neither knows what the other is holding. Without this the
    // part hook's prune would delete every module drawer a moment after the
    // module hook filled it, and each rebuild would fight the other.
    if (prefix === undefined ? def.source.startsWith(MODULE_PREFIX) : !def.source.startsWith(prefix)) {
      continue
    }
    REGISTRY.delete(type)
  }
}

/**
 * The namespace the imported-module sets live under (#1048).
 *
 * Declared here rather than imported, so `pruneDynamicBlocks` — which every
 * dynamic registrant calls — does not depend on the hook that uses it.
 */
const MODULE_PREFIX = 'module:'

/** Every registered block, in registration order. */
export function registeredBlocks(): BlockDefinition[] {
  return [...REGISTRY.values()]
}

/** The registered blocks in one category, in registration order. */
export function blocksInCategory(category: BlockCategoryId): BlockDefinition[] {
  return registeredBlocks().filter((b) => b.category === category)
}

/** One block's definition, or undefined. */
export function blockDefinition(type: string): BlockDefinition | undefined {
  return REGISTRY.get(type)
}

/**
 * Teach Blockly the registered blocks' shapes.
 *
 * Separate from registration because the two have different lifetimes: a block
 * can be registered before Blockly is loaded at all (the registry is a plain
 * Map; the canvas is a lazy chunk), and a definition has to be installed once
 * Blockly exists and again for anything registered since.
 *
 * `style` falls back to the block's CATEGORY, so a block cannot end up a
 * different colour from the category it sits in — the one way those two could
 * disagree if each were written out by hand.
 */
export function installBlockDefinitions(): void {
  const defs = registeredBlocks()
    // A registration with no `json` is a block Blockly already defines.
    // Redefining it from an empty object would replace `controls_if` with a
    // block that has no inputs, which is a far worse failure than not trying.
    .filter((def) => def.json && Object.keys(def.json).length > 0)
    .map((def) => ({ type: def.type, style: `${def.category}_blocks`, ...def.json }))
  if (defs.length > 0) Blockly.defineBlocksWithJsonArray(defs)
}

/** Forget everything — for tests, which must not leak blocks into each other. */
export function resetBlockRegistry(): void {
  REGISTRY.clear()
}
