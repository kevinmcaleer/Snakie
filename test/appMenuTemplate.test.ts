import { describe, it, expect } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate, workspaceSubmenu } from '../src/main/menu-template'
import {
  MAIN_MENU_COMMANDS,
  RENDERER_MENU_COMMANDS,
  menuStateFrom,
  workspaceMenuCommand,
  type MenuCommand,
  type MenuState
} from '../src/shared/menu-commands'
import { WORKSPACE_IDS, WORKSPACE_INFO } from '../src/shared/workspaces'

/**
 * The application menu as data (#914 / #916).
 *
 * `menu-template.ts` type-imports Electron and nothing else, so what the menu
 * contains — which items fire which command, what is ticked, what is greyed —
 * is checked here directly, with no app running and no component rendered.
 */

/** Build the template, recording every command a click fires. */
function build(opts: { isMac: boolean; state?: MenuState }): {
  template: MenuItemConstructorOptions[]
  fired: MenuCommand[]
} {
  const fired: MenuCommand[] = []
  const template = appMenuTemplate({
    appName: 'Snakie',
    isMac: opts.isMac,
    state: opts.state,
    onCommand: (id) => fired.push(id)
  })
  return { template, fired }
}

/** Every item in the tree that DOES something (i.e. has a click handler). */
function commandItems(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const item of items) {
    if (item.click) out.push(item)
    if (Array.isArray(item.submenu)) out.push(...commandItems(item.submenu))
  }
  return out
}

/** Click an item (the real signature takes three args we don't have here). */
function click(item: MenuItemConstructorOptions): void {
  ;(item.click as unknown as () => void)()
}

/** The submenu of the View item labelled `label`. */
function viewSubmenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const view = template.find((m) => m.label === 'View')
  const items = Array.isArray(view?.submenu) ? view.submenu : []
  const found = items.find((m) => m.label === label)
  return Array.isArray(found?.submenu) ? found.submenu : []
}

describe.each([
  { platform: 'macOS', isMac: true },
  { platform: 'Windows/Linux', isMac: false }
])('the app menu on $platform (#914)', ({ isMac }) => {
  it('gives every command exactly one menu item, and every item a live command', () => {
    const { template, fired } = build({ isMac })
    const items = commandItems(template)
    for (const item of items) click(item)
    // Every id in the union reached the menu…
    expect([...fired].sort()).toEqual([...MAIN_MENU_COMMANDS, ...RENDERER_MENU_COMMANDS].sort())
    // …and no item fired nothing, or the same command twice.
    expect(fired).toHaveLength(items.length)
    expect(new Set(fired).size).toBe(fired.length)
  })

  it('carries the accelerators the shortcuts epic asks for (#920)', () => {
    const { template } = build({ isMac })
    const byLabel = new Map(commandItems(template).map((m) => [String(m.label), m]))
    expect(byLabel.get('Open Folder…')?.accelerator).toBe('CmdOrCtrl+O')
    expect(byLabel.get('Board View')?.accelerator).toBe('CmdOrCtrl+Shift+B')
    // Cmd/Ctrl 1-2-3 for Code / Electronics / Build. Monaco binds Cmd+S, Cmd+F,
    // Cmd+H and Cmd+Shift+1 — nothing plain-modifier-plus-digit — so these are free.
    expect(byLabel.get('Code')?.accelerator).toBe('CmdOrCtrl+1')
    expect(byLabel.get('Electronics')?.accelerator).toBe('CmdOrCtrl+2')
    expect(byLabel.get('Build')?.accelerator).toBe('CmdOrCtrl+3')
  })
})

describe('View ▸ Workspace (#916)', () => {
  it('is built from WORKSPACE_IDS and labelled from WORKSPACE_INFO', () => {
    const { template } = build({ isMac: true })
    const submenu = viewSubmenu(template, 'Workspace')
    expect(submenu.map((m) => m.label)).toEqual(WORKSPACE_IDS.map((id) => WORKSPACE_INFO[id].label))
    for (const item of submenu) expect(item.type).toBe('radio')
  })

  it('each item switches to its OWN workspace', () => {
    for (const id of WORKSPACE_IDS) {
      const { template, fired } = build({ isMac: false })
      const submenu = viewSubmenu(template, 'Workspace')
      const item = submenu.find((m) => m.label === WORKSPACE_INFO[id].label)
      click(item as MenuItemConstructorOptions)
      expect(fired).toEqual([workspaceMenuCommand(id)])
    }
  })

  it('ticks the workspace the renderer says is showing', () => {
    for (const active of WORKSPACE_IDS) {
      const { template } = build({ isMac: true, state: menuStateFrom({ workspace: active }) })
      const submenu = viewSubmenu(template, 'Workspace')
      const ticked = submenu.filter((m) => m.checked).map((m) => m.label)
      expect(ticked).toEqual([WORKSPACE_INFO[active].label])
    }
  })

  it('ticks nothing before the renderer has published (no state)', () => {
    const submenu = workspaceSubmenu({ appName: 'Snakie', isMac: true, onCommand: () => {} })
    expect(submenu.every((m) => m.checked === false)).toBe(true)
    // …and every item is still usable: an unpublished state must not grey the menu.
    expect(submenu.every((m) => m.enabled === true)).toBe(true)
  })

  it('only the radio items carry a tick at all', () => {
    // Electron reads `checked` on checkbox/radio items only, so a plain item
    // claiming one would be a tick that can never appear.
    const { template } = build({ isMac: true, state: menuStateFrom({ workspace: 'code' }) })
    for (const item of commandItems(template)) {
      if (item.type === 'radio' || item.type === 'checkbox') {
        expect(typeof item.checked, String(item.label)).toBe('boolean')
      } else {
        expect(item, String(item.label)).not.toHaveProperty('checked')
      }
    }
  })
})

describe('menu state greys items out (#914, for #915–#918)', () => {
  it('an item is enabled unless the renderer explicitly disabled it', () => {
    const { template } = build({
      isMac: false,
      state: { enabled: { 'file.openFolder': false }, checked: {} }
    })
    const items = commandItems(template)
    const openFolder = items.find((m) => m.label === 'Open Folder…')
    expect(openFolder?.enabled).toBe(false)
    // Everything the state says nothing about stays usable.
    for (const item of items) {
      if (item.label !== 'Open Folder…') expect(item.enabled, String(item.label)).toBe(true)
    }
  })
})
