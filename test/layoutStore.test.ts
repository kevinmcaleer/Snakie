import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_IDS,
  WORKSPACE_PRESETS,
  LAYOUT_STORAGE_KEY,
  defaultLayoutState,
  loadLayoutState,
  type StorageLike
} from '../src/renderer/src/store/layout'

/** A Map-backed StorageLike for the loader. */
const storage = (entries: Record<string, string> = {}): StorageLike => ({
  getItem: (k: string) => (k in entries ? entries[k] : null)
})

describe('workspace presets (epic #259 Phase 1)', () => {
  it('defines the four workspaces with valid geometry', () => {
    expect(WORKSPACE_IDS).toEqual(['code', 'board', 'lab', 'data'])
    for (const id of WORKSPACE_IDS) {
      const p = WORKSPACE_PRESETS[id]
      expect(p.horizontal).toHaveLength(3)
      expect(p.vertical).toHaveLength(2)
      expect(p.horizontal.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0)
      expect(p.vertical.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0)
    }
  })

  it("'code' preserves today's default layout; the others open the dock", () => {
    const code = WORKSPACE_PRESETS.code
    expect(code.filesCollapsed).toBe(false)
    expect(code.shellCollapsed).toBe(false)
    expect(code.rightCollapsed).toBe(true)
    expect(code.dockOpen).toBe(false)
    for (const id of ['board', 'lab', 'data'] as const) {
      expect(WORKSPACE_PRESETS[id].dockOpen, id).toBe(true)
    }
    // Data is console-first: the shell gets the larger vertical share.
    expect(WORKSPACE_PRESETS.data.vertical[1]).toBeGreaterThan(
      WORKSPACE_PRESETS.code.vertical[1]
    )
  })

  it('defaultLayoutState deep-copies the presets (reset cannot alias them)', () => {
    const a = defaultLayoutState()
    a.workspaces.code.horizontal[0] = 99
    expect(WORKSPACE_PRESETS.code.horizontal[0]).not.toBe(99)
    expect(defaultLayoutState().workspaces.code.horizontal[0]).not.toBe(99)
  })
})

describe('loadLayoutState (corruption-safe, versioned)', () => {
  it('returns factory defaults with no stored state', () => {
    const s = loadLayoutState(storage())
    expect(s.version).toBe(1)
    expect(s.active).toBe('code')
    expect(s.workspaces.lab).toEqual(WORKSPACE_PRESETS.lab)
  })

  it('survives corrupt JSON and wrong shapes', () => {
    expect(loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: 'not json{{' })).active).toBe('code')
    expect(
      loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: '{"version":99}' })).active
    ).toBe('code')
    expect(loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: '[]' })).active).toBe('code')
  })

  it('round-trips a valid envelope and keeps the active workspace', () => {
    const saved = defaultLayoutState()
    saved.active = 'lab'
    saved.workspaces.lab.vertical = [60, 40]
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.active).toBe('lab')
    expect(s.workspaces.lab.vertical).toEqual([60, 40])
  })

  it('sanitises bad fields per-workspace back to the preset (not all-or-nothing)', () => {
    const saved = defaultLayoutState() as unknown as {
      active: string
      workspaces: Record<string, Record<string, unknown>>
    }
    saved.active = 'not-a-workspace'
    saved.workspaces.code.horizontal = [50, 50] // wrong length
    saved.workspaces.code.filesCollapsed = 'yes' // wrong type
    saved.workspaces.code.dockOpen = true // valid — must survive
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.active).toBe('code')
    expect(s.workspaces.code.horizontal).toEqual(WORKSPACE_PRESETS.code.horizontal)
    expect(s.workspaces.code.filesCollapsed).toBe(WORKSPACE_PRESETS.code.filesCollapsed)
    expect(s.workspaces.code.dockOpen).toBe(true)
  })
})

describe('legacy migration (pre-#259 loose keys → the code workspace)', () => {
  it('seeds collapse flags, view and dock from the old keys', () => {
    const s = loadLayoutState(
      storage({
        'snakie.collapsed.files': 'true',
        'snakie.collapsed.shell': 'false',
        'snakie.collapsed.right': 'false',
        'snakie.instruments.dockOpen': 'true',
        'snakie.activityView': '"help"'
      })
    )
    const code = s.workspaces.code
    expect(code.filesCollapsed).toBe(true)
    expect(code.shellCollapsed).toBe(false)
    expect(code.rightCollapsed).toBe(false)
    expect(code.dockOpen).toBe(true)
    expect(code.activityView).toBe('help')
    // Other workspaces stay at their presets.
    expect(s.workspaces.board).toEqual(WORKSPACE_PRESETS.board)
  })

  it('adopts panel sizes from the old react-resizable-panels autosave entries', () => {
    const s = loadLayoutState(
      storage({
        'react-resizable-panels:snakie.layout.horizontal': JSON.stringify({
          '{"panelIds":[1,2,3]}': { layout: [25, 60, 15] }
        }),
        'react-resizable-panels:snakie.layout.vertical': JSON.stringify({
          x: { layout: [55, 45] }
        })
      })
    )
    expect(s.workspaces.code.horizontal).toEqual([25, 60, 15])
    expect(s.workspaces.code.vertical).toEqual([55, 45])
  })

  it('ignores malformed legacy entries', () => {
    const s = loadLayoutState(
      storage({
        'snakie.activityView': 'not json',
        'react-resizable-panels:snakie.layout.horizontal': '{"a":{"layout":[1,2]}}' // wrong length + sum
      })
    )
    expect(s.workspaces.code.activityView).toBe('files')
    expect(s.workspaces.code.horizontal).toEqual(WORKSPACE_PRESETS.code.horizontal)
  })

  it('the new envelope takes precedence over legacy keys', () => {
    const saved = defaultLayoutState()
    saved.workspaces.code.filesCollapsed = false
    const s = loadLayoutState(
      storage({
        [LAYOUT_STORAGE_KEY]: JSON.stringify(saved),
        'snakie.collapsed.files': 'true' // stale legacy — must be ignored
      })
    )
    expect(s.workspaces.code.filesCollapsed).toBe(false)
  })
})
