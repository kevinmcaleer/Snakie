import { describe, it, expect } from 'vitest'
import {
  BLOCKS_VIEW_RATIOS,
  WORKSPACE_PRESETS,
  defaultBlocksViewMode,
  defaultLayoutState,
  loadLayoutState,
  type LayoutState
} from '../src/renderer/src/store/layout'
import { WORKSPACE_IDS, WORKSPACE_INFO } from '../src/shared/workspaces'
import {
  BLOCKS_SPLIT_MIN_WIDTH,
  blocksSplitFits,
  resolveBlocksView
} from '../src/renderer/src/lib/blocks/split'

const store = (entries: Record<string, string>): { getItem(k: string): string | null } => ({
  getItem: (k) => entries[k] ?? null
})

const LAYOUT_KEY = 'snakie.layout.workspaces'

describe('the Blocks workspace segment (#1009)', () => {
  it('leads the switcher, so the on-ramp is the first thing on screen', () => {
    expect(WORKSPACE_IDS[0]).toBe('blocks')
    expect([...WORKSPACE_IDS]).toEqual(['blocks', 'code', 'board', 'robot'])
  })

  it('is labelled and hinted like every other segment (the menu builds from this)', () => {
    expect(WORKSPACE_INFO.blocks.label).toBe('Blocks')
    expect(WORKSPACE_INFO.blocks.hint.length).toBeGreaterThan(0)
  })

  it('is Code-shaped — editor and console, no board pane', () => {
    const p = WORKSPACE_PRESETS.blocks
    expect(p.centreCollapsed).toBe(false)
    expect(p.shellCollapsed).toBe(false)
    expect(p.boardPaneOpen).toBe(false)
    expect(p.filesCollapsed).toBe(false)
  })

  it('opens SPLIT, while Code opens Python-primary', () => {
    // #1016 changed this. The epic's teaching mechanism is the two panes being
    // on screen TOGETHER — a learner who watches the Python grow as they drag is
    // already reading it — and a canvas-primary default hid that behind a
    // control most people never press, which is the same as not shipping it.
    expect(defaultBlocksViewMode('blocks')).toBe('split')
    // Code still means "make the Python the big one". That is what the switcher
    // segment is FOR, and #1009's whole answer to "blocks or code?".
    expect(defaultBlocksViewMode('code')).toBe('python')
    // The stored ratio still favours the canvas, because blocks are wide and a
    // column of Python is not — "split" is both panes usable, not both equal.
    expect(WORKSPACE_PRESETS.blocks.blocksSplit).toEqual(BLOCKS_VIEW_RATIOS.blocks)
    expect(WORKSPACE_PRESETS.code.blocksSplit).toEqual(BLOCKS_VIEW_RATIOS.python)
  })

  it('every workspace has a blocks ratio — a blocks file opens anywhere', () => {
    for (const id of WORKSPACE_IDS) {
      expect(WORKSPACE_PRESETS[id].blocksSplit).toHaveLength(2)
      expect(WORKSPACE_PRESETS[id].blocksSplit[0] + WORKSPACE_PRESETS[id].blocksSplit[1]).toBe(100)
    }
  })
})

