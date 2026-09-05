import {
  isRendererMenuCommand,
  workspaceMenuCommand,
  type RendererMenuCommand
} from '../../../shared/menu-commands'
import { WORKSPACE_IDS, type WorkspaceId } from '../../../shared/workspaces'

/**
 * THE RENDERER HALF OF THE MENU COMMAND CHANNEL (#914).
 *
 * One table: command id → what it does. AppShell subscribes once, and a new
 * menu item is an id in `RENDERER_MENU_COMMANDS` plus a line here — not a
 * channel, a relay, a subscription, a web stub and another argument on
 * `buildAppMenu`.
 *
 * The table is a `Record<RendererMenuCommand, …>`, so an id with no handler is a
 * COMPILE error, and `test/menuCommands.test.ts` checks the reverse at runtime:
 * every id has a handler, every handler an id. A menu item that silently does
 * nothing is the failure this whole seam exists to prevent.
 *
 * Handlers take no arguments and reach the app through {@link MenuCommandDeps},
 * so this module is pure and testable in a node environment — no React, no
 * `window`. A command that maps to one of the window events live components
 * already listen for (`snakie:open-find`, `snakie:open-help`,
 * `snakie:open-settings`, `snakie:open-part-editor`, `snakie:open-sprite-editor`)
 * is one line: `() => window.dispatchEvent(new CustomEvent(HELP_EVENT))`, with
 * no new listener anywhere.
 */

export interface MenuCommandDeps {
  /**
   * Show a workspace (#916).
   *
   * MUST be the layout store's `switchWorkspace` — the same call the in-app
   * switcher makes. Electronics and Build are SOLO workspaces whose sidebar is
   * gated on the store's `filesCollapsed` flag (#775), so a switch that rebuilt
   * the layout instead would land the user in a workspace whose sidebar will not
   * open — and would remount Monaco, which the store goes out of its way to
   * avoid by keeping the editor mounted behind a zero-width panel.
   */
  switchWorkspace: (id: WorkspaceId) => void
  /** Raise the folder picker and open what it returns (#882). The picker belongs
   *  to the renderer — `fs.openFolderDialog` is what turns a chosen directory
   *  into the workspace's `currentFolder` — so the menu only pulls the trigger. */
  openFolder: () => void
  /** Show the keyboard-shortcut cheatsheet (#920). The sheet is generated from
   *  the menu template, so this only has to raise it. */
  showShortcuts: () => void
}

/** Every renderer menu command and what it does. */
export function menuCommandHandlers(deps: MenuCommandDeps): Record<RendererMenuCommand, () => void> {
  const handlers = {
    'file.openFolder': () => deps.openFolder(),
    'help.shortcuts': () => deps.showShortcuts()
  } as Record<RendererMenuCommand, () => void>
  // Derived from WORKSPACE_IDS, like the menu itself: a fourth workspace gets
  // its menu item AND its handler with no edit here.
  for (const id of WORKSPACE_IDS) {
    handlers[workspaceMenuCommand(id)] = () => deps.switchWorkspace(id)
  }
  return handlers
}

/**
 * Run the command `id` names. Returns whether anything ran.
 *
 * The id crosses a process boundary, so it is validated rather than trusted: a
 * command from a newer main process (or a stale window) is dropped, the same way
 * `coerceWorkspaceId` drops a workspace this build doesn't have.
 */
export function runMenuCommand(id: unknown, deps: MenuCommandDeps): boolean {
  if (!isRendererMenuCommand(id)) return false
  menuCommandHandlers(deps)[id]()
  return true
}
