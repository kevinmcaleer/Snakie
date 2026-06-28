import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Application menu (issue #89).
 *
 * Snakie previously relied on Electron's default menu (and `autoHideMenuBar`).
 * To add a "Check for Updates…" command we build an explicit menu from the
 * standard roles so the normal Edit / View / Window behaviour is preserved —
 * we only insert our own item:
 *
 *   - macOS  → in the app menu (first menu, named after the app), just after
 *              "About Snakie", matching the platform convention;
 *   - Win/Linux → in a Help menu (created here, since the default template has
 *              none) alongside the About item.
 *
 * The item invokes the same `checkForUpdatesManual` the clickable status-bar
 * version triggers via IPC — a user-initiated GitHub update check (see
 * `updater.ts`). It works the same way everywhere: in packaged builds it checks
 * GitHub Releases and prompts to download; unpackaged it shows a friendly note.
 *
 * @param onCheckForUpdates handler for the "Check for Updates…" item.
 */
export function buildAppMenu(onCheckForUpdates: () => void, onOpenBoard: () => void): Menu {
  const isMac = process.platform === 'darwin'
  const appName = app.name

  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => onCheckForUpdates()
  }

  // The Board View is a separate (frameless) window, so it isn't reliably picked
  // up by the macOS auto window-list — list it explicitly so it's reachable from
  // the keyboard / Window menu (#185).
  const boardViewItem: MenuItemConstructorOptions = {
    label: 'Board View',
    accelerator: 'CmdOrCtrl+Shift+B',
    click: () => onOpenBoard()
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
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
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
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        boardViewItem,
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ] as MenuItemConstructorOptions[])
          : ([{ type: 'separator' }, { role: 'close' }] as MenuItemConstructorOptions[]))
      ]
    },
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
export function setupAppMenu(onCheckForUpdates: () => void, onOpenBoard: () => void): void {
  Menu.setApplicationMenu(buildAppMenu(onCheckForUpdates, onOpenBoard))
}
