import { describe, it, expect } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/shared/menu-template'
import { allShortcuts, formatAccelerator, shortcutSections } from '../src/shared/shortcuts'
import { WORKSPACE_INFO } from '../src/shared/workspaces'

/**
 * THE CHEATSHEET CANNOT DISAGREE WITH THE MENU (#920).
 * =============================================================================
 *
 * The whole point of generating the sheet is that it can't drift, so the test
 * asserts the DERIVATION rather than a list of keys: every accelerator the menu
 * template declares reaches the sheet, and nothing reaches the sheet that the
 * template doesn't declare. A hardcoded count would be wrong the week #915 or
 * #918 lands; this stays true as the menu grows.
 *
 * The walk below is deliberately naive — it takes EVERY `accelerator` in the
 * tree, with no knowledge of how `shortcutSections` groups or filters them. So
 * if the grouping ever drops one (an accelerator in a menu the sheet skips, say),
 * this fails rather than the sheet quietly omitting a real binding.
 */

const OPTS = { appName: 'Snakie', isMac: true }

/** Every accelerator in the template, however deeply nested. */
function acceleratorsIn(items: MenuItemConstructorOptions[]): string[] {
  const out: string[] = []
  for (const item of items) {
    if (typeof item.accelerator === 'string') out.push(item.accelerator)
    if (Array.isArray(item.submenu)) out.push(...acceleratorsIn(item.submenu))
  }
  return out
}

function templateAccelerators(isMac: boolean): string[] {
  return acceleratorsIn(appMenuTemplate({ appName: 'Snakie', isMac, onCommand: () => {} }))
}

describe.each([
  { platform: 'macOS', isMac: true },
  { platform: 'Windows/Linux', isMac: false }
])('the cheatsheet is generated from the menu on $platform', ({ isMac }) => {
  it('lists every accelerator the menu declares, and only those', () => {
    const fromMenu = templateAccelerators(isMac).sort()
    const fromSheet = allShortcuts({ appName: 'Snakie', isMac })
      .map((s) => s.accelerator)
      .sort()
    // Both directions in one comparison: a missing binding and an invented one
    // are the same failure, and both are the failure this issue exists to stop.
    expect(fromSheet).toEqual(fromMenu)
  })

  it('binds each key exactly once — two items on one key is a bug, not a list', () => {
    const accels = templateAccelerators(isMac)
    expect(new Set(accels).size).toBe(accels.length)
  })

  it('gives every row a label and a rendered key', () => {
    for (const s of allShortcuts({ appName: 'Snakie', isMac })) {
      expect(s.label, s.accelerator).not.toBe('')
      expect(s.keys, s.accelerator).toBe(formatAccelerator(s.accelerator, isMac))
    }
  })

  it('groups rows under the menu they live in, keeping the path to nested items', () => {
    const sections = shortcutSections({ appName: 'Snakie', isMac })
    const view = sections.find((s) => s.title === 'View')
    expect(view).toBeDefined()
    // View ▸ Workspace ▸ Code: "Code" alone under View would say nothing.
    expect(view?.shortcuts.map((s) => s.label)).toContain(
      `Workspace ▸ ${WORKSPACE_INFO.code.label}`
    )
    expect(view?.shortcuts.map((s) => s.label)).toContain('Board View')
    expect(sections.find((s) => s.title === 'File')?.shortcuts.map((s) => s.label)).toEqual([
      'Open Folder…'
    ])
    // Every row belongs to a section — nothing is orphaned by the grouping.
    const grouped = sections.flatMap((s) => s.shortcuts).length
    expect(grouped).toBe(allShortcuts({ appName: 'Snakie', isMac }).length)
  })

  it('skips the menus that are pure platform roles', () => {
    // Edit and Window are standard roles: Electron gives each its platform key,
    // none of which is in the template. Listing them would mean hand-writing the
    // second table the generation exists to avoid, so the UI says so instead.
    const titles = shortcutSections({ appName: 'Snakie', isMac }).map((s) => s.title)
    expect(titles).not.toContain('Edit')
    expect(titles).not.toContain('Window')
  })

  it('lists its own shortcut, because that is a menu item like any other', () => {
    const help = shortcutSections({ appName: 'Snakie', isMac })?.find((s) => s.title === 'Help')
    expect(help?.shortcuts.map((s) => s.label)).toContain('Keyboard Shortcuts')
  })
})

