/**
 * ONE TYPED COMMAND CHANNEL FOR THE APPLICATION MENU (#914, epic #913).
 *
 * Before this, every menu item that had to reach the renderer was wired by
 * hand. `File ▸ Open Folder…` (#882) took six edits: its own IPC channel, a
 * relay to the main window, a preload subscription, a no-op stub for the web
 * build, a listener in `AppShell`, and another positional argument on
 * `buildAppMenu(onCheckForUpdates, onOpenBoard, onOpenFolder)`. Epic #913 adds a
 * dozen more items; done that way, the menu ends up half-wired — items that
 * quietly do nothing on one platform or in one window, with nothing to catch it.
 *
 * So there is one channel (`menu:command`) carrying one id from the union
 * below, and one dispatcher in the renderer. Both sides import THIS module, so
 * main, preload and renderer cannot disagree about what exists, and a new menu
 * item is an id plus a handler.
 *
 * TWO FAMILIES, because a menu item's action lives on one side or the other:
 *
 *   MAIN_MENU_COMMANDS      handled in the main process (it owns the updater and
 *                           the Board View window) — never crosses to a renderer.
 *   RENDERER_MENU_COMMANDS  relayed to the MAIN WINDOW over `menu:command`, where
 *                           the dispatcher turns them into a store action or one
 *                           of the window events live components already listen
 *                           for (`snakie:open-find`, `snakie:open-help`, …).
 *
 * STATE TRAVELS BACK. Menu items are not only actions: View ▸ Workspace wants a
 * radio tick that follows the in-app switcher, Disconnect should grey out with
 * no board connected, Save with no file open. The menu is built in main and
 * every one of those facts lives in the renderer, so {@link MenuState} goes the
 * other way over `menu:state` — one map of ids to grey out, one of ids to tick.
 * It is deliberately keyed by COMMAND ID rather than by feature, so #915–#918
 * add an item's state the same way they add the item, and cannot each invent a
 * different return path.
 */
import { WORKSPACE_IDS, type WorkspaceId } from './workspaces'

/** Commands the MAIN process performs itself. */
export const MAIN_MENU_COMMANDS = ['app.checkForUpdates', 'view.boardWindow'] as const
export type MainMenuCommand = (typeof MAIN_MENU_COMMANDS)[number]

/** `View ▸ Workspace ▸ …` — one command per workspace (#916). */
export type WorkspaceMenuCommand = `workspace.show.${WorkspaceId}`

/** The command that shows workspace `id`. */
export function workspaceMenuCommand(id: WorkspaceId): WorkspaceMenuCommand {
  return `workspace.show.${id}`
}

/** Commands the RENDERER performs, relayed to the main window. */
export type RendererMenuCommand = 'file.openFolder' | WorkspaceMenuCommand

/** Every renderer command, in menu order. The workspace entries are DERIVED
 *  from `WORKSPACE_IDS`, so a fourth workspace gets its command, its menu item
 *  and its handler without anyone editing a list. */
export const RENDERER_MENU_COMMANDS: readonly RendererMenuCommand[] = [
  'file.openFolder',
  ...WORKSPACE_IDS.map(workspaceMenuCommand)
]

/** Any application-menu command. */
export type MenuCommand = MainMenuCommand | RendererMenuCommand

/** Is `v` a command this build's renderer knows how to run? Guards the IPC
 *  boundary: an id from an older/newer main process is dropped rather than
 *  dispatched into nothing. */
export function isRendererMenuCommand(v: unknown): v is RendererMenuCommand {
  return typeof v === 'string' && (RENDERER_MENU_COMMANDS as readonly string[]).includes(v)
}

/**
 * What the renderer tells the menu about itself.
 *
 * Both maps are SPARSE and keyed by command id: absent means "nothing to say".
 * An item is enabled unless `enabled[id] === false`, and unticked unless
 * `checked[id] === true` — so a menu built before the renderer has ever
 * published (at startup, or in a build with no renderer at all) is the normal
 * menu rather than a dead one.
 */
export interface MenuState {
  /** Ids to grey out (`false` = disabled). */
  enabled: Partial<Record<MenuCommand, boolean>>
  /** Ids to tick — radio items and checkboxes (`true` = checked). */
  checked: Partial<Record<MenuCommand, boolean>>
}

/** The state a menu built before the renderer has spoken uses: everything
 *  enabled, nothing ticked. */
export const EMPTY_MENU_STATE: MenuState = { enabled: {}, checked: {} }

/** The renderer facts the menu reflects. #915–#918 add their fields here
 *  (`connected`, `hasFile`, …) and extend {@link menuStateFrom} to match. */
export interface MenuContext {
  /** The workspace showing in the main window — the radio tick in
   *  View ▸ Workspace, so switching in-app moves the tick too (#916). */
  workspace: WorkspaceId
}

/** Derive the menu's state from the renderer's. Pure, so what the menu shows is
 *  testable without a menu. */
export function menuStateFrom(ctx: MenuContext): MenuState {
  const checked: Partial<Record<MenuCommand, boolean>> = {}
  for (const id of WORKSPACE_IDS) checked[workspaceMenuCommand(id)] = id === ctx.workspace
  return { enabled: {}, checked }
}

/** Every known command id (main + renderer) — the whitelist
 *  {@link coerceMenuState} filters against. */
const ALL_MENU_COMMANDS: readonly string[] = [...MAIN_MENU_COMMANDS, ...RENDERER_MENU_COMMANDS]

/** One sparse map, keeping only known ids with boolean values. */
function coerceFlags(raw: unknown): Partial<Record<MenuCommand, boolean>> {
  const out: Partial<Record<MenuCommand, boolean>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean' && ALL_MENU_COMMANDS.includes(key)) {
      out[key as MenuCommand] = value
    }
  }
  return out
}

/**
 * Validate a `MenuState` that arrived over IPC.
 *
 * The state comes from a renderer, so it is untrusted shape: a stale window
 * could publish an id this build retired, or a garbled payload. Unknown ids and
 * non-boolean values are dropped rather than fed into the menu template, where
 * they would show as items the user cannot explain.
 */
export function coerceMenuState(raw: unknown): MenuState {
  const r = (raw ?? {}) as Record<string, unknown>
  return { enabled: coerceFlags(r.enabled), checked: coerceFlags(r.checked) }
}
