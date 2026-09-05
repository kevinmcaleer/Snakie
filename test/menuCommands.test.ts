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
  d: Parameters<typeof menuCommandHandlers>[0]
} {
  const rec = {
    switched: [] as WorkspaceId[],
    folders: 0,
    d: {} as Parameters<typeof menuCommandHandlers>[0]
  }
  rec.d = {
    switchWorkspace: (id: WorkspaceId) => rec.switched.push(id),
    openFolder: () => {
      rec.folders += 1
    }
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
    expect(RENDERER_MENU_COMMANDS).toHaveLength(WORKSPACE_IDS.length + 1)
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

  it('runMenuCommand dispatches a known id and drops anything else', () => {
    const rec = deps()
    expect(runMenuCommand(workspaceMenuCommand('board'), rec.d)).toBe(true)
    expect(rec.switched).toEqual(['board'])
    // An id from a newer main process, a retired one, or junk: dropped, not run.
    for (const bad of ['workspace.show.datalab', 'file.saveAs', '', 42, null, undefined, {}]) {
      expect(runMenuCommand(bad, rec.d), JSON.stringify(bad)).toBe(false)
    }
    expect(rec.switched).toEqual(['board'])
  })
})

describe('menu state travelling back to the menu (#914)', () => {
  it('ticks exactly the active workspace', () => {
    for (const active of WORKSPACE_IDS) {
      const state = menuStateFrom({ workspace: active })
      for (const id of WORKSPACE_IDS) {
        expect(state.checked[workspaceMenuCommand(id)], `${active}/${id}`).toBe(id === active)
      }
      // Nothing is greyed out by the workspace alone.
      expect(state.enabled).toEqual({})
    }
  })

  it('an unpublished state greys nothing out and ticks nothing', () => {
    expect(EMPTY_MENU_STATE).toEqual({ enabled: {}, checked: {} })
  })

  it('coerceMenuState keeps known ids with boolean values and drops the rest', () => {
    const state = coerceMenuState({
      enabled: { 'file.openFolder': false, 'device.disconnect': false, 'view.boardWindow': 'yes' },
      checked: { [workspaceMenuCommand('robot')]: true, 'workspace.show.datalab': true }
    })
    expect(state).toEqual({
      enabled: { 'file.openFolder': false },
      checked: { 'workspace.show.robot': true }
    })
  })

  it('coerceMenuState survives a garbled payload', () => {
    for (const bad of [null, undefined, 42, 'nope', [], { enabled: 3, checked: null }]) {
      expect(coerceMenuState(bad), JSON.stringify(bad)).toEqual({ enabled: {}, checked: {} })
    }
  })

  // The last link in the chain: the state is only useful if the renderer sends
  // it. There is no DOM here (the suite runs in `environment: 'node'`), so this
  // reads the source — the same way `openFolderReachable.test.ts` checks a wire
  // whose break would be silent.
  it('AppShell publishes the active workspace whenever it changes', () => {
    const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
    expect(shell).toMatch(/menu\.setState\(\s*menuStateFrom\(\{\s*workspace:\s*layout\.active/)
    const at = shell.search(/menu\.setState\(/)
    // Re-published on every workspace change, or the tick freezes on the first one.
    expect(shell.slice(at, at + 200)).toContain('[layout.active]')
  })
})
