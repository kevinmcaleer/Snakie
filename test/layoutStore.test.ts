import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_IDS,
  WORKSPACE_PRESETS,
  LAYOUT_STORAGE_KEY,
  appliedHorizontal,
  defaultLayoutState,
  loadLayoutState,
  recordedHorizontal,
  type StorageLike
} from '../src/renderer/src/store/layout'

/** A Map-backed StorageLike for the loader. */
const storage = (entries: Record<string, string> = {}): StorageLike => ({
  getItem: (k: string) => (k in entries ? entries[k] : null)
})

describe('workspace presets (epic #259; +Robot mode #320)', () => {
  it('defines the workspaces with valid geometry', () => {
    expect(WORKSPACE_IDS).toEqual(['code', 'board', 'robot'])
    for (const id of WORKSPACE_IDS) {
      const p = WORKSPACE_PRESETS[id]
      expect(p.horizontal).toHaveLength(4)
      expect(p.vertical).toHaveLength(2)
      expect(p.horizontal.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0)
      expect(p.vertical.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0)
    }
  })

  it("Robot mode: files collapsed, code ~1/3, board middle, dock open (#320)", () => {
    const r = WORKSPACE_PRESETS.robot
    expect(r.filesCollapsed).toBe(true)
    expect(r.boardPaneOpen).toBe(true)
    expect(r.dockOpen).toBe(true)
    // code (centre) is roughly a third and the board (slot 2) gets the rest.
    expect(r.horizontal[1]).toBeGreaterThan(25)
    expect(r.horizontal[1]).toBeLessThan(45)
    expect(r.horizontal[2]).toBeGreaterThan(r.horizontal[1])
  })

  it('a pre-Robot saved envelope gains the robot preset (migration)', () => {
    const saved = {
      version: 1,
      active: 'code',
      workspaces: { code: { ...WORKSPACE_PRESETS.code } } // no robot key
    }
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.workspaces.robot).toEqual(WORKSPACE_PRESETS.robot)
  })

  it("'code' preserves today's default layout; instrument dock per workspace", () => {
    const code = WORKSPACE_PRESETS.code
    expect(code.filesCollapsed).toBe(false)
    expect(code.shellCollapsed).toBe(false)
    expect(code.rightCollapsed).toBe(true)
    // Instrument dock: closed in Code + Board (the board is the star).
    expect(code.dockOpen).toBe(false)
    expect(WORKSPACE_PRESETS.board.dockOpen).toBe(false)
    // Board: the embedded Board View pane opens with a real share beside the
    // code; the other workspaces keep it closed at 0.
    expect(WORKSPACE_PRESETS.board.boardPaneOpen).toBe(true)
    expect(WORKSPACE_PRESETS.board.horizontal[2]).toBeGreaterThan(0)
    expect(WORKSPACE_PRESETS.code.boardPaneOpen).toBe(false)
    expect(WORKSPACE_PRESETS.code.horizontal[2]).toBe(0)
  })

  it('defaultLayoutState deep-copies the presets (reset cannot alias them)', () => {
    const a = defaultLayoutState()
    a.workspaces.code.horizontal[0] = 99
    expect(WORKSPACE_PRESETS.code.horizontal[0]).not.toBe(99)
    expect(defaultLayoutState().workspaces.code.horizontal[0]).not.toBe(99)
  })
})

describe('horizontal slot mapping — elided board/chat panels (#528)', () => {
  const h: [number, number, number, number] = [10, 30, 40, 20]

  it('appliedHorizontal matches the rendered panel count in every combination', () => {
    // Desktop (chat rendered): 4 panels with the board, 3 without.
    expect(appliedHorizontal(h, true, true)).toEqual([10, 30, 40, 20])
    expect(appliedHorizontal(h, false, true)).toEqual([10, 70, 20])
    // Web (no chat pane): 3 panels with the board, 2 without — the extra 0
    // here is exactly what threw 'Invalid 3 panel layout: 0%, 34%, 66%, 0%'.
    expect(appliedHorizontal(h, true, false)).toEqual([10, 50, 40])
    expect(appliedHorizontal(h, false, false)).toEqual([10, 90])
  })

  it('applied sizes always sum to 100 (folded slots go to the centre)', () => {
    for (const boardOn of [true, false]) {
      for (const chatOn of [true, false]) {
        const sizes = appliedHorizontal(h, boardOn, chatOn)
        expect(sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(100)
        expect(sizes).toHaveLength(2 + (boardOn ? 1 : 0) + (chatOn ? 1 : 0))
      }
    }
  })

  it('recordedHorizontal slots an onLayout report back into the 4-slot store', () => {
    expect(recordedHorizontal([10, 30, 40, 20], true, true)).toEqual([10, 30, 40, 20])
    expect(recordedHorizontal([10, 70, 20], false, true)).toEqual([10, 70, 0, 20])
    expect(recordedHorizontal([10, 50, 40], true, false)).toEqual([10, 50, 40, 0])
    expect(recordedHorizontal([10, 90], false, false)).toEqual([10, 90, 0, 0])
  })

  it('recordedHorizontal rejects a count mismatch (e.g. transient focus mode)', () => {
    // Focus mode elides the board pane while boardPaneOpen stays true — the
    // report is one short and must be ignored, not mis-slotted.
    expect(recordedHorizontal([10, 70, 20], true, true)).toBeNull()
    expect(recordedHorizontal([10, 90], true, false)).toBeNull()
    // Bad shares are rejected too.
    expect(recordedHorizontal([10, 20, 30, 5], true, true)).toBeNull()
  })

  it('round-trips: applied sizes record back losslessly (chat/board at 0 when elided)', () => {
    for (const boardOn of [true, false]) {
      for (const chatOn of [true, false]) {
        const expected = [
          h[0],
          h[1] + (boardOn ? 0 : h[2]) + (chatOn ? 0 : h[3]),
          boardOn ? h[2] : 0,
          chatOn ? h[3] : 0
        ]
        expect(recordedHorizontal(appliedHorizontal(h, boardOn, chatOn), boardOn, chatOn)).toEqual(
          expected
        )
      }
    }
  })
})

describe('loadLayoutState (corruption-safe, versioned)', () => {
  it('returns factory defaults with no stored state', () => {
    const s = loadLayoutState(storage())
    expect(s.version).toBe(1)
    expect(s.active).toBe('code')
    expect(s.workspaces.datalab).toEqual(WORKSPACE_PRESETS.datalab)
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
    saved.active = 'robot'
    saved.workspaces.robot.vertical = [60, 40]
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.active).toBe('robot')
    expect(s.workspaces.robot.vertical).toEqual([60, 40])
  })

  it('coerces a retired active id (lab/data/datalab) to code (#581)', () => {
    for (const stale of ['lab', 'data', 'datalab']) {
      const old = {
        version: 1,
        active: stale,
        workspaces: { code: { ...WORKSPACE_PRESETS.code } }
      }
      const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(old) }))
      expect(s.active, stale).toBe('code')
    }
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
    // Pre-#259 the group had three panels — the board slot maps in as 0.
    expect(s.workspaces.code.horizontal).toEqual([25, 60, 0, 15])
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

  it('folds a stray board share back to 0 when the pane is closed', () => {
    const saved = defaultLayoutState()
    saved.workspaces.code.horizontal = [10, 60, 20, 10] // pane closed but sized
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.workspaces.code.boardPaneOpen).toBe(false)
    expect(s.workspaces.code.horizontal).toEqual([10, 80, 0, 10])
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
