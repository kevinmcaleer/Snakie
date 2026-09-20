import * as Blockly from 'blockly/core'
import type { Dialect } from '../../../../shared/dialect'
import type { BlockLevel } from './registry'
import { BLOCK_CATEGORIES } from './theme'
import { categoryContents, FUNCTIONS_CATEGORY_CALLBACK } from './toolbox'

/**
 * THE FUNCTIONS DRAWER (#1220, epic #1206).
 * =============================================================================
 *
 * Functions has been Blockly's own drawer since #1045, and for a good reason:
 * its contents are a question about the WORKSPACE — one caller block per
 * function the learner has defined, carrying that function's name and its
 * parameter sockets — and a static shelf could only offer two blank, nameless
 * callers.
 *
 * The cost was that NOTHING ELSE REGISTERED IN THE CATEGORY COULD BE REACHED.
 * `custom` replaces a category's contents rather than adding to them, so
 * `snakie_return` and `snakie_super` were registered, generated and read back
 * — and were in no drawer at all. B1 puts `class` and `self` in the same
 * category, so that had to be fixed before un-hiding them meant anything.
 *
 * So this is the Variables drawer's answer one category back (#1117): Blockly's
 * dynamic list FIRST — it is what a learner opens this drawer for — then the
 * curated entries the registry holds, minus anything Blockly has just issued a
 * named copy of. Pure, and takes a plain `Workspace`, so what is on the shelf
 * after a learner writes their first function is a unit test rather than
 * something you find out by opening the drawer.
 */

export { FUNCTIONS_CATEGORY_CALLBACK }

/** Every block type an item (or its sub-items) offers. */
function typesIn(items: readonly Record<string, unknown>[]): Set<string> {
  const out = new Set<string>()
  for (const item of items) {
    if (typeof item.type === 'string') out.add(item.type)
    if (Array.isArray(item.contents)) for (const t of typesIn(item.contents)) out.add(t)
  }
  return out
}

/**
 * The Functions drawer for this workspace (#1220).
 *
 * `workspace` is Blockly's own argument: `Procedures.flyoutCategory` reads the
 * functions defined in it. A workspace with none still gets the two `def`
 * blocks and `ifreturn`, which is the shelf this drawer has always opened on.
 */
export function functionsFlyout(
  workspace: Blockly.WorkspaceSvg,
  dialect: Dialect = 'unknown',
  level: BlockLevel = 'advanced'
): Record<string, unknown>[] {
  const category = BLOCK_CATEGORIES.find((c) => c.id === 'functions')
  const procedures = Blockly.Procedures.flyoutCategory(workspace) as unknown as Record<
    string,
    unknown
  >[]
  const curated = category ? categoryContents(category, dialect, level) : []
  // Blockly's list wins for any type it already put on the shelf — the `def`
  // blocks and the callers — because its copies are bound to a function and
  // ours are the nameless originals.
  const already = typesIn(procedures)
  return [...procedures, ...curated.filter((c) => !already.has(String(c.type)))]
}

/**
 * Wire the drawer to a live workspace, in place of Blockly's own callback.
 *
 * The dialect and the level come from GETTERS, not values: the callback is
 * asked afresh every time the drawer opens, so it reads whatever the settings
 * say at that moment without the canvas re-registering anything.
 */
export function installFunctionsDrawer(
  workspace: Blockly.WorkspaceSvg,
  dialect: () => Dialect,
  level: () => BlockLevel
): void {
  workspace.registerToolboxCategoryCallback(
    FUNCTIONS_CATEGORY_CALLBACK,
    // Plain data — the same shape `categoryContents` has always handed Blockly
    // — so the cast is about the type of a JSON literal, not about what is in it.
    (ws) =>
      functionsFlyout(
        ws as Blockly.WorkspaceSvg,
        dialect(),
        level()
      ) as unknown as Blockly.utils.toolbox.FlyoutDefinition
  )
}
