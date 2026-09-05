import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/shared/menu-template'
import { menuStateFrom, type MenuCommand } from '../src/shared/menu-commands'
import { allShortcuts } from '../src/shared/shortcuts'

/**
 * The Device menu (#918, epic #913).
 *
 * Everything a user does TO THE BOARD was reachable only from the toolbar or the
 * console panel, with no menu entry and no keyboard route — including the two
 * most-used actions in the app.
 *
 * The strongest reason this menu needed #914's state channel: device state
 * changes constantly, a cable gets knocked, and a Run item that looks available
 * with nothing plugged in makes the APP look broken rather than the board look
 * absent. So most of this file is about what greys out, and when.
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

const deviceSubmenu = (isMac: boolean): MenuItemConstructorOptions[] => {
  const template = appMenuTemplate({
    appName: 'Snakie',
    isMac,
    state: ctx(),
    onCommand: () => {}
  })
  const menu = template.find((m) => m.label === 'Device')
  return Array.isArray(menu?.submenu) ? menu.submenu : []
}

describe('the Device menu exists on both platforms', () => {
  it.each([true, false])('lists the board actions (isMac=%s)', (isMac) => {
    const labels = deviceSubmenu(isMac)
      .filter((m) => m.label)
      .map((m) => String(m.label))
    expect(labels).toEqual([
      'Connect',
      'Disconnect',
      'Run',
      'Stop',
      'Soft Reset',
      'Sync Now'
    ])
  })
})

describe('items grey out when the board cannot act', () => {
  const on = (id: MenuCommand, over: Parameters<typeof ctx>[0]): boolean | undefined =>
    ctx(over).enabled[id]

  it('offers exactly one of Connect and Disconnect', () => {
    // Two enabled items describing opposite states is a menu describing a state
    // the app is not in.
    expect(on('device.connect', { connected: false })).toBe(true)
    expect(on('device.disconnect', { connected: false })).toBe(false)
    expect(on('device.connect', { connected: true })).toBe(false)
    expect(on('device.disconnect', { connected: true })).toBe(true)
  })

  it('greys Stop and Soft Reset with no board', () => {
    for (const id of ['device.stop', 'device.softReset'] as const) {
      expect(on(id, { connected: false }), id).toBe(false)
      expect(on(id, { connected: true }), id).toBe(true)
    }
  })

  it('keeps RUN available with no board, because Run connects one', () => {
    // The auto-connect is what makes Run work for someone who has just opened
    // the app; greying it would leave a first-time user with a dead item and no
    // way to discover the simulator. What Run needs is a FILE.
    expect(on('device.run', { connected: false })).toBe(true)
    expect(on('device.run', { hasActiveFile: false })).toBe(false)
  })

  it('greys Sync Now unless there is a board AND something tagged', () => {
    expect(on('device.syncNow', { connected: true, hasSyncedFiles: true })).toBe(true)
    expect(on('device.syncNow', { connected: false, hasSyncedFiles: true })).toBe(false)
    expect(on('device.syncNow', { connected: true, hasSyncedFiles: false })).toBe(false)
  })
})

describe('the accelerators do not collide with what already owns them', () => {
  it('gives Run ⌘R, which the View menu had to give up', () => {
    const run = deviceSubmenu(true).find((m) => m.label === 'Run')
    expect(run?.accelerator).toBe('CmdOrCtrl+R')
  })

  it('leaves no reload role still holding ⌘R', () => {
    // `role: 'reload'` IS ⌘R. Two menu items claiming one key is a coin toss
    // resolved by menu order, which is not a design.
    const src = readFileSync('src/shared/menu-template.ts', 'utf8')
    expect(src).not.toContain("{ role: 'reload' }")
    // Reloading is not lost — the force variant does the stronger version of the
    // same thing on ⇧⌘R, and is the one that helps a stuck renderer.
    expect(src).toContain("{ role: 'forceReload' }")
  })

  it('gives Stop ⌘., the platform’s own "stop that"', () => {
    expect(deviceSubmenu(true).find((m) => m.label === 'Stop')?.accelerator).toBe('CmdOrCtrl+.')
  })

  it('claims no key twice across the whole menu', () => {
    // The real guard. Every binding Snakie declares, on both platforms, has to
    // be unique — this is what would have caught ⌘R being taken twice.
    for (const isMac of [true, false]) {
      const keys = allShortcuts({ appName: 'Snakie', isMac }).map((s) => s.accelerator)
      expect(new Set(keys).size, `${isMac ? 'macOS' : 'Windows/Linux'}: ${keys.join(', ')}`).toBe(
        keys.length
      )
    }
  })
})

describe('the menu reaches the actions that already exist', () => {
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
  const toolbar = readFileSync('src/renderer/src/components/Toolbar.tsx', 'utf8')
  const conn = readFileSync('src/renderer/src/components/ConnectionControl.tsx', 'utf8')

  it('routes Run and Stop to the toolbar’s own handlers', () => {
    // `handleRun` auto-connects, prefers a real board over the simulator, says so
    // when the board it was using has vanished, and does the soft reboot #871
    // turns on. A second Run would be a different Run wearing the same word.
    expect(shell).toContain("run: () => dispatchDeviceAction('run')")
    expect(toolbar).toContain("onDeviceAction('run'")
    expect(toolbar).toContain("onDeviceAction('stop'")
  })

  it('routes Connect and Disconnect to the connection control', () => {
    expect(conn).toContain("onDeviceAction('connect'")
    expect(conn).toContain("onDeviceAction('disconnect'")
  })

  it('says disconnect, not toggle', () => {
    // A menu says what it will do before you choose it, so Disconnect has to
    // mean disconnect even if the state moved between opening and clicking.
    const off = conn.slice(conn.indexOf("onDeviceAction('disconnect'"))
    expect(off.slice(0, 500)).toContain('if (!connected) return')
    expect(off.slice(0, 500)).toContain('.disconnect()')
  })

  it('makes the two stateless calls directly rather than via the bus', () => {
    // Soft reset is one API call and Sync now one store call. Routing a message
    // to somebody who would make the same call only adds a place to lose it.
    expect(shell).toContain('window.api.device')
    expect(shell).toContain('.softReset()')
    expect(shell).toContain('syncNowRef')
  })
})

describe('Help finally holds something of Snakie’s', () => {
  it('offers Snakie Help on both platforms', () => {
    for (const isMac of [true, false]) {
      const template = appMenuTemplate({
        appName: 'Snakie',
        isMac,
        state: ctx(),
        onCommand: () => {}
      })
      const help = template.find((m) => m.role === 'help')
      const labels = Array.isArray(help?.submenu)
        ? help.submenu.filter((m) => m.label).map((m) => String(m.label))
        : []
      // On macOS this menu held nothing of Snakie's at all before (#918).
      expect(labels, isMac ? 'macOS' : 'Windows/Linux').toContain('Snakie Help')
    }
  })
})
