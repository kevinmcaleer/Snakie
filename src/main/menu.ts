import { app, Menu, type MenuItemConstructorOptions } from 'electron'

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
 * File ▸ Open Folder… (#882) and View ▸ Board View sit where their platform
 * conventions put them, and carry the accelerators that make them reachable
 * without hunting for a button.
 *
 * The item invokes the same `checkForUpdatesManual` the clickable status-bar
 * version triggers via IPC — a user-initiated GitHub update check (see
 * `updater.ts`). It works the same way everywhere: in packaged builds it checks
 * GitHub Releases and prompts to download; unpackaged it shows a friendly note.
 *
 * @param onCheckForUpdates handler for the "Check for Updates…" item.
 * @param onOpenBoard handler for the Board View item.
 * @param onOpenFolder handler for the File ▸ Open Folder… item.
 */
export function buildAppMenu(
  onCheckForUpdates: () => void,
  onOpenBoard: () => void,
  onOpenFolder: () => void
): Menu {
  const isMac = process.platform === 'darwin'
  const appName = app.name

  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => onCheckForUpdates()
  }

  // Opener for the Board View window (#185). The open windows themselves are
  // listed automatically by the `role: 'windowMenu'` Window menu (now that the
  // window has native chrome); this item just opens/focuses it from the keyboard.
  const boardViewItem: MenuItemConstructorOptions = {
    label: 'Board View',
    accelerator: 'CmdOrCtrl+Shift+B',
    click: () => onOpenBoard()
  }

  // Open Folder (#882). The main toolbar's folder icon was a duplicate of the
  // Local Files panel's own, so it went — but that button was ALSO the only
  // Open Folder reachable when the Files panel is collapsed, or in Electronics /
  // Build where there is no files panel at all. The action lives here now, with
  // the accelerator every editor uses for it, so removing the icon removed a
  // duplicate rather than the ability.
  const openFolderItem: MenuItemConstructorOptions = {
    label: 'Open Folder…',
    accelerator: 'CmdOrCtrl+O',
    click: () => onOpenFolder()
  }

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu (omitted on Windows/Linux). About → Check for Updates → …
    ...(isMac
      ? ([
          {
            label: appName,
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
        ...(isMac ? [] : ([{ role: 'about' }, checkForUpdatesItem] as MenuItemConstructorOptions[]))
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

/**
 * Build the application menu and install it as the global menu. Called once at
 * startup from `app.whenReady`.
 */
export function setupAppMenu(
  onCheckForUpdates: () => void,
  onOpenBoard: () => void,
  onOpenFolder: () => void
): void {
  Menu.setApplicationMenu(buildAppMenu(onCheckForUpdates, onOpenBoard, onOpenFolder))
}
