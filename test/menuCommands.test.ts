import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  EMPTY_MENU_STATE,
  MAIN_MENU_COMMANDS,
  RENDERER_MENU_COMMANDS,
  coerceMenuState,
  isRendererMenuCommand,
  menuStateFrom,
  workspaceMenuCommand
} from '../src/shared/menu-commands'
import { menuCommandHandlers, runMenuCommand } from '../src/renderer/src/lib/menuCommands'
import { WORKSPACE_IDS, type WorkspaceId } from '../src/shared/workspaces'

/**
 * The menu command channel's two halves must agree (#914).
 *
 * A menu item that silently does nothing is the failure this seam exists to
 * prevent, so the contract is checked from both directions: every id in the
 * union has a handler, and every handler has an id.
 */

/** Recording deps for the dispatcher. */
function deps(): {
  switched: WorkspaceId[]
  folders: number
  sheets: number
  /** Every File command that fired, in order (#915). */
  fired: string[]
  /** Which recent slots were asked for. */
  recents: number[]
  d: Parameters<typeof menuCommandHandlers>[0]
} {
  const rec = {
    switched: [] as WorkspaceId[],
    folders: 0,
    sheets: 0,
    fired: [] as string[],
    recents: [] as number[],
    d: {} as Parameters<typeof menuCommandHandlers>[0]
  }
  rec.d = {
    switchWorkspace: (id: WorkspaceId) => rec.switched.push(id),
    openFolder: () => {
      rec.folders += 1
      rec.fired.push('openFolder')
    },
    showShortcuts: () => {
      rec.sheets += 1
    },
    newFile: () => rec.fired.push('newFile'),
    openFile: () => rec.fired.push('openFile'),
    openRecent: (i: number) => {
      rec.fired.push('openRecent')
      rec.recents.push(i)
    },
    save: () => rec.fired.push('save'),
    saveAs: () => rec.fired.push('saveAs'),
    closeTab: () => rec.fired.push('closeTab'),
    connect: () => rec.fired.push('connect'),
    disconnect: () => rec.fired.push('disconnect'),
    run: () => rec.fired.push('run'),
    stop: () => rec.fired.push('stop'),
    softReset: () => rec.fired.push('softReset'),
    syncNow: () => rec.fired.push('syncNow'),
    showHelp: () => rec.fired.push('showHelp'),
    openFlasher: () => rec.fired.push('openFlasher'),
    openBoardFinder: () => rec.fired.push('openBoardFinder'),
    openPartsCatalog: () => rec.fired.push('openPartsCatalog'),
    openSpriteEditor: () => rec.fired.push('openSpriteEditor'),
    openFind: () => rec.fired.push('openFind'),
    openSettings: () => rec.fired.push('openSettings')
  }
  return rec
}

describe('menu command union ↔ renderer dispatcher (#914)', () => {
  it('every id in the union has a handler, and every handler an id', () => {
    const handlers = menuCommandHandlers(deps().d)
    expect(Object.keys(handlers).sort()).toEqual([...RENDERER_MENU_COMMANDS].sort())
  })

  it('the workspace commands are derived from WORKSPACE_IDS, not hand-typed', () => {
    // A fourth workspace must reach the menu, the union and the dispatcher with
    // no list edited anywhere (#916).
    for (const id of WORKSPACE_IDS) {
      expect(RENDERER_MENU_COMMANDS).toContain(workspaceMenuCommand(id))
    }
    // Exactly one workspace command per workspace — no stragglers from a retired
    // one. Counted rather than compared against a total, so adding an unrelated
    // command (help.shortcuts, #920) doesn't need this number nudging.
    const workspaceCommands = RENDERER_MENU_COMMANDS.filter((id) =>
      id.startsWith('workspace.show.')
    )
    expect(workspaceCommands).toHaveLength(WORKSPACE_IDS.length)
  })

  it('main-process commands are NOT in the renderer union (they never cross)', () => {
    for (const id of MAIN_MENU_COMMANDS) {
      expect(RENDERER_MENU_COMMANDS as readonly string[]).not.toContain(id)
      expect(isRendererMenuCommand(id)).toBe(false)
    }
  })

  it('each workspace command switches to ITS OWN workspace', () => {
    for (const id of WORKSPACE_IDS) {
      const rec = deps()
      menuCommandHandlers(rec.d)[workspaceMenuCommand(id)]()
      expect(rec.switched).toEqual([id])
    }
  })

  it('file.openFolder raises the picker', () => {
    const rec = deps()
    menuCommandHandlers(rec.d)['file.openFolder']()
    expect(rec.folders).toBe(1)
  })

  it('help.shortcuts raises the cheatsheet (#920)', () => {
    const rec = deps()
    menuCommandHandlers(rec.d)['help.shortcuts']()
    expect(rec.sheets).toBe(1)
  })

  it('runMenuCommand dispatches a known id and drops anything else', () => {
    const rec = deps()
    expect(runMenuCommand(workspaceMenuCommand('board'), rec.d)).toBe(true)
    expect(rec.switched).toEqual(['board'])
    // An id from a newer main process, a retired one, or junk: dropped, not run.
    // (`file.saveAs` is a real command since #915, so the stand-in for "an id
    // this build does not have" is a slot past the end of the recent list.)
    for (const bad of [
      'workspace.show.datalab',
      'file.openRecent.99',
      'device.reboot',
      '',
      42,
      null,
      undefined,
      {}
    ]) {
      expect(runMenuCommand(bad, rec.d), JSON.stringify(bad)).toBe(false)
    }
    expect(rec.switched).toEqual(['board'])
  })
})

