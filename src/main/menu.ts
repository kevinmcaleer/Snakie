import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { appMenuTemplate } from './menu-template'
import {
  EMPTY_MENU_STATE,
  coerceMenuState,
  type MainMenuCommand,
  type MenuCommand,
  type MenuState
} from '../shared/menu-commands'

/**
 * The application menu, and the one channel it talks to the app through (#914).
 *
 * `menu-template.ts` decides what the menu LOOKS like; this file owns the two
 * halves that need a live app:
 *
 *   menu:command  (main → MAIN WINDOW)  a command id the renderer runs
 *   menu:state    (MAIN WINDOW → main)  ticks + greyed-out items, then rebuild
 *
 * Clicking any item calls one `onCommand(id)`. A command in `handlers` is a main
 * process action (the updater, the Board View window) and runs here; anything
 * else is relayed to the main window, where one dispatcher turns it into a store
 * action or one of the window events the app already listens for. That is why
 * adding a menu item is no longer six edits and another positional argument on
 * `buildAppMenu`.
 *
 * The state comes back the other way because the menu is built HERE and every
 * fact it reflects — which workspace is showing, whether a board is connected,
 * whether a file is open — lives THERE. A published state rebuilds the menu, so
 * the View ▸ Workspace radio follows the in-app switcher (#916).
 */

/** The renderer's latest published state (ticks + greyed items). */
let menuState: MenuState = EMPTY_MENU_STATE
/** Serialised `menuState`, so a republish that changes nothing doesn't rebuild
 *  the menu — the renderer publishes on every relevant state change, and on
 *  macOS a needless `setApplicationMenu` visibly closes an open menu. */
let menuStateKey = JSON.stringify(EMPTY_MENU_STATE)
/** Resolver for the main editor window — the renderer that runs the relayed
 *  commands. Captured at setup, so registration order doesn't matter. */
let resolveMainWindow: () => BrowserWindow | null = () => null
/** Main-process commands and what they do. `Record<MainMenuCommand, …>` makes a
 *  command with no handler a COMPILE error, the same guarantee the renderer's
 *  dispatcher gets from its own exhaustive table. */
let mainHandlers: Record<MainMenuCommand, () => void> | null = null

/** Route one clicked command: main-process commands run here, everything else
 *  goes to the main window. A command sent while no main window exists is
 *  dropped — there is nothing to run it. */
function dispatch(id: MenuCommand): void {
  const local = mainHandlers?.[id as MainMenuCommand]
  if (local) {
    local()
    return
  }
  const mw = resolveMainWindow()
  if (mw && !mw.isDestroyed()) mw.webContents.send('menu:command', id)
}

/**
 * Build the application menu for the current app name, platform and state.
 *
 * @param onCommand handler for every command item in the menu.
 * @param state the renderer's ticks + greyed-out items (defaults to none).
 */
export function buildAppMenu(
  onCommand: (id: MenuCommand) => void,
  state: MenuState = EMPTY_MENU_STATE
): Menu {
  return Menu.buildFromTemplate(
    appMenuTemplate({
      appName: app.name,
      isMac: process.platform === 'darwin',
      state,
      onCommand
    })
  )
}

/** Rebuild the menu from the current state and install it. */
function install(): void {
  Menu.setApplicationMenu(buildAppMenu(dispatch, menuState))
}

/**
 * Build the application menu, install it as the global menu, and register the
 * command channel. Called once at startup from `app.whenReady`.
 *
 * @param handlers the main-process commands (updater, Board View window).
 * @param getMainWindow resolves the live editor window, for relayed commands.
 */
export function setupAppMenu(
  handlers: Record<MainMenuCommand, () => void>,
  getMainWindow: () => BrowserWindow | null
): void {
  mainHandlers = handlers
  resolveMainWindow = getMainWindow

  // The renderer publishes what the menu should reflect whenever it changes.
  // Sanitised here: it crosses a process boundary, so an unknown id or a
  // non-boolean would otherwise reach the template as an item nobody can explain.
  ipcMain.on('menu:state', (_e, raw: unknown) => {
    const next = coerceMenuState(raw)
    const key = JSON.stringify(next)
    if (key === menuStateKey) return
    menuState = next
    menuStateKey = key
    install()
  })

  install()
}

/** Forget the menu's wiring (used on quit / in tests). */
export function disposeAppMenu(): void {
  menuState = EMPTY_MENU_STATE
  menuStateKey = JSON.stringify(EMPTY_MENU_STATE)
  mainHandlers = null
  resolveMainWindow = () => null
}
