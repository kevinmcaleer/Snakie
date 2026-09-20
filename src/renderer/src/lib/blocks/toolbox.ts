import * as Blockly from 'blockly/core'
import { inScope } from '../../../../shared/dialect-api'
import { DIALECT_LABEL, type Dialect } from '../../../../shared/dialect'
import {
  DEFAULT_BLOCK_LEVEL,
  atLevel,
  blocksInCategory,
  type BlockDefinition,
  type BlockLevel
} from './registry'
import { BLOCK_CATEGORIES, categoryStyleName } from './theme'
import { SCAN_MODULES_BUTTON } from './module-scan'

/**
 * THE TOOLBOX (#1011/#1017/#1039, epic #1007).
 * =============================================================================
 *
 * The registry, arranged into the drawers a learner opens — and filtered to the
 * runtime the board in front of them actually runs.
 *
 * Out here rather than in `BlocksCanvas` because it is PURE: categories and
 * block definitions in, a Blockly toolbox description out, no DOM and no
 * workspace. Which of the ninety-odd blocks a CircuitPython board is offered is
 * exactly the kind of decision that should be a unit test rather than something
 * you discover by plugging a Feather in.
 */

/**
 * The `custom` key the Variables category carries (#1117).
 *
 * Here rather than in `variables-drawer.ts` so the toolbox — which names it —
 * does not have to import the drawer that fills it, which imports this module
 * back for {@link categoryContents}.
 */
export const VARIABLES_CATEGORY_CALLBACK = 'SNAKIE_VARIABLES'

/**
 * The `custom` key the Functions category carries (#1220).
 *
 * OURS RATHER THAN `Blockly.PROCEDURE_CATEGORY_NAME` since B1: Blockly's own
 * callback returns the `def` blocks and one caller per function and nothing
 * else, so every other block registered in the category — `return`, `super()`,
 * the Classes shelf — was unreachable. `functions-drawer.ts` calls Blockly's
 * list first and then adds them; see the file for why.
 */
export const FUNCTIONS_CATEGORY_CALLBACK = 'SNAKIE_FUNCTIONS'

/**
 * The toolbox: one category per entry in {@link BLOCK_CATEGORIES}, filled from
 * the block registry, for the runtime the learner is on (#1039, epic #209).
 *
 * Every category is shown even when it is empty. An empty `Turtle` says "turtle
 * blocks go here"; hiding it would say "Snakie doesn't do turtles", which is the
 * wrong thing to tell someone who came here to draw one.
 *
 * `dialect` filters what can be REACHED FOR, never what is registered — see
 * `BlockDefinition.scope`. `unknown` (no board, or a board that wouldn't say)
 * shows everything, which is `inScope`'s own rule and the right default for a
 * workspace whose whole point is that it works with nothing plugged in.
 */
export function buildToolbox(
  dialect: Dialect,
  level: BlockLevel = 'advanced'
): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: BLOCK_CATEGORIES.map((c) =>
      // Functions and Variables are the two categories whose contents are a
      // question about the WORKSPACE rather than about the registry (#1045,
      // #1117), so they hand the job to a callback — `functions-drawer.ts` for
      // functions, `variables-drawer.ts` for variables, both registered at
      // injection. Everything else is a curated list and stays one.
      c.id === 'functions' || c.id === 'variables'
        ? {
            kind: 'category',
            name: c.name,
            categorystyle: categoryStyleName(c.id),
            custom: c.id === 'functions' ? FUNCTIONS_CATEGORY_CALLBACK : VARIABLES_CATEGORY_CALLBACK
          }
        : {
            kind: 'category',
            name: c.name,
            categorystyle: categoryStyleName(c.id),
            contents: categoryContents(c, dialect, level)
          }
    )
  }
}

/** What an advanced-only drawer says while the advanced blocks are off (#1210). */
export const ADVANCED_OFF_HINT =
  'These are advanced blocks. Turn them on in Settings ▸ Appearance ▸ Blocks.'

/** The heading that marks the advanced blocks inside a drawer (#1211). */
export const ADVANCED_MARKER_LABEL = 'Advanced'

/**
 * The class the marker label wears, so the stylesheet can make it the quiet,
 * amber thing it is meant to be rather than another category heading (#1211).
 *
 * Blockly puts a label's `web-class` on the text element it draws, which is the
 * only hook there is: a flyout label is SVG, not DOM we own.
 */
export const ADVANCED_MARKER_CLASS = 'snakie-flyout-advanced'

/** Whether a definition is one of the advanced ones. */
function isAdvanced(def: BlockDefinition): boolean {
  return (def.level ?? DEFAULT_BLOCK_LEVEL) === 'advanced'
}

/**
 * A run of blocks, with the advanced ones moved to the end behind a marker
 * (#1211).
 *
 * A learner in advanced mode has every drawer, and nothing in them says which
 * blocks are the *extra* ones — so `try` sits beside `if` looking equally like
 * the thing to reach for. One muted heading per drawer is the cheapest honest
 * answer: it costs a beginner nothing (in simple mode there is nothing behind
 * it, so no label is drawn) and it tells anyone who has switched the extras on
 * where the line is.
 *
 * Order, not just a label: a heading with simple blocks after it would be a
 * lie about the ones below it.
 */