describe('menu state travelling back to the menu (#914)', () => {
  it('ticks exactly the active workspace', () => {
    for (const active of WORKSPACE_IDS) {
      const state = menuStateFrom({
        workspace: active,
        hasActiveFile: true,
        recentFolders: [],
        connected: true,
        hasSyncedFiles: true
      })
      for (const id of WORKSPACE_IDS) {
        expect(state.checked[workspaceMenuCommand(id)], `${active}/${id}`).toBe(id === active)
      }
      // The workspace itself greys nothing out. Everything listed here is a
      // FILE or DEVICE item, and with a file open and a board connected they are
      // all usable except Connect, whose whole job is to be the other half of
      // Disconnect (#918).
      expect(state.enabled).toEqual({
        'file.save': true,
        'file.saveAs': true,
        'file.closeTab': true,
        'device.connect': false,
        'device.disconnect': true,
        'device.run': true,
        'device.stop': true,
        'device.softReset': true,
        'device.syncNow': true,
        'tools.find': true
      })
    }
  })

  it('an unpublished state greys nothing out and ticks nothing', () => {
    expect(EMPTY_MENU_STATE).toEqual({ enabled: {}, checked: {}, recentFolders: [] })
  })

  it('coerceMenuState keeps known ids with boolean values and drops the rest', () => {
    const state = coerceMenuState({
      enabled: { 'file.openFolder': false, 'device.reboot': false, 'view.boardWindow': 'yes' },
      checked: { [workspaceMenuCommand('robot')]: true, 'workspace.show.datalab': true }
    })
    expect(state).toEqual({
      enabled: { 'file.openFolder': false },
      checked: { 'workspace.show.robot': true },
      recentFolders: []
    })
  })

  it('coerceMenuState survives a garbled payload', () => {
    for (const bad of [null, undefined, 42, 'nope', [], { enabled: 3, checked: null }]) {
      expect(coerceMenuState(bad), JSON.stringify(bad)).toEqual({
        enabled: {},
        checked: {},
        recentFolders: []
      })
    }
  })

  // The last link in the chain: the state is only useful if the renderer sends
  // it. There is no DOM here (the suite runs in `environment: 'node'`), so this
  // reads the source — the same way `openFolderReachable.test.ts` checks a wire
  // whose break would be silent.
  it('AppShell publishes the menu state whenever any of it changes', () => {
    const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
    expect(shell).toMatch(/menu\.setState\(\s*menuStateFrom\(\{\s*workspace:\s*layout\.active/)
    const at = shell.search(/menu\.setState\(/)
    const effect = shell.slice(at, shell.indexOf('])', at) + 2)
    // Every input re-publishes, or that part of the menu freezes at whatever it
    // was on first render: the workspace tick (#916), and since #915 the file
    // that greys Save out and the folders Open Recent lists.
    for (const dep of ['layout.active', 'activeId', 'recentFolders']) {
      expect(effect, dep).toContain(dep)
    }
  })
})
