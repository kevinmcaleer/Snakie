import { describe, it, expect } from 'vitest'
import {
  WORKSPACE_IDS,
  WORKSPACE_PRESETS,
  LAYOUT_STORAGE_KEY,
  appliedHorizontal,
  coerceWorkspaceId,
  defaultLayoutState,
  loadLayoutState,
  recordedHorizontal,
  resolveSwitchTarget,
  type StorageLike,
  type WorkspaceLayout
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

  it('Build mode: URDF/3-D editor full screen — no code, no board, dock closed (#…)', () => {
    const r = WORKSPACE_PRESETS.robot
    expect(r.filesCollapsed).toBe(true)
    // No board view and no reopened instrument dock — the 3-D IS the main area.
    expect(r.boardPaneOpen).toBe(false)
    expect(r.dockOpen).toBe(false)
    // The centre column (now the full-screen robot editor) fills the width; the
    // board slot is empty.
    expect(r.horizontal[1]).toBe(100)
    expect(r.horizontal[2]).toBe(0)
    // The centre isn't collapsed (it holds the robot editor); only Electronics
    // collapses the centre to hand the whole area to the Board View.
    expect(r.centreCollapsed).toBe(false)
  })

  it('Electronics mode: code + console hidden, Board View fills the main area (#…)', () => {
    const b = WORKSPACE_PRESETS.board
    expect(b.filesCollapsed).toBe(true)
    expect(b.centreCollapsed).toBe(true)
    expect(b.boardPaneOpen).toBe(true)
    // Centre collapsed to 0, board takes the whole width.
    expect(b.horizontal[1]).toBe(0)
    expect(b.horizontal[2]).toBe(100)
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

describe('the lesson panel across a workspace switch (#…)', () => {
  /** Code as it rests after the user has read ONE help article: the sidebar is
   *  open (Code's default) and Help is still the selected view. This is the state
   *  that used to force the help panel open in Build on EVERY switch. */
  const codeReadingHelp: WorkspaceLayout = {
    ...WORKSPACE_PRESETS.code,
    activityView: 'help',
    filesCollapsed: false
  }
  /** Switch workspaces the way the store does: only the target is recomputed. */
  const switchTo = (
    ws: Record<string, WorkspaceLayout>,
    from: string,
    to: string,
    opts?: { carryLesson?: boolean }
  ): Record<string, WorkspaceLayout> => ({
    ...ws,
    [to]: resolveSwitchTarget(ws[from], ws[to], opts)
  })

  it('a fresh Build session opens COLLAPSED, even with Help selected in Code', () => {
    const fresh = defaultLayoutState().workspaces
    expect(fresh.robot.filesCollapsed).toBe(true)
    const build = resolveSwitchTarget(codeReadingHelp, fresh.robot)
    expect(build.filesCollapsed).toBe(true)
    expect(build).toEqual(fresh.robot) // nothing at all carried over
  })

  it('Electronics gets the same treatment (it shared the bug)', () => {
    const fresh = defaultLayoutState().workspaces
    expect(resolveSwitchTarget(codeReadingHelp, fresh.board).filesCollapsed).toBe(true)
  })

  it("the user's own expand survives a round-trip through another workspace", () => {
    const ws = defaultLayoutState().workspaces as unknown as Record<string, WorkspaceLayout>
    // The user opens Help in Build themselves (the activity bar's lesson path).
    ws.robot = { ...ws.robot, activityView: 'help', filesCollapsed: false }
    // Build → Code → Build, both plain switches.
    const afterOut = switchTo(ws, 'robot', 'code')
    const afterBack = switchTo(afterOut, 'code', 'robot')
    expect(afterBack.robot.filesCollapsed).toBe(false)
    expect(afterBack.robot.activityView).toBe('help')
    // …and Code was not forced into the lesson view on the way past.
    expect(afterBack.code.activityView).toBe(WORKSPACE_PRESETS.code.activityView)
  })

  it('a collapse in Build STICKS — the next switch in cannot undo it', () => {
    const ws = defaultLayoutState().workspaces as unknown as Record<string, WorkspaceLayout>
    ws.code = codeReadingHelp
    ws.robot = { ...ws.robot, activityView: 'help', filesCollapsed: true } // user closed it
    expect(switchTo(ws, 'code', 'robot').robot.filesCollapsed).toBe(true)
  })

  it('a LESSON that asks for the switch still opens its panel in Build', () => {
    const fresh = defaultLayoutState().workspaces
    const learning: WorkspaceLayout = {
      ...WORKSPACE_PRESETS.code,
      activityView: 'learn',
      filesCollapsed: false
    }
    const build = resolveSwitchTarget(learning, fresh.robot, { carryLesson: true })
    expect(build.filesCollapsed).toBe(false)
    expect(build.activityView).toBe('learn')
    // Only the lesson panel changes — the target's own geometry is untouched.
    expect(build.horizontal).toEqual(fresh.robot.horizontal)
    expect(build.centreCollapsed).toBe(fresh.robot.centreCollapsed)
  })

  it('a lesson-driven switch carries the Help library too', () => {
    const build = resolveSwitchTarget(codeReadingHelp, defaultLayoutState().workspaces.robot, {
      carryLesson: true
    })
    expect(build.filesCollapsed).toBe(false)
    expect(build.activityView).toBe('help')
  })

  it('carries nothing when there is no lesson on screen to carry', () => {
    const fresh = defaultLayoutState().workspaces
    // A non-lesson view (the file tree) is never carried into a solo workspace…
    const files: WorkspaceLayout = { ...WORKSPACE_PRESETS.code, filesCollapsed: false }
    expect(resolveSwitchTarget(files, fresh.robot, { carryLesson: true })).toEqual(fresh.robot)
    // …nor is a lesson view whose panel the user has collapsed.
    const hidden: WorkspaceLayout = { ...codeReadingHelp, filesCollapsed: true }
    expect(resolveSwitchTarget(hidden, fresh.robot, { carryLesson: true })).toEqual(fresh.robot)
  })
})

describe('a workspace asked for by ANOTHER window (#775)', () => {
  // A detached instrument window can't reach the switcher, so it sends the id
  // across a process boundary. That makes the id untrusted input arriving as a
  // plain string, and this is the boundary that has to judge it.
  it('accepts every workspace the switcher offers', () => {
    for (const id of WORKSPACE_IDS) expect(coerceWorkspaceId(id)).toBe(id)
  })

  it('refuses anything else rather than applying geometry that does not exist', () => {
    // `lab`/`data` are RETIRED ids that older sessions still carry around —
    // honouring one would strand the user on a workspace with no switcher segment.
    for (const bad of ['lab', 'data', 'datalab', 'Board', '', 'undefined']) {
      expect(coerceWorkspaceId(bad), bad).toBeNull()
    }
  })

  it('survives a payload that is not a string at all', () => {
    for (const bad of [undefined, null, 0, 1, {}, [], ['board']]) {
      expect(coerceWorkspaceId(bad), JSON.stringify(bad)).toBeNull()
    }
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
    expect(s.version).toBe(4)
    expect(s.active).toBe('code')
  })

  it('migrates a v1 envelope: resets Electronics + Build + the Code proportions (#…)', () => {
    // A pre-redesign v1 envelope where the user had the old Build layout (board
    // pane open, dock open) and a stale Code split. Build + Electronics reset to
    // the new full-screen / board-only presets; the Code sizes reset to the
    // corrected proportions (files ~20%, console ~45%); the active view carries.
    const oldRobot = { ...WORKSPACE_PRESETS.robot, boardPaneOpen: true, dockOpen: true, centreCollapsed: false, horizontal: [0, 34, 66, 0] }
    const oldBoard = { ...WORKSPACE_PRESETS.board, centreCollapsed: false, horizontal: [0, 42, 58, 0] }
    const v1 = {
      version: 1,
      active: 'robot',
      workspaces: {
        code: { ...WORKSPACE_PRESETS.code, activityView: 'help', horizontal: [30, 70, 0, 0] as [number, number, number, number], vertical: [70, 30] as [number, number] },
        board: oldBoard,
        robot: oldRobot
      }
    }
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(v1) }))
    expect(s.version).toBe(4)
    expect(s.active).toBe('robot')
    // Code sizes reset to the corrected preset; the active view carries over.
    expect(s.workspaces.code.horizontal).toEqual(WORKSPACE_PRESETS.code.horizontal)
    expect(s.workspaces.code.vertical).toEqual(WORKSPACE_PRESETS.code.vertical)
    expect(s.workspaces.code.activityView).toBe('help')
    // Build + Electronics reset — no board/dock in Build, code hidden in Electronics.
    expect(s.workspaces.robot).toEqual(WORKSPACE_PRESETS.robot)
    expect(s.workspaces.board).toEqual(WORKSPACE_PRESETS.board)
  })

  it('v2 → v3 migration: the Code files width + console height reset to the corrected preset', () => {
    // A v2 envelope with the old too-wide files (~30%) / too-short console (~30%).
    const v2 = {
      version: 2,
      active: 'code',
      workspaces: {
        code: { ...WORKSPACE_PRESETS.code, horizontal: [30, 70, 0, 0], vertical: [70, 30] }
      }
    }
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(v2) }))
    expect(s.version).toBe(4)
    expect(s.workspaces.code.horizontal).toEqual(WORKSPACE_PRESETS.code.horizontal)
    expect(s.workspaces.code.vertical).toEqual(WORKSPACE_PRESETS.code.vertical)
    expect(WORKSPACE_PRESETS.code.horizontal).toEqual([20, 80, 0, 0])
    expect(WORKSPACE_PRESETS.code.vertical).toEqual([55, 45])
    // A v3 envelope keeps its sizes (no further size reset).
    const v3 = { version: 3, active: 'code', workspaces: { code: { ...WORKSPACE_PRESETS.code, vertical: [50, 50] } } }
    const kept = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(v3) }))
    expect(kept.workspaces.code.vertical).toEqual([50, 50])
  })

  it('v3 → v4: a lesson panel the sticky rule forced into Electronics/Build is collapsed once (#…)', () => {
    // What every affected session has stored: the sticky lesson wrote an open
    // Help panel into the solo workspaces, and the user's own collapse never
    // survived the next switch — so this flag is the bug, not a preference.
    const v3 = {
      version: 3,
      active: 'code',
      workspaces: {
        code: { ...WORKSPACE_PRESETS.code, activityView: 'help' },
        board: { ...WORKSPACE_PRESETS.board, activityView: 'help', filesCollapsed: false },
        robot: { ...WORKSPACE_PRESETS.robot, activityView: 'help', filesCollapsed: false }
      }
    }
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(v3) }))
    expect(s.version).toBe(4)
    expect(s.workspaces.robot.filesCollapsed).toBe(true)
    expect(s.workspaces.board.filesCollapsed).toBe(true)
    // Only that one flag is touched — Code (whose sidebar is open by design) and
    // every other field are left exactly as the user had them.
    expect(s.workspaces.code.filesCollapsed).toBe(false)
    expect(s.workspaces.code.activityView).toBe('help')
    expect(s.workspaces.robot.horizontal).toEqual(WORKSPACE_PRESETS.robot.horizontal)
  })

  it('v4 keeps a lesson panel the user opened in Build themselves (across a restart)', () => {
    const saved = defaultLayoutState()
    saved.workspaces.robot.activityView = 'help'
    saved.workspaces.robot.filesCollapsed = false
    const s = loadLayoutState(storage({ [LAYOUT_STORAGE_KEY]: JSON.stringify(saved) }))
    expect(s.workspaces.robot.filesCollapsed).toBe(false)
    expect(s.workspaces.robot.activityView).toBe('help')
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