function markAdvanced(defs: readonly BlockDefinition[]): Record<string, unknown>[] {
  const simple = defs.filter((d) => !isAdvanced(d))
  const advanced = defs.filter(isAdvanced)
  if (advanced.length === 0) return simple.map(blockEntry)
  return [
    ...simple.map(blockEntry),
    { kind: 'label', text: ADVANCED_MARKER_LABEL, 'web-class': ADVANCED_MARKER_CLASS },
    ...advanced.map(blockEntry)
  ]
}

/** One toolbox entry for a registered block. */
function blockEntry(def: BlockDefinition): Record<string, unknown> {
  return {
    kind: 'block',
    type: def.type,
    // A block dragged out of the flyout arrives with sensible values in its
    // sockets rather than holes a beginner has to discover how to fill.
    ...(def.toolbox ?? {})
  }
}

/**
 * A category's contents: its ungrouped blocks, then one SUB-CATEGORY per group
 * (#1017), then — if all of that came to nothing — the category's own hint.
 *
 * Grouping is what keeps "My parts" usable. The fixed categories are a curated
 * list and their sizes are known; this one holds whatever is on the breadboard,
 * and four sensors' worth of blocks in one flyout is a wall of near-identical
 * shapes. One drawer per part is the same answer the parts panel already gives.
 *
 * The HINT is the other half. An empty `Turtle` says "turtle blocks go here",
 * which is right, but an empty `My parts` can say the thing that FILLS it —
 * wire something up in Electronics — and a drawer that explains itself is worth
 * more than one that just looks broken.
 */
export function categoryContents(
  category: (typeof BLOCK_CATEGORIES)[number],
  dialect: Dialect,
  level: BlockLevel = 'advanced'
): Record<string, unknown>[] {
  // Out of dialect means out of the FLYOUT (#1039). The block stays registered —
  // an existing program that uses it still opens and still generates.
  //
  // READING IS NOT TOOLBOX SURFACE (`docs/blocks-coverage-epic.md` §4.5). Epic
  // #1086 teaches the reader to emit blocks for MicroPython nobody would put in
  // a ten-year-old's first drawer — a module docstring, a `class`, a `try`.
  // Whether each of those should ALSO be draggable is a curriculum decision, and
  // the default is no: the toolbox is curated, the reader is comprehensive, and
  // conflating the two would undo #1007's framing. `hidden` is how a definition
  // says which it is.
  //
  // And the LEVEL (#1210, epic #1206), the third filter. `simple` keeps the
  // beginner's blocks and nothing marked `advanced`; a sub-category whose every
  // block was advanced is not built at all, because the groups below are made
  // from what survives. The default here is `advanced` — everything — so a
  // caller that has no opinion (a test, the PDF export) sees the whole palette.
  const blocks = blocksInCategory(category.id).filter(
    (b) => !b.hidden && inScope(b.scope, dialect) && atLevel(b, level)
  )
  const loose = blocks.filter((b) => !b.group)
  const groups = new Map<string, { name: string; hint?: string; blocks: BlockDefinition[] }>()
  for (const def of blocks) {
    if (!def.group) continue
    const entry = groups.get(def.group.id) ?? {
      name: def.group.name,
      hint: def.group.hint,
      blocks: []
    }
    entry.blocks.push(def)
    groups.set(def.group.id, entry)
  }
  const contents: Record<string, unknown>[] = markAdvanced(loose)
  for (const [id, group] of groups) {
    contents.push({
      kind: 'category',
      name: group.name,
      // The same style as the parent, so a part's drawer reads as part of `My
      // parts` rather than as a category in its own right.
      categorystyle: categoryStyleName(category.id),
      toolboxitemid: id,
      // The group's own sentence first, where it is the first thing read
      // (#1220). A label above the blocks rather than in place of them: the
      // shelf is small, not empty. The blocks themselves are ordered
      // simple-first behind an `Advanced` marker (#1211).
      contents: [
        ...(group.hint ? [{ kind: 'label', text: group.hint }] : []),
        ...markAdvanced(group.blocks)
      ]
    })
  }
  if (contents.length === 0) {
    // A drawer the DIALECT emptied says so. The category's own hint is about
    // filling it ("wire a part up in Electronics"), which is not the reason it
    // is empty here and would send the learner off to do something that will
    // not help.
    //
    // A drawer the LEVEL emptied says so too — the Python drawer, in simple
    // mode, is the one this is written for. A blank category would read as a
    // bug; this reads as a door.
    const theirs = blocksInCategory(category.id).find((b) => b.scope && b.scope !== 'both')?.scope
    const advanced = blocksInCategory(category.id).some((b) => !b.hidden && !atLevel(b, level))
    const hint = theirs
      ? `These blocks are ${DIALECT_LABEL[theirs]}. Your board is running ${DIALECT_LABEL[dialect]}.`
      : advanced
        ? ADVANCED_OFF_HINT
        : 'hint' in category && category.hint
          ? category.hint
          : null
    if (hint) contents.push({ kind: 'label', text: hint })
  }
  // THE MODULES DRAWER HAS A BUTTON (#1048). Its contents are the program's
  // imports, and a program with none yet has an empty drawer and no way to
  // find out what is on the board. The button asks; `module-scan.ts` says
  // what happens next. First, above the hint, because it is the thing to do.
  if (category.id === 'modules') {
    contents.unshift({
      kind: 'button',
      text: 'Scan modules on device and locally',
      callbackkey: SCAN_MODULES_BUTTON
    })
  }
  return contents
}
