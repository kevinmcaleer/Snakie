import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/shared/menu-template'
import { menuStateFrom, type MenuCommand } from '../src/shared/menu-commands'
import { takePendingFlash } from '../src/renderer/src/components/board-finder-bus'

/**
 * The Tools menu (#917, epic #913).
 *
 * These were reachable only by knowing which panel hid the button — and the
 * Board Finder was two clicks deep behind another tool, since the only way in
 * was through the firmware flasher.
 */

const ctx = (over: Partial<Parameters<typeof menuStateFrom>[0]> = {}) =>
  menuStateFrom({
    workspace: 'code',
    hasActiveFile: true,
    recentFolders: [],
    connected: true,
    hasSyncedFiles: true,
    ...over
  })

const toolsSubmenu = (isMac = true): MenuItemConstructorOptions[] => {
  const template = appMenuTemplate({
    appName: 'Snakie',
    isMac,
    state: ctx(),
    onCommand: () => {}
  })
  const menu = template.find((m) => m.label === 'Tools')
  return Array.isArray(menu?.submenu) ? menu.submenu : []
}

describe('the Tools menu lists the tools', () => {
  it.each([true, false])('on both platforms (isMac=%s)', (isMac) => {
    const labels = toolsSubmenu(isMac)
      .filter((m) => m.label)
      .map((m) => String(m.label))
    expect(labels).toEqual([
      'Firmware Flasher…',
      'Board Finder…',
      'Parts Catalog…',
      'Sprite Editor…',
      'Find & Replace…',
      'Settings…'
    ])
  })

  it('sits after View and before Window', () => {
    const titles = appMenuTemplate({
      appName: 'Snakie',
      isMac: true,
      state: ctx(),
      onCommand: () => {}
    }).map((m) => m.label ?? m.role)
    expect(titles.indexOf('Tools')).toBeGreaterThan(titles.indexOf('View'))
    expect(titles.indexOf('Tools')).toBeLessThan(titles.indexOf('windowMenu'))
  })
})

describe('what greys out, and what deliberately does not', () => {
  const on = (id: MenuCommand, over: Parameters<typeof ctx>[0]): boolean | undefined =>
    ctx(over).enabled[id]

  it('greys Find with nothing to search', () => {
    expect(on('tools.find', { hasActiveFile: false })).toBe(false)
    expect(on('tools.find', { hasActiveFile: true })).toBe(true)
  })

  it('keeps the Board Finder available with no board connected', () => {
    // Backwards otherwise: looking a board up is what you do BEFORE you have one
    // working, and often the reason you cannot connect to it yet.
    expect(on('tools.boardFinder', { connected: false })).toBeUndefined()
    expect(on('tools.flasher', { connected: false })).toBeUndefined()
  })
})

describe('the Board Finder has two doors that agree (#896 / #917)', () => {
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
  const bar = readFileSync('src/renderer/src/components/StatusBar.tsx', 'utf8')
  const flasher = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')

  it('still lives inside the flash dialog', () => {
    // #896 put it there so a pick lands in the dialog you are already looking
    // at. Adding a second door must not take the first one away.
    expect(flasher).toContain('<BoardFinder')
  })

  it('does NOT go back into the status bar', () => {
    // #896 moved it out precisely so there were not two entry points that
    // disagreed about where a pick lands. The standalone door is the app frame's.
    expect(bar).not.toContain('BoardFinder')
    expect(shell).toContain('{finderOpen && <BoardFinder')
  })

  it('ends a pick in the flasher whichever door it came through', () => {
    // From inside, the flasher is mounted and hears the event. From outside, the
    // request is retained, the flasher is asked to open, and it reads the
    // request as it mounts.
    expect(shell).toContain("dispatchOpenTool('flasher')")
    expect(flasher).toContain('takePendingFlash()')
  })
})

describe('a retained flash request is used once, and only once', () => {
  it('hands the request over and forgets it', () => {
    // Applying it twice would silently re-select a board the user had since
    // changed by hand — the failure mode of "remember the last pick" done badly.
    expect(takePendingFlash()).toBeNull()
  })

  it('is cleared by the dialog that was already open', () => {
    const flasher = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')
    const listener = flasher.slice(flasher.indexOf('const onFlashBoard'))
    // The listener clears the retained copy, so the mount path cannot re-apply
    // what the listener has just handled.
    expect(listener.slice(0, 400)).toContain('takePendingFlash()')
  })
})

describe('the tools that already had a way in keep using it', () => {
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')

  it('reuses the existing events rather than inventing listeners', () => {
    // The one-line case the dispatcher was built for.
    expect(shell).toContain('OPEN_SPRITE_EDITOR_EVENT')
    expect(shell).toContain('dispatchOpenFind(false)')
    expect(shell).toContain('OPEN_SETTINGS_EVENT')
  })

  it('opens the Parts Catalog in the window that actually has it', () => {
    // It lives in the Board Viewer window, so the route is: ask the main
    // process, which opens that window if needed and relays the request.
    expect(shell).toContain(".openTool('partsCatalog')")
    const main = readFileSync('src/main/board.ts', 'utf8')
    expect(main).toContain("ipcMain.handle('board:tool'")
    const boardMain = readFileSync('src/renderer/src/board-main.tsx', 'utf8')
    expect(boardMain).toContain('onOpenTool')
    expect(boardMain).toContain('OPEN_PART_CATALOG_EVENT')
  })

  it('waits for a window that is still loading', () => {
    // A message sent to a window created milliseconds ago arrives before there
    // is a renderer to hear it, and is simply lost.
    const main = readFileSync('src/main/board.ts', 'utf8')
    const handler = main.slice(main.indexOf("ipcMain.handle('board:tool'"))
    expect(handler.slice(0, 700)).toContain('did-finish-load')
  })
})
