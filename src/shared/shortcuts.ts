import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from './menu-template'

/**
 * THE KEYBOARD SHORTCUT CHEATSHEET, DERIVED FROM THE MENU (#920, epic #913).
 * =============================================================================
 *
 * A list of shortcuts that is TYPED OUT drifts from the real bindings within a
 * release or two, and a shortcut list that lies is worse than none — the reader
 * trusts it, presses the key, and concludes the app is broken. So nothing here
 * knows a single accelerator: {@link shortcutSections} walks the very template
 * `menu.ts` hands to `Menu.buildFromTemplate` and reports what it finds. In
 * Electron an item's `accelerator` IS the binding, so the menu and the sheet
 * cannot disagree, and #915 / #917 / #918 fill the sheet in by adding their menu
 * items — with no edit here.
 *
 * That is also why `menu-template.ts` moved from `src/main/` to `src/shared/`
 * (it only ever type-imported Electron): the main process builds the menu from
 * it and the renderer now builds the sheet from it, so it belongs to both.
 *
 * WHAT IS DELIBERATELY NOT LISTED. Standard-role items (Undo, Copy, Zoom In,
 * Minimise) carry no `accelerator` in the template — Electron supplies the
 * platform's own key for each role. Reproducing those would mean hand-writing
 * exactly the second table this module exists to avoid, so the sheet shows what
 * Snakie itself binds and the UI says so in one line.
 */

/** One binding, as the sheet shows it. */
export interface Shortcut {
  /** Where the item sits in its menu — a nested item keeps its path
   *  ("Workspace ▸ Code"), since "Code" alone under View means nothing. */
  label: string
  /** The accelerator string EXACTLY as the menu declares it, e.g.
   *  `CmdOrCtrl+Shift+B`. Kept so a test can compare the sheet against the
   *  template without re-deriving the pretty form. */
  accelerator: string
  /** The same binding for THIS platform: `⌘⇧B` on macOS, `Ctrl+Shift+B` else. */
  keys: string
}

/** One top-level menu's worth of bindings. */
export interface ShortcutSection {
  /** The menu's own title — "File", "View", "Help", or the app name on macOS. */
  title: string
  /** Bindings in menu order. MAY BE EMPTY: a menu can hold commands that have
   *  no key yet, and the sheet says so rather than rendering a bare heading. */
  shortcuts: Shortcut[]
}

/**
 * Titles for the top-level menus built from a `role` rather than a label.
 *
 * The template hands those to the OS (`{ role: 'windowMenu' }`, `{ role: 'help'
 * }`) precisely so the platform names and populates them, which means the title
 * is the one thing about them that isn't in the data. Small, and only ever the
 * menus the template actually uses at the top level.
 */
const ROLE_TITLES: Record<string, string> = {
  help: 'Help',
  windowMenu: 'Window',
  fileMenu: 'File',
  editMenu: 'Edit',
  viewMenu: 'View'
}

/** macOS prints modifiers as glyphs. `CmdOrCtrl` resolves to ⌘ here for the same
 *  reason Electron does: on a Mac that is the key it binds. */
const MAC_MODIFIERS: Record<string, string> = {
  command: '⌘',
  cmd: '⌘',
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  altgr: '⌥',
  shift: '⇧',
  super: '⌘',
  meta: '⌘'
}

/** Everywhere else they are words. `Cmd` stays "Cmd" rather than becoming Ctrl:
 *  Electron only honours it on macOS, so calling it Ctrl would be a claim about
 *  a key that does nothing. */
const OTHER_MODIFIERS: Record<string, string> = {
  command: 'Cmd',
  cmd: 'Cmd',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Meta'
}

/** Key names that don't read well raw. Anything absent is printed as written
 *  (upper-cased), which is right for letters, digits and punctuation. */
const MAC_KEYS: Record<string, string> = {
  return: '↩',
  enter: '↩',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  escape: '⎋',
  esc: '⎋',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  pageup: '⇞',
  pagedown: '⇟',
  home: '↖',
  end: '↘',
  space: 'Space',
  plus: '+'
}

const OTHER_KEYS: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  plus: '+'
}

