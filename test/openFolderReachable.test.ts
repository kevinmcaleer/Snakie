import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/main/menu-template'
import type { MenuCommand } from '../src/shared/menu-commands'

/**
 * Open Folder stays reachable (#882).
 *
 * The main toolbar's folder icon was a duplicate of the Local Files panel's own,
 * so it was removed. The risk in that removal is not cosmetic: the toolbar button
 * was the only Open Folder that was ALWAYS on screen. The Files panel can be
 * collapsed (`snakie.collapsed.files` / the layout store's `filesCollapsed`), and
 * the solo workspaces — Electronics and Build — have no files panel at all, so
 * "keep it in the mini toolbar" on its own would have left a user with a
 * collapsed panel no way back to a folder.
 *
 * These are assertions about REACHABILITY, in the places where losing it would be
 * silent. There is no DOM here (the suite runs in `environment: 'node'`), so the
 * checks read the sources — which is also the only way to see the whole wire at
 * once: menu → main → preload → renderer.
 */

const TOOLBAR = readFileSync('src/renderer/src/components/Toolbar.tsx', 'utf8')
const LOCAL_TREE = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')
const MENU = readFileSync('src/main/menu.ts', 'utf8')
const MAIN = readFileSync('src/main/index.ts', 'utf8')
const MAIN_WORKSPACE = readFileSync('src/main/workspace.ts', 'utf8')
const PRELOAD = readFileSync('src/preload/index.ts', 'utf8')
const FALLBACK = readFileSync('src/renderer/src/lib/preloadFallback.ts', 'utf8')
const APP_SHELL = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')

/** The body of the app-menu command subscription in AppShell — what actually
 *  runs when the Open Folder item fires. */
function openFolderHandler(): string {
  const start = APP_SHELL.indexOf('window.api.menu.onCommand(')
  expect(start, 'AppShell subscribes to the menu commands').toBeGreaterThan(-1)
  return APP_SHELL.slice(start, APP_SHELL.indexOf('return off', start))
}

/** The File submenu, as the menu template actually builds it. */
function fileSubmenu(fired: MenuCommand[]): MenuItemConstructorOptions[] {
  const template = appMenuTemplate({
    appName: 'Snakie',
    isMac: true,
    onCommand: (id) => fired.push(id)
  })
  const file = template.find((m) => m.label === 'File')
  return Array.isArray(file?.submenu) ? file.submenu : []
}

describe('the duplicate is gone', () => {
  it('the main toolbar no longer carries an Open Folder button', () => {
    expect(TOOLBAR).not.toContain('Open folder')
    // The icon and its handler go with it — a left-behind constant is dead code
    // that reads like the button is still meant to be there.
    expect(TOOLBAR).not.toContain('OPEN_FOLDER_ICON')
    expect(TOOLBAR).not.toContain('handleOpenFolder')
  })

  it('leaves the toolbar group with New and Save only', () => {
    // Both survivors are the actions the issue explicitly kept.
    expect(TOOLBAR).toContain('aria-label="New file"')
    expect(TOOLBAR).toContain('aria-label="Save active file"')
  })
})

describe('the Local Files panel keeps it', () => {
  it('has the folder button in its mini toolbar', () => {
    expect(LOCAL_TREE).toContain('aria-label="Open folder"')
    expect(LOCAL_TREE).toContain('onClick={handleOpenFolder}')
  })

  it('still offers it on first run, when there is no tree to show', () => {
    // The empty state is the one moment a new user has no folder AND no
    // breadcrumb — the standalone button is the whole path in.
    const empty = LOCAL_TREE.slice(LOCAL_TREE.indexOf('localtree__empty'))
    expect(empty).toContain('Open Folder')
    expect(empty).toContain('handleOpenFolder')
  })
})

describe('the app menu covers a collapsed or absent panel', () => {
  it('offers File ▸ Open Folder… with the standard accelerator', () => {
    // Built from the real template, so this checks the item the user gets rather
    // than a line of source: it has to be IN the File submenu, not merely
    // declared — a menu item nothing lists is exactly as unreachable as the
    // button that was removed.
    const item = fileSubmenu([]).find((m) => m.label === 'Open Folder…')
    expect(item, 'File ▸ Open Folder…').toBeTruthy()
    expect(item?.accelerator).toBe('CmdOrCtrl+O')
    expect(item?.enabled).toBe(true)
  })

  it('is wired to a real handler at startup', () => {
    // Clicking it fires the command; the menu routes commands to the main window
    // and `setupAppMenu` is installed with the resolver that finds it (#914).
    const fired: MenuCommand[] = []
    const item = fileSubmenu(fired).find((m) => m.label === 'Open Folder…')
    ;(item?.click as unknown as () => void)()
    expect(fired).toEqual(['file.openFolder'])
    expect(MAIN).toContain('setupAppMenu(')
  })
})

describe('the wire from the menu to the picker', () => {
  // Open Folder had a hand-built channel of its own until #914; it now travels
  // the ONE command channel every menu item uses.
  const CHANNEL = 'menu:command'

  it('carries the request from main to the main window', () => {
    expect(MENU).toContain(`webContents.send('${CHANNEL}', id)`)
    // A destroyed window would throw and take the menu click with it.
    expect(MENU).toContain('isDestroyed()')
    // The channel it replaced is gone, not left behind half-wired.
    expect(MAIN_WORKSPACE).not.toContain('workspace:openFolder')
  })

  it('is exposed over the bridge on the SAME channel, and unsubscribes', () => {
    expect(PRELOAD).toContain(`ipcRenderer.on('${CHANNEL}'`)
    expect(PRELOAD).toContain(`ipcRenderer.removeListener('${CHANNEL}'`)
    expect(PRELOAD).toContain('onCommand:')
  })

  it('is inert outside Electron, where there is no menu bar', () => {
    expect(FALLBACK).toContain('onCommand: unsub')
  })

  it('ends in the renderer actually opening a folder', () => {
    expect(openFolderHandler()).toMatch(/openFolder\(\)/)
  })
})

describe('the folder lands somewhere the user can see it', () => {
  it('reveals the Files view before raising the picker', () => {
    const body = openFolderHandler()
    expect(body).toContain("setActivityView('files')")
    // The solo workspaces gate their sidebar on the STORE flag, so an imperative
    // `expand()` alone is a no-op there (the bug that hid Help deep-links).
    expect(body).toContain("setLeftCollapsed('files', false)")
    expect(body).toContain('filesRef.current?.expand()')
  })
})