describe('sections with no bindings yet (#920)', () => {
  it('keeps its heading and an empty list rather than vanishing', () => {
    // macOS puts Check for Updates… in the app menu, and it has no key. The menu
    // exists and holds a command, so the sheet shows the heading and says why it
    // is empty — and fills in on its own when something there gains a key.
    const app = shortcutSections(OPTS).find((s) => s.title === 'Snakie')
    expect(app).toBeDefined()
    expect(app?.shortcuts).toEqual([])
  })

  it('names the app menu after the app, not a hardcoded "Snakie"', () => {
    const titles = shortcutSections({ appName: 'Renamed', isMac: true }).map((s) => s.title)
    expect(titles).toContain('Renamed')
    expect(titles).not.toContain('Snakie')
  })
})

describe('accelerators render for the platform, from the same string Electron parses', () => {
  it('spells the modifiers as macOS glyphs', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+B', true)).toBe('⌘⇧B')
    expect(formatAccelerator('CmdOrCtrl+O', true)).toBe('⌘O')
    expect(formatAccelerator('CmdOrCtrl+1', true)).toBe('⌘1')
    expect(formatAccelerator('CmdOrCtrl+Shift+/', true)).toBe('⌘⇧/')
    expect(formatAccelerator('Ctrl+Alt+Delete', true)).toBe('⌃⌥⌦')
  })

  it('spells them as words everywhere else', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+B', false)).toBe('Ctrl+Shift+B')
    expect(formatAccelerator('CmdOrCtrl+O', false)).toBe('Ctrl+O')
    expect(formatAccelerator('CmdOrCtrl+1', false)).toBe('Ctrl+1')
    expect(formatAccelerator('CmdOrCtrl+Shift+/', false)).toBe('Ctrl+Shift+/')
    expect(formatAccelerator('Ctrl+Alt+Delete', false)).toBe('Ctrl+Alt+Delete')
  })

  it('names the keys that do not read well raw', () => {
    expect(formatAccelerator('CmdOrCtrl+Return', true)).toBe('⌘↩')
    expect(formatAccelerator('CmdOrCtrl+Return', false)).toBe('Ctrl+Enter')
    expect(formatAccelerator('Escape', true)).toBe('⎋')
    expect(formatAccelerator('Escape', false)).toBe('Esc')
    // Electron spells a literal plus `Plus`, which is why splitting on `+` is safe.
    expect(formatAccelerator('CmdOrCtrl+Plus', false)).toBe('Ctrl++')
  })

  it('does not claim Cmd is Ctrl on Windows, where Electron ignores it', () => {
    expect(formatAccelerator('Cmd+K', false)).toBe('Cmd+K')
    expect(formatAccelerator('Cmd+K', true)).toBe('⌘K')
  })

  it('renders a lone letter as a key, not a modifier', () => {
    expect(formatAccelerator('F5', true)).toBe('F5')
    expect(formatAccelerator('b', false)).toBe('B')
    expect(formatAccelerator('', false)).toBe('')
  })
})

describe('the cheatsheet does not steal a key Monaco already owns', () => {
  it('is not on CmdOrCtrl+/, which is Toggle Line Comment', () => {
    // `monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js` binds
    // `KeyMod.CtrlCmd | KeyCode.Slash` to `editor.action.commentLine` (and
    // `suggestController.js` to `toggleExplainMode` while the suggest widget is
    // up). A MENU accelerator is handled natively before the web contents sees
    // the key, so taking ⌘/ would silently kill commenting in a code editor —
    // this issue's own failure mode, from the other direction. Monaco binds no
    // Shift+Slash at all, so ⌘⇧/ (⌘? on a US layout) is free.
    const help = shortcutSections(OPTS).find((s) => s.title === 'Help')
    const sheet = help?.shortcuts.find((s) => s.label === 'Keyboard Shortcuts')
    expect(sheet?.accelerator).toBe('CmdOrCtrl+Shift+/')
    expect(templateAccelerators(true)).not.toContain('CmdOrCtrl+/')
    expect(templateAccelerators(false)).not.toContain('CmdOrCtrl+/')
  })

  it('is not on CmdOrCtrl+H, which macOS keeps for Hide Application', () => {
    expect(templateAccelerators(true)).not.toContain('CmdOrCtrl+H')
    expect(templateAccelerators(true)).not.toContain('Cmd+H')
  })
})