describe('layout envelope v4 → v5 migration (#1009)', () => {
  /** A v4 envelope: three workspaces, no `blocks`, no `blocksSplit` anywhere. */
  const v4 = JSON.stringify({
    version: 4,
    active: 'code',
    workspaces: {
      code: {
        activityView: 'packages',
        filesCollapsed: true,
        centreCollapsed: false,
        shellCollapsed: true,
        rightCollapsed: true,
        dockOpen: true,
        boardPaneOpen: false,
        horizontal: [12, 88, 0, 0],
        vertical: [70, 30]
      },
      board: WORKSPACE_PRESETS.board,
      robot: WORKSPACE_PRESETS.robot
    }
  })

  it('keeps every pre-v5 arrangement the user made', () => {
    const state = loadLayoutState(store({ [LAYOUT_KEY]: v4 }))
    const c = state.workspaces.code
    expect(c.activityView).toBe('packages')
    expect(c.filesCollapsed).toBe(true)
    expect(c.dockOpen).toBe(true)
    expect(c.horizontal).toEqual([12, 88, 0, 0])
    expect(c.vertical).toEqual([70, 30])
  })

  it('fills in the new workspace and the new ratio from the presets', () => {
    const state = loadLayoutState(store({ [LAYOUT_KEY]: v4 }))
    expect(state.version).toBe(5)
    expect(state.workspaces.blocks).toEqual(WORKSPACE_PRESETS.blocks)
    // Absent on a v4 code workspace — the preset is the normal answer here, not
    // the corruption case.
    expect(state.workspaces.code.blocksSplit).toEqual(WORKSPACE_PRESETS.code.blocksSplit)
  })

  it('round-trips a v5 envelope unchanged', () => {
    const fresh = defaultLayoutState()
    fresh.workspaces.blocks.blocksSplit = [40, 60]
    const state = loadLayoutState(store({ [LAYOUT_KEY]: JSON.stringify(fresh) }))
    expect(state.workspaces.blocks.blocksSplit).toEqual([40, 60])
  })

  it('a corrupt ratio falls back rather than rendering a broken split', () => {
    const bad = defaultLayoutState() as unknown as { workspaces: Record<string, unknown> }
    ;(bad.workspaces.blocks as { blocksSplit: unknown }).blocksSplit = [999, 'x']
    const state = loadLayoutState(store({ [LAYOUT_KEY]: JSON.stringify(bad) }))
    expect(state.workspaces.blocks.blocksSplit).toEqual(WORKSPACE_PRESETS.blocks.blocksSplit)
  })

  it('an envelope from a NEWER build still loads (forward-compat contract)', () => {
    const future = { ...(defaultLayoutState() as LayoutState), version: 99 }
    const state = loadLayoutState(store({ [LAYOUT_KEY]: JSON.stringify(future) }))
    // Unknown versions fall through to factory defaults rather than throwing.
    expect(state.workspaces.blocks).toEqual(WORKSPACE_PRESETS.blocks)
  })
})

describe('resolveBlocksView — the split, and when it stops fitting (#1009)', () => {
  it('blocks-primary puts the canvas big, with the Python beside it', () => {
    const v = resolveBlocksView('blocks', 1400)
    expect(v.kind).toBe('split')
    expect(v.peek).toBe(false)
    expect(v.ratio[0]).toBeGreaterThan(v.ratio[1])
  })

  it('python-primary collapses the canvas to a peek strip, not out of existence', () => {
    const v = resolveBlocksView('python', 1400)
    expect(v.kind).toBe('split')
    expect(v.peek).toBe(true)
    expect(v.ratio).toEqual([0, 100])
  })

  it('split is half and half', () => {
    expect(resolveBlocksView('split', 1400).ratio).toEqual([50, 50])
  })

  it('a remembered drag wins over the preset', () => {
    expect(resolveBlocksView('blocks', 1400, [30, 70]).ratio).toEqual([30, 70])
  })

  it('but a remembered ratio that would strand a pane does not', () => {
    // [0, 100] is the `python` emphasis's own ratio; leaking into `blocks` it
    // would show an empty canvas with no handle to drag back.
    expect(resolveBlocksView('blocks', 1400, [0, 100]).ratio).toEqual(BLOCKS_VIEW_RATIOS.blocks)
    expect(resolveBlocksView('blocks', 1400, [5, 95]).ratio).toEqual(BLOCKS_VIEW_RATIOS.blocks)
    expect(resolveBlocksView('blocks', 1400, [60, 60]).ratio).toEqual(BLOCKS_VIEW_RATIOS.blocks)
  })

  it('degrades to a tab pair below the threshold, never to two unusable columns', () => {
    expect(blocksSplitFits(BLOCKS_SPLIT_MIN_WIDTH)).toBe(true)
    expect(blocksSplitFits(BLOCKS_SPLIT_MIN_WIDTH - 1)).toBe(false)
    const v = resolveBlocksView('split', 480)
    expect(v.kind).toBe('tabs')
    // A peek strip in a tabbed layout would be a strip with nothing beside it.
    expect(v.peek).toBe(false)
  })

  it('a narrow window opens on the side the emphasis asked for', () => {
    expect(resolveBlocksView('python', 480).pane).toBe('python')
    expect(resolveBlocksView('blocks', 480).pane).toBe('canvas')
    expect(resolveBlocksView('split', 480).pane).toBe('canvas')
  })
})
