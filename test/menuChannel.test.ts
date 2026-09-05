import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { menuStateFrom, workspaceMenuCommand } from '../src/shared/menu-commands'

/**
 * The main-process half of the menu command channel (#914).
 *
 * Two things have to hold for the follow-on menu work (#915–#918) to be one line
 * each: a clicked item reaches the right side of the process boundary, and the
 * state the renderer publishes reaches the menu. Both are exercised here against
 * the real `menu.ts`, with only Electron's own surface mocked.
 */

const installed = vi.hoisted(() => [] as { template: MenuItemConstructorOptions[] }[])
const channels = vi.hoisted(() => new Map<string, (e: unknown, ...args: unknown[]) => void>())
const sent = vi.hoisted(() => [] as { channel: string; args: unknown[] }[])
const win = vi.hoisted(() => ({
  destroyed: false,
  isDestroyed(): boolean {
    return this.destroyed
  },
  webContents: {
    send: (channel: string, ...args: unknown[]): void => {
      sent.push({ channel, args })
    }
  }
}))

vi.mock('electron', () => ({
  app: { name: 'Snakie' },
  BrowserWindow: class {},
  ipcMain: {
    on: (channel: string, fn: (e: unknown, ...args: unknown[]) => void): void => {
      channels.set(channel, fn)
    }
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({ template }),
    setApplicationMenu: (menu: { template: MenuItemConstructorOptions[] }): void => {
      installed.push(menu)
    }
  }
}))

const { setupAppMenu, disposeAppMenu } = await import('../src/main/menu')

/** Every item with a click, from the most recently installed menu. */
function items(): MenuItemConstructorOptions[] {
  const walk = (list: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => {
    const out: MenuItemConstructorOptions[] = []
    for (const item of list) {
      if (item.click) out.push(item)
      if (Array.isArray(item.submenu)) out.push(...walk(item.submenu))
    }
    return out
  }
  return walk(installed[installed.length - 1].template)
}

/** Click the item labelled `label` in the installed menu. */
function click(label: string): void {
  const item = items().find((m) => m.label === label)
  expect(item, label).toBeTruthy()
  ;(item?.click as unknown as () => void)()
}

/** Publish a `menu:state` payload the way the renderer would. */
function publish(state: unknown): void {
  channels.get('menu:state')?.(null, state)
}

describe('the app menu command channel (#914)', () => {
  let checks = 0
  let boards = 0

  beforeEach(() => {
    installed.length = 0
    sent.length = 0
    channels.clear()
    win.destroyed = false
    checks = 0
    boards = 0
    disposeAppMenu()
    setupAppMenu(
      {
        'app.checkForUpdates': () => {
          checks += 1
        },
        'view.boardWindow': () => {
          boards += 1
        }
      },
      () => win as never
    )
  })

  it('installs a menu at startup', () => {
    expect(installed).toHaveLength(1)
    expect(items().length).toBeGreaterThan(0)
  })

  it('runs a MAIN-process command here, without troubling the renderer', () => {
    click('Check for Updates…')
    click('Board View')
    expect([checks, boards]).toEqual([1, 1])
    expect(sent).toEqual([])
  })

  it('relays a RENDERER command to the main window on one channel', () => {
    click('Open Folder…')
    click('Electronics')
    expect(sent).toEqual([
      { channel: 'menu:command', args: ['file.openFolder'] },
      { channel: 'menu:command', args: [workspaceMenuCommand('board')] }
    ])
  })

  it('drops a command when the window has gone, rather than throwing', () => {
    win.destroyed = true
    expect(() => click('Open Folder…')).not.toThrow()
    expect(sent).toEqual([])
  })

  it('rebuilds the menu when the renderer publishes its state', () => {
    publish(menuStateFrom({ workspace: 'robot' }))
    expect(installed).toHaveLength(2)
    const ticked = items().filter((m) => m.checked)
    expect(ticked.map((m) => m.label)).toEqual(['Build'])
  })

  it('does not rebuild when the state has not actually changed', () => {
    publish(menuStateFrom({ workspace: 'board' }))
    publish(menuStateFrom({ workspace: 'board' }))
    // A rebuild closes an open menu on macOS, and the renderer republishes on
    // every mount — so an unchanged state must be a no-op.
    expect(installed).toHaveLength(2)
    publish(menuStateFrom({ workspace: 'code' }))
    expect(installed).toHaveLength(3)
  })

  it('ignores a garbled state instead of feeding it to the menu', () => {
    publish({ enabled: { 'not.a.command': false }, checked: 'nonsense' })
    // Nothing known changed, so nothing is rebuilt…
    expect(installed).toHaveLength(1)
    // …and every item is still usable.
    expect(items().every((m) => m.enabled)).toBe(true)
  })
})
