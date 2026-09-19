import * as Blockly from 'blockly/core'
import { pinAliasesIn, pwmAliasesIn } from './board-pins'

/**
 * A NAME A PROGRAM DECLARES IS A NAME ITS BLOCKS CAN REACH.
 * =============================================================================
 *
 * `name PWM on pin [GP7 ▾] as [motor_b_speed]` declares a name. `set power of
 * ( ) to [50] %` takes one in a SOCKET, and what goes in that socket is an
 * ordinary `variables_get` — so the dropdown on it lists the WORKSPACE
 * VARIABLES, and a declaration is not one of those. It is a text field on the
 * naming block.
 *
 * So a PWM the program had declared and not yet used was unreachable: the
 * reader (`python-to-blocks.ts`) declares a variable for a name it finds BEING
 * USED, which is why `motor_a_speed` — already driven somewhere in the file —
 * was on the menu while `motor_b_speed`, declared on the very next line and
 * used nowhere yet, was not. The learner's way out was to use the name first,
 * which they could not do without the menu, or to type it into *Create
 * variable* by hand and hope it matched. The same trap catches the block a
 * learner has just DRAGGED: a fresh `name PWM` block names something no socket
 * in the program can then point at.
 *
 * This closes it by making the declaration do what it looks like it does —
 * declare a name, for the whole program, on every dropdown that offers names.
 * Both kinds: `name pin` too, because `set pin ( ) to [high]` is the same block
 * shape with the same socket, and `echo` declared-and-unused was as unreachable
 * as `motor_b_speed`.
 *
 * IT IS SAFE TO SHARE THE NAME with the declaration, which is the part that
 * would otherwise be alarming: the generator already knows these names are
 * spoken for (`declaredPins`) and leaves a variable that matches one ALONE
 * rather than renaming it `motor_b_speed_` — without that the declaration and
 * the blocks using it would end up pointing at two different objects. So the
 * variable this creates generates the very identifier the naming block wrote.
 *
 * AND IT TIDIES UP AFTER ITSELF. The name field is a text box, and Blockly
 * fires a change per keystroke — so declaring `motor_b_speed` would otherwise
 * leave `m`, `mo`, `mot`… behind it, one ghost per letter, in every dropdown in
 * the program. A variable this module created, which no declaration claims any
 * more and no block uses, goes away again. One the LEARNER made, or one that
 * has found a use since, is never touched: the set below is what this module
 * put there, not everything that happens to share a name with a pin.
 */

/**
 * The variables this module created, per workspace.
 *
 * A `WeakMap` because the canvas disposes and rebuilds workspaces (a theme
 * change, a remount) and this must not be what keeps a dead one alive.
 */
const declared = new WeakMap<Blockly.Workspace, Set<string>>()

/**
 * The variable of that name, if the workspace has one.
 *
 * The UNTYPED kind (`''`), which is what `variables_get` — the block in the
 * socket — offers and what Blockly's own Create variable button makes.
 */
function variableNamed(
  workspace: Blockly.Workspace,
  name: string
): Blockly.IVariableModel<Blockly.IVariableState> | null {
  return workspace.getVariableMap().getVariable(name, '')
}

/**
 * Give every name this program declares a variable, and take back the ones the
 * program has stopped declaring.
 *
 * Returns whether anything changed, for a caller that wants to redraw.
 *
 * EVENTS OFF while it works. Two reasons, and both are about the learner rather
 * than about Blockly: a variable created inside a change listener would land on
 * the UNDO STACK, so the first ⌘Z after naming a motor would undo a variable
 * the learner never knowingly made instead of the naming itself; and the canvas
 * treats a change event as an edit, so a file would go dirty for being opened.
 * The variable map is still the real one — a save reads it whether or not the
 * creation announced itself.
 */
export function syncHardwareVariables(workspace: Blockly.Workspace): boolean {
  const names = new Set([
    ...pinAliasesIn(workspace).map((alias) => alias.name),
    ...pwmAliasesIn(workspace)
  ])
  const ours = declared.get(workspace) ?? new Set<string>()
  declared.set(workspace, ours)
  let changed = false

  Blockly.Events.disable()
  try {
    for (const name of names) {
      if (variableNamed(workspace, name)) continue
      ours.add(workspace.getVariableMap().createVariable(name, '').getId())
      changed = true
    }
    for (const id of [...ours]) {
      const variable = workspace.getVariableMap().getVariableById(id)
      // Gone already — deleted through the Variables drawer, or with the
      // workspace it lived on.
      if (!variable) {
        ours.delete(id)
        continue
      }
      if (names.has(variable.getName())) continue
      // A USE outranks the declaration that started it: a learner who deletes
      // the naming block while blocks still say `motor_b_speed` has a program
      // with a mistake in it, and `pin-conflicts.ts` is what says so. Deleting
      // the variable here would delete those blocks instead.
      if (Blockly.Variables.getVariableUsesById(workspace, id).length > 0) continue
      workspace.getVariableMap().deleteVariable(variable)
      ours.delete(id)
      changed = true
    }
  } finally {
    Blockly.Events.enable()
  }
  return changed
}