/**
 * Render one Electron accelerator for `isMac`.
 *
 * The accelerator string is the ONLY input: this is a substitution over the very
 * text Electron parses, not a second table of bindings that could fall out of
 * step with it. Electron joins parts with `+` and spells a literal plus `Plus`,
 * so splitting on `+` is safe.
 *
 * Modifiers keep the order the accelerator declares them in (`CmdOrCtrl+Shift+B`
 * → `⌘⇧B`), as #920 specifies. Worth knowing: macOS's own menu bar sorts them
 * into Apple's ⌃⌥⇧⌘ order and would print `⇧⌘B` — the same keys, one glyph
 * apart. Sorting here instead is a one-line change if that ever matters.
 */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const parts = accelerator.split('+').filter((p) => p.length > 0)
  if (parts.length === 0) return ''
  const modifiers = isMac ? MAC_MODIFIERS : OTHER_MODIFIERS
  const keys = isMac ? MAC_KEYS : OTHER_KEYS
  const rendered = parts.map((part, i) => {
    const lower = part.toLowerCase()
    // Only the LAST part is the key; everything before it is a modifier. A
    // modifier name in key position (there is none today) still prints as
    // written rather than silently vanishing.
    if (i < parts.length - 1) return modifiers[lower] ?? part
    return keys[lower] ?? (part.length === 1 ? part.toUpperCase() : part)
  })
  // Glyphs run together on macOS (⌘⇧B); words need a separator (Ctrl+Shift+B).
  return rendered.join(isMac ? '' : '+')
}

/** Is this item something SNAKIE binds, rather than a standard role the OS
 *  owns? Command items are exactly the ones with a click handler — the same
 *  test `test/appMenuTemplate.test.ts` uses to enumerate the menu. */
function isCommandItem(item: MenuItemConstructorOptions): boolean {
  return typeof item.click === 'function'
}

/** Collect one menu's bindings, depth-first, keeping the path to nested items. */
function collect(
  items: MenuItemConstructorOptions[],
  isMac: boolean,
  path: string[],
  out: { shortcuts: Shortcut[]; hasCommands: boolean }
): void {
  for (const item of items) {
    if (isCommandItem(item)) out.hasCommands = true
    const label = typeof item.label === 'string' ? item.label : ''
    if (typeof item.accelerator === 'string' && label) {
      out.shortcuts.push({
        label: [...path, label].join(' ▸ '),
        accelerator: item.accelerator,
        keys: formatAccelerator(item.accelerator, isMac)
      })
    }
    if (Array.isArray(item.submenu)) {
      collect(item.submenu, isMac, label ? [...path, label] : path, out)
    }
  }
}

/**
 * The cheatsheet for a platform: every accelerator in the application menu,
 * grouped by the top-level menu it lives under.
 *
 * A menu appears only if it holds at least one of Snakie's OWN commands. That
 * keeps Edit and Window — pure standard roles, whose keys belong to the platform
 * and are nowhere in the template — out of a sheet that would otherwise have to
 * invent them. A menu that has commands but no keys yet still gets its heading
 * and an empty list, because "File has nothing bound" is a useful thing to read
 * and the sheet fills itself in as #915–#918 land.
 *
 * @param appName `app.name` — the macOS app menu's title, and so its heading.
 */
export function shortcutSections(o: { appName: string; isMac: boolean }): ShortcutSection[] {
  const template = appMenuTemplate({ appName: o.appName, isMac: o.isMac, onCommand: () => {} })
  const sections: ShortcutSection[] = []
  for (const menu of template) {
    const title =
      (typeof menu.label === 'string' && menu.label) ||
      (typeof menu.role === 'string' && ROLE_TITLES[menu.role]) ||
      ''
    if (!title) continue
    const found = { shortcuts: [] as Shortcut[], hasCommands: false }
    if (Array.isArray(menu.submenu)) collect(menu.submenu, o.isMac, [], found)
    if (found.hasCommands) sections.push({ title, shortcuts: found.shortcuts })
  }
  return sections
}

/** Every binding on `isMac`, flattened — what a test compares against the
 *  template, and what the UI counts. */
export function allShortcuts(o: { appName: string; isMac: boolean }): Shortcut[] {
  return shortcutSections(o).flatMap((s) => s.shortcuts)
}
