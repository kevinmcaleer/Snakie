import * as Blockly from 'blockly/core'
import type { Dialect } from '../../../../shared/dialect'
import { blockDefinition } from './registry'
import { BLOCK_CATEGORIES } from './theme'
import { categoryContents, VARIABLES_CATEGORY_CALLBACK } from './toolbox'

/**
 * THE VARIABLES DRAWER (#1117, epic #1007).
 * =============================================================================
 *
 * The same complaint the Functions drawer had (#1045), one category along: the
 * shelf was a STATIC list, so a learner who had made `score`, `lives` and
 * `speed` was offered one nameless `set _ to _` and had to find the dropdown on
 * it to reach any of them. Their variables were not on the shelf at all, and
 * there was nowhere that said "make one" — the only way to create a variable
 * was to drag a set block out and rename the variable inside it, which is a
 * thing you have to be told.
 *
 * So the drawer is generated from the workspace, like Functions is, and holds:
 *
 *   1. CREATE VARIABLE, a button — the obvious way in, and the one Blockly's own
 *      variable drawer has always had. `%{BKY_NEW_VARIABLE}` rather than our own
 *      string so it follows the app's language (`locale.ts`).
 *   2. `set`/`change` for the newest variable, then ONE GETTER PER VARIABLE,
 *      named, sorted. This is Blockly's own arrangement and deliberately so: a
 *      child arriving from Scratch has seen this shelf before.
 *   3. Whatever else the `variables` category registers — today nothing visible,
 *      but a plugin block landing in this category must not vanish because the
 *      drawer became dynamic.
 *
 * BEFORE THERE ARE ANY VARIABLES the drawer falls back to the curated list,
 * which is the one place Blockly's own answer is wrong for us: it shows the
 * button and nothing else, and an empty shelf is what sent people to the
 * dropdown hunt in the first place. `set _ to _` with no variable yet still
 * works — Blockly names one for you when the block lands — so the shapes stay
 * on the shelf and the button stays the shortcut for people who know what they
 * want to call it.
 */

export { VARIABLES_CATEGORY_CALLBACK }

/**
 * The flyout button's callback key.
 *
 * Blockly's own drawer uses this same key, and its `createVariableButtonHandler`
 * is what the canvas hangs on it — the prompt it raises goes through the in-app
 * modal (`BlocksCanvas`), because `window.prompt` does nothing in Electron.
 */
export const CREATE_VARIABLE_BUTTON = 'CREATE_VARIABLE'

/**
 * The blocks whose flyout copies are generated per variable, so the curated
 * list's nameless originals stand down once there is something to name.
 */
const BOUND_TO_A_VARIABLE = new Set(['variables_set', 'math_change', 'variables_get'])

/** A toolbox entry for `type`, carrying the registry's shadows, bound to `variable`. */
function boundEntry(type: string, variable: Blockly.IVariableModel<Blockly.IVariableState>): Record<string, unknown> | null {
  const def = blockDefinition(type)
  // A type this build does not know would throw while the flyout renders it and
  // take the whole drawer down with it.
  if (!def || !Blockly.Blocks[type]) return null
  const { fields, ...rest } = def.toolbox ?? {}
  return {
    kind: 'block',
    type,
    ...rest,
    fields: {
      ...(typeof fields === 'object' && fields !== null ? fields : {}),
      VAR: { name: variable.getName(), type: variable.getType() }
    }
  }
}

/** Variable models by name, the order a learner reads a list in. */
function byName(
  variables: Blockly.IVariableModel<Blockly.IVariableState>[]
): Blockly.IVariableModel<Blockly.IVariableState>[] {
  return [...variables].sort((a, b) => a.getName().localeCompare(b.getName(), undefined, { sensitivity: 'base' }))
}

/**
 * The Variables drawer for this workspace (#1117).
 *
 * Pure, and takes a plain `Workspace`: the flyout is a data structure, so what
 * is on the shelf after a learner makes their third variable is a unit test
 * rather than something you find out by opening the drawer.
 */
export function variablesFlyout(
  workspace: Blockly.Workspace,
  dialect: Dialect = 'unknown'
): Record<string, unknown>[] {
  const category = BLOCK_CATEGORIES.find((c) => c.id === 'variables')
  const curated = category ? categoryContents(category, dialect) : []
  const items: Record<string, unknown>[] = [
    { kind: 'button', text: '%{BKY_NEW_VARIABLE}', callbackkey: CREATE_VARIABLE_BUTTON }
  ]

  const variables = workspace.getVariableMap().getVariablesOfType('')
  if (variables.length === 0) return [...items, ...curated]

  // `set` and `change` on the LAST variable — the one just created, which is the
  // one the learner is thinking about. Blockly's own choice, kept.
  const newest = variables[variables.length - 1]
  for (const type of ['variables_set', 'math_change']) {
    const entry = boundEntry(type, newest)
    if (entry) items.push(entry)
  }
  for (const variable of byName(variables)) {
    const entry = boundEntry('variables_get', variable)
    if (entry) items.push(entry)
  }
  // Anything else the category registers — a plugin's block, a future shape —
  // keeps its place. The three above are the ones we have just issued a named
  // copy of, so their nameless originals would only be a duplicate.
  items.push(...curated.filter((c) => !BOUND_TO_A_VARIABLE.has(String(c.type))))
  return items
}

/**
 * Wire the drawer and its button to a live workspace.
 *
 * The button handler is Blockly's own: it prompts for a name, refuses a
 * duplicate, re-prompts, and creates the variable — all of which we would
 * otherwise be reimplementing, badly, in a place a learner meets on day one.
 */
export function installVariablesDrawer(
  workspace: Blockly.WorkspaceSvg,
  dialect: () => Dialect
): void {
  workspace.registerToolboxCategoryCallback(
    VARIABLES_CATEGORY_CALLBACK,
    // The flyout is built as plain data — the same shape `categoryContents`
    // returns, which the toolbox has always handed Blockly — so the cast is
    // about the type of a JSON literal and not about what is in it.
    (ws) => variablesFlyout(ws, dialect()) as unknown as Blockly.utils.toolbox.FlyoutDefinition
  )
  workspace.registerButtonCallback(CREATE_VARIABLE_BUTTON, (button) => {
    Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace())
  })
}
