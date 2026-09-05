import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  RECENT_FOLDER_SLOTS,
  coerceMenuState,
  isRendererMenuCommand,
  menuStateFrom,
  recentFolderMenuCommand
} from '../src/shared/menu-commands'
import { promoteRecentFolder, RECENT_FOLDERS_MAX } from '../src/renderer/src/store/workspace'

/**
 * The File menu (#915, epic #913).
 *
 * Before this the File menu was two items — Open Folder and Quit — and the only
 * way to save was the toolbar button or ⌘S with the editor focused, since that
 * binding lives inside Monaco. Anywhere else in the app, ⌘S did nothing.
 *
 * The parts worth testing are the ones a menu cannot show you it got wrong: the
 * recent list's MRU rule, the items that must grey out, and the slot ids that
 * have to stay fixed while their labels change.
 */

describe('Open Recent remembers folders in the right order', () => {
  it('puts the newest first', () => {
    expect(promoteRecentFolder([], '/a')).toEqual(['/a'])
    expect(promoteRecentFolder(['/a'], '/b')).toEqual(['/b', '/a'])
  })

  it('promotes rather than duplicates', () => {
    // Reopening a folder you already have is the common case, and the difference
    // between a useful list and eight copies of the folder you work in.
    expect(promoteRecentFolder(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b'])
    expect(promoteRecentFolder(['/a'], '/a')).toEqual(['/a'])
  })

  it('keeps only as many as the menu has slots for', () => {
    const many = Array.from({ length: 20 }, (_, i) => `/f${i}`)
    expect(promoteRecentFolder(many, '/new')).toHaveLength(RECENT_FOLDERS_MAX)
    expect(promoteRecentFolder(many, '/new')[0]).toBe('/new')
    expect(RECENT_FOLDERS_MAX).toBe(RECENT_FOLDER_SLOTS.length)
  })

  it('ignores an empty folder rather than storing a blank row', () => {
    expect(promoteRecentFolder(['/a'], '')).toEqual(['/a'])
  })

  it('does not mutate the list it was given', () => {
    const before = ['/a', '/b']
    promoteRecentFolder(before, '/c')
    expect(before).toEqual(['/a', '/b'])
  })
})

describe('the recent slots are ids, not folders', () => {
  it('names a fixed command per slot', () => {
    // The labels change every time someone opens a folder; the ids must not, or
    // `isRendererMenuCommand` could not tell a real command from a stale one.
    for (const i of RECENT_FOLDER_SLOTS) {
      expect(isRendererMenuCommand(recentFolderMenuCommand(i))).toBe(true)
    }
  })

  it('rejects a slot the menu does not have', () => {
    expect(isRendererMenuCommand('file.openRecent.8')).toBe(false)
    expect(isRendererMenuCommand('file.openRecent.99')).toBe(false)
    expect(isRendererMenuCommand('file.openRecent.')).toBe(false)
  })
})

describe('items grey out when they cannot act', () => {
  const state = (hasActiveFile: boolean) =>
    menuStateFrom({
      workspace: 'code',
      hasActiveFile,
      recentFolders: [],
      connected: true,
      hasSyncedFiles: true
    })

  it('greys Save, Save As and Close Tab with nothing open', () => {
    // A menu that offers Save with nothing to save teaches people not to trust
    // the rest of it.
    for (const id of ['file.save', 'file.saveAs', 'file.closeTab'] as const) {
      expect(state(false).enabled[id], id).toBe(false)
      expect(state(true).enabled[id], id).toBe(true)
    }
  })

  it('never greys the ones that always work', () => {
    // New and the two Opens do not need a file — greying them with an empty
    // window would leave no way to get one.
    for (const id of ['file.new', 'file.openFile', 'file.openFolder'] as const) {
      expect(state(false).enabled[id], id).toBeUndefined()
    }
  })
})

describe('the recent list crosses IPC as untrusted data', () => {
  it('drops anything that is not a non-empty string', () => {
    const s = coerceMenuState({ recentFolders: ['/a', 42, null, '', { x: 1 }, '/b'] })
    expect(s.recentFolders).toEqual(['/a', '/b'])
  })

  it('caps it at the number of slots that exist', () => {
    const many = Array.from({ length: 40 }, (_, i) => `/f${i}`)
    expect(coerceMenuState({ recentFolders: many }).recentFolders).toHaveLength(
      RECENT_FOLDER_SLOTS.length
    )
  })

  it('treats a missing or wrong-typed list as empty', () => {
    expect(coerceMenuState({}).recentFolders).toEqual([])
    expect(coerceMenuState({ recentFolders: 'nope' }).recentFolders).toEqual([])
  })
})

describe('Save As no longer leaves two tabs on one file (#515)', () => {
  const store = readFileSync('src/renderer/src/store/workspace.ts', 'utf8')

  it('matches an already-open file by path, not only by id', () => {
    // After Save As the buffer keeps its `untitled:` id so the tab stays
    // mounted, but now has a real path. Opening that file from the tree used to
    // make a SECOND tab whose saves silently overwrote the first's — and #915
    // put Save As on the menu with a shortcut, which turns that from a corner
    // into a normal Tuesday.
    const open = store.slice(store.indexOf("case 'open':"), store.indexOf("case 'add':"))
    expect(open).toContain('f.path === action.file.path')
    expect(open).toContain('f.source === action.file.source')
  })

  it('still matches by id first, so an untitled buffer is not merged into another', () => {
    // Two untitled buffers both have an empty path. Matching those by path would
    // fold every new file into the first one.
    const open = store.slice(store.indexOf("case 'open':"), store.indexOf("case 'add':"))
    expect(open).toContain('f.id === action.file.id')
    expect(open).toContain('action.file.path')
  })
})

describe('Close Tab goes through the prompt, not around it', () => {
  const shell = readFileSync('src/renderer/src/components/AppShell.tsx', 'utf8')
  const tabs = readFileSync('src/renderer/src/components/EditorTabs.tsx', 'utf8')

  it('asks the tabs to close, rather than calling the store', () => {
    // The × and ⌘W confirm before discarding unsaved edits. A menu item that
    // went straight to `closeFile` would not.
    expect(shell).toContain('closeTab: () => dispatchCloseTab()')
    expect(shell).not.toMatch(/closeTab: \(\) => closeFile/)
  })

  it('is handled by the same close the × uses', () => {
    expect(tabs).toContain('CLOSE_TAB_EVENT')
    expect(tabs).toContain('if (activeId) requestClose(activeId)')
  })

  it('keeps the renderer shortcut, which is all the web build has', () => {
    // On the desktop ⌘W is a menu accelerator and Electron takes the key first.
    // The web build has no menu at all, so the keydown handler stays.
    expect(tabs).toContain("e.key === 'w'")
  })
})
