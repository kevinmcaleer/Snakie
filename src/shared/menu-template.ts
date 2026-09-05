import type { MenuItemConstructorOptions } from 'electron'
import {
  EMPTY_MENU_STATE,
  workspaceMenuCommand,
  type MenuCommand,
  type MenuState
} from './menu-commands'
import { WORKSPACE_IDS, WORKSPACE_INFO } from './workspaces'

/**
 * The application menu as PLAIN DATA (#914).
 *
 * Split out of `menu.ts` so the shape of the menu — which items exist, what
 * each one fires, which are ticked or greyed — is a pure function of the app
 * name, the platform and the renderer's {@link MenuState}. `menu.ts` keeps the
 * two lines that need Electron (`app.name` and `Menu.buildFromTemplate`), and
 * the decisions are testable directly, without a running app.
 *
 * It lives in `src/shared/` rather than `src/main/` (where #914 first put it)
 * because the RENDERER reads it too now: the shortcut cheatsheet (#920) is
 * generated from these `accelerator` strings, so the sheet and the menu cannot
 * drift apart. Nothing here needs a running Electron — the one Electron import
 * is a type.
 *
 * Every item that DOES something goes through `onCommand(id)`: one callback for
 * the whole menu, rather than a positional argument per item (which is how
 * `buildAppMenu(onCheckForUpdates, onOpenBoard, onOpenFolder)` was heading).
 * `menu.ts` routes each id to the main process or to the main window.
 */

export interface MenuTemplateOptions {
  /** `app.name` — the macOS app menu's title. */
  appName: string
  /** macOS puts About / Check for Updates in the app menu, and keeps Close
   *  rather than Quit at the bottom of File. */
  isMac: boolean
  /** What the renderer last said about itself (ticks + greyed-out items).
   *  Defaults to "nothing to say", so the menu built at startup is complete. */
  state?: MenuState
  /** Fires when any command item is clicked. */
  onCommand: (id: MenuCommand) => void
}

/** A menu item that fires `id`, wearing whatever the renderer said about it. */
function commandItem(
  id: MenuCommand,
  label: string,
  o: MenuTemplateOptions,
  extra: Omit<MenuItemConstructorOptions, 'label' | 'click' | 'enabled' | 'checked'> = {}
): MenuItemConstructorOptions {
  const state = o.state ?? EMPTY_MENU_STATE
  // Electron only reads `checked` on a checkbox or radio item, so a plain item
  // doesn't carry one — a tick nothing can show is a claim about the menu that
  // isn't true.
  const ticks = extra.type === 'radio' || extra.type === 'checkbox'
  return {
    label,
    // Absent from the map = normal. Only an explicit `false` greys an item out,
    // so an item nobody has published state for is usable rather than dead.
    enabled: state.enabled[id] !== false,
    ...(ticks ? { checked: state.checked[id] === true } : {}),
    click: () => o.onCommand(id),
    ...extra
  }
}

/**
 * View ▸ Workspace (#916) — built from `WORKSPACE_IDS`, labelled from
 * `WORKSPACE_INFO`, so a fourth workspace appears here on its own and the menu
 * can never disagree with the in-app switcher about what the three are called.
 *
 * `type: 'radio'` with the active one ticked from {@link MenuState}: the switch
 * can happen in either place, and the tick follows.
 *
 * Cmd/Ctrl 1-2-3 (#920 asks for exactly these). Monaco binds Cmd+S, Cmd+F,
 * Cmd+H and Cmd+Shift+1 — but nothing that is a plain modifier plus a digit —
 * so the accelerators are free. Numbering stops at 9 because there is no Cmd+10.
 */
export function workspaceSubmenu(o: MenuTemplateOptions): MenuItemConstructorOptions[] {
  return WORKSPACE_IDS.map((id, i) =>
    commandItem(workspaceMenuCommand(id), WORKSPACE_INFO[id].label, o, {
      type: 'radio',
      ...(i < 9 ? { accelerator: `CmdOrCtrl+${i + 1}` } : {})
    })
  )
}

