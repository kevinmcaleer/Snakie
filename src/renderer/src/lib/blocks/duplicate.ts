import * as Blockly from 'blockly/core'

/**
 * DUPLICATE A BLOCK WITH ⌘D / CTRL+D (#1117, epic #1007).
 * =============================================================================
 *
 * Duplicate was already there twice over — on the block's right-click menu, and
 * on a bare `D` for keyboard navigation — and neither is the key a child reaches
 * for. `⌘D` is what the Part Editor has bound since #661, what every drawing app
 * they have used binds, and what somebody who has just built a `repeat` stack
 * they want a second of will try first.
 *
 * SO THIS IS A KEY MAPPING, NOT A SECOND IMPLEMENTATION — the copy itself is
 * Blockly's own clipboard, reached the same way its context-menu item reaches
 * it. One thing is added that Blockly's shortcut cannot do for us:
 * `preventDefault`. Its dispatcher does not call it (a bare `D` has no default
 * to prevent), and in the web build ⌘D is "bookmark this page" — a browser
 * dialog over the canvas instead of a copy of the block. So the mapping goes on
 * a shortcut of our own, which stops the browser first and copies second.
 *
 * Bare `D` keeps working: Blockly's shortcut is untouched, and `Control+68` is
 * a different serialized key from `68`, so nothing collides.
 */

/** Our shortcut's name in Blockly's registry. */
export const DUPLICATE_SHORTCUT = 'snakie_duplicate'

/**
 * What Blockly hands a shortcut: the node with focus.
 *
 * Focus IS selection in Blockly 13 — clicking a block focuses it, and so does
 * arrowing onto one — so this one field answers "which block do they mean"
 * however they got there, including from the keyboard (epic #188).
 */
interface FocusScope {
  focusedNode?: unknown
}

/** What a duplicate would copy, or null if this is not a moment to offer one. */
function duplicable(scope?: FocusScope): Blockly.ICopyable<Blockly.ICopyData> | null {
  const node = scope?.focusedNode
  // `isCopyable` rather than a type test: a workspace comment is as duplicable
  // as a block, and it is the check Blockly's own duplicate shortcut makes.
  if (!node || !Blockly.isCopyable(node)) return null
  // A shadow, an insertion marker, a block the program will not let go of:
  // Blockly's own answer to "could this be duplicated", asked rather than
  // guessed at.
  if (node instanceof Blockly.BlockSvg && !node.isDuplicatable()) return null
  return node
}

/**
 * Duplicate what is focused onto `workspace`.
 *
 * A block and everything INSIDE it, but not the blocks below it — the context
 * menu's rule too: someone asking for a copy of `repeat` means the loop, not
 * the rest of the program that happens to hang off it. That is
 * `toCopyData()`'s own default.
 *
 * Returns whether anything was copied.
 */
export function duplicateFocused(workspace: Blockly.WorkspaceSvg, scope?: FocusScope): boolean {
  const node = duplicable(scope)
  if (!node) return false
  const data = node.toCopyData()
  if (!data) return false
  // Paste rather than a hand-rolled serialise/append: it renumbers ids, lands
  // the copy clear of the original instead of exactly on top of it, selects it
  // so the next drag is the copy, and records one undoable step. It also leaves
  // the learner's actual CLIPBOARD alone — a duplicate must not throw away what
  // they copied a minute ago.
  return Blockly.clipboard.paste(data, workspace) !== null
}

/**
 * Register the shortcut. Idempotent — Blockly's registry is global while a
 * canvas is mounted per file, so a second canvas must not throw on a name that
 * is already there.
 */
export function installDuplicateShortcut(): void {
  const registry = Blockly.ShortcutRegistry.registry
  const keyCodes = [
    registry.createSerializedKey(Blockly.utils.KeyCodes.D, [Blockly.utils.KeyCodes.CTRL]),
    registry.createSerializedKey(Blockly.utils.KeyCodes.D, [Blockly.utils.KeyCodes.META])
  ]
  registry.register(
    {
      name: DUPLICATE_SHORTCUT,
      preconditionFn: (workspace, scope) =>
        !workspace.isDragging() &&
        !workspace.isReadOnly() &&
        !workspace.isFlyout &&
        !!duplicable(scope),
      callback: (workspace, event, _shortcut, scope) => {
        // Before the copy, not after: a copy that finds nothing to do still has
        // to stop the browser bookmarking the page over the top of the canvas.
        event.preventDefault()
        return duplicateFocused(workspace, scope)
      },
      keyCodes,
      allowCollision: true,
      // What the context menu shows beside the item this key belongs to.
      displayText: () => Blockly.Msg['DUPLICATE_BLOCK'] ?? 'Duplicate'
    },
    // An overwrite is exactly what a remount should do, and quietly: the
    // definition is this module's, so the second registration is the same one.
    // `register` re-adds the key mappings itself, and `allowCollision` makes
    // that idempotent rather than a throw.
    true
  )
}