/**
 * Application menu (issue #89).
 *
 * Snakie previously relied on Electron's default menu (and `autoHideMenuBar`).
 * To add a "Check for Updates…" command we build an explicit menu from the
 * standard roles so the normal Edit / View / Window behaviour is preserved —
 * we only insert our own items. "Check for Updates…" goes:
 *
 *   - macOS  → in the app menu (first menu, named after the app), just after
 *              "About Snakie", matching the platform convention;
 *   - Win/Linux → in a Help menu (created here, since the default template has
 *              none) alongside the About item.
 *
 * File ▸ Open Folder… (#882), View ▸ Board View and View ▸ Workspace (#916) sit
 * where their platform conventions put them, and carry the accelerators that
 * make them reachable without hunting for a button.
 */
export function appMenuTemplate(o: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const isMac = o.isMac

  // The same user-initiated GitHub update check the clickable status-bar version
  // triggers over IPC (see `updater.ts`): in packaged builds it checks GitHub
  // Releases and prompts to download; unpackaged it shows a friendly note.
  const checkForUpdatesItem = commandItem('app.checkForUpdates', 'Check for Updates…', o)

  // Opener for the Board View window (#185). The open windows themselves are
  // listed automatically by the `role: 'windowMenu'` Window menu (now that the
  // window has native chrome); this item just opens/focuses it from the keyboard.
  const boardViewItem = commandItem('view.boardWindow', 'Board View', o, {
    accelerator: 'CmdOrCtrl+Shift+B'
  })

  // Open Folder (#882). The main toolbar's folder icon was a duplicate of the
  // Local Files panel's own, so it went — but that button was ALSO the only
  // Open Folder reachable when the Files panel is collapsed, or in Electronics /
  // Build where there is no files panel at all. The action lives here now, with
  // the accelerator every editor uses for it, so removing the icon removed a
  // duplicate rather than the ability.
  const openFolderItem = commandItem('file.openFolder', 'Open Folder…', o, {
    accelerator: 'CmdOrCtrl+O'
  })

  // Help ▸ Keyboard Shortcuts (#920) — the popup that lists every binding,
  // generated from THIS template (see `shared/shortcuts.ts`). It sits in Help on
  // every platform so it is findable by someone who doesn't know the shortcut
  // for finding shortcuts, and being a menu accelerator makes it self-listing:
  // the sheet shows its own key without anyone typing it anywhere.
  //
  // NOT ⌘H, which #920 originally asked for: on macOS that is Hide Application,
  // a system binding, and stealing it would annoy people far more often than the
  // sheet helps. NOT ⌘/ either, the usual editor choice — Monaco already binds
  // `CmdOrCtrl+Slash` to `editor.action.commentLine` (Toggle Line Comment) and,
  // while the suggest widget is open, to `toggleExplainMode`. A menu accelerator
  // is handled natively BEFORE the web contents sees it, so taking ⌘/ would have
  // silently killed commenting in a code editor — which is this issue's own
  // failure mode from the other direction. ⌘⇧/ (i.e. ⌘? on a US layout) is what
  // Slack, GitHub and Gmail use for this, and Monaco binds no Shift+Slash at all.
  const shortcutsItem = commandItem('help.shortcuts', 'Keyboard Shortcuts', o, {
    accelerator: 'CmdOrCtrl+Shift+/'
  })

  return [
    // macOS app menu (omitted on Windows/Linux). About → Check for Updates → …
    ...(isMac
      ? ([
          {
            label: o.appName,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [openFolderItem, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' }
            ] as MenuItemConstructorOptions[])
          : ([
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Workspace', submenu: workspaceSubmenu(o) },
        boardViewItem,
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // The Window menu uses the standard `windowMenu` role so the OS manages it —
    // on macOS that AUTO-LISTS every open window (the main editor, the Board View
    // and Find & Replace), which is what #185 wanted; this works now that those
    // windows have native chrome (frameless windows were skipped by the OS list).
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        // On macOS "Check for Updates…" lives in the app menu, so the Help menu
        // only needs the About item on Windows/Linux (macOS already has About in
        // its app menu). Keep a Help menu everywhere for a consistent home.
        ...(isMac
          ? []
          : ([
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])),
        shortcutsItem
      ]
    }
  ]
}
