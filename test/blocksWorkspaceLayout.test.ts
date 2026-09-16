import { describe, it, expect } from 'vitest'
import {
  BLOCKS_PANE_SLIVER,
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
  BLOCKS_STOP_RANGE,
  BLOCKS_STOPS,
  blocksSplitFits,
  modeForRatio,
  resolveBlocksView,
  stopFor
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

  it('opens the CANVAS, while Code opens Python-primary', () => {
    // #1016 made this SPLIT, because "a canvas-primary default hid that behind
    // a control most people never press, which is the same as not shipping it".
    // The worry was discoverability, and it was right: #1034 then replaced the
    // three buttons with the divider, which is elegant and invisible.
    //
    // #1053 puts a dot between Blocks and Code — the visible half of that
    // divider — so the split is one click away and looks like it. With a
    // control to find it by, Blocks means blocks again.
    expect(defaultBlocksViewMode('blocks')).toBe('blocks')
    // And the dot is what asks for both.
    expect(defaultBlocksViewMode('blocks', true)).toBe('split')
    // Code still means "make the Python the big one". That is what the switcher
    // segment is FOR, and #1009's whole answer to "blocks or code?".
    expect(defaultBlocksViewMode('code')).toBe('python')
    // The preset ratio stays the MIDDLE one even though the workspace now opens
    // canvas-only (#1053): the mode decides what is shown, and this is the
    // ratio the dot restores to. A fresh workspace pressing the dot gets an
    // even split rather than whatever the canvas-only view last recorded.
    expect(WORKSPACE_PRESETS.blocks.blocksSplit).toEqual(BLOCKS_VIEW_RATIOS.split)
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
    // A sliver, not nothing: the divider has to stay grabbable, and a learner
    // who cannot see where the blocks went has lost their program.
    expect(v.ratio).toEqual([BLOCKS_PANE_SLIVER, 100 - BLOCKS_PANE_SLIVER])
  })

  it('split is half and half', () => {
    expect(resolveBlocksView('split', 1400).ratio).toEqual([50, 50])
  })

  it('a remembered drag wins over the preset, in the MIDDLE stop', () => {
    // Only the middle has two sizes to remember. The ends are the ends.
    expect(resolveBlocksView('split', 1400, [30, 70]).ratio).toEqual([30, 70])
  })

  it('but a remembered ratio that would strand a pane does not', () => {
    // A ratio that leaves one pane NOTHING would show an empty half. Anything
    // else is a place the learner put the divider (#1034) and is kept — the
    // floor used to be 15% each, and it made the divider refuse to travel the
    // last fifth of its range.
    expect(resolveBlocksView('split', 1400, [0, 100]).ratio).toEqual(BLOCKS_VIEW_RATIOS.split)
    expect(resolveBlocksView('split', 1400, [60, 60]).ratio).toEqual(BLOCKS_VIEW_RATIOS.split)
    expect(resolveBlocksView('split', 1400, [5, 95]).ratio).toEqual([5, 95])
    expect(resolveBlocksView('split', 1400, [2, 98]).ratio).toEqual(BLOCKS_VIEW_RATIOS.split)
    expect(resolveBlocksView('split', 1400, [92, 8]).ratio).toEqual([92, 8])
  })

  it('the ends are the ends — a remembered ratio cannot reopen a closed pane', () => {
    expect(resolveBlocksView('blocks', 1400, [30, 70]).ratio).toEqual([
      100 - BLOCKS_PANE_SLIVER,
      BLOCKS_PANE_SLIVER
    ])
    expect(resolveBlocksView('python', 1400, [30, 70]).ratio).toEqual([
      BLOCKS_PANE_SLIVER,
      100 - BLOCKS_PANE_SLIVER
    ])
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

describe('the divider is the control (#1034)', () => {
  it('has three stops: code, both, blocks', () => {
    expect(BLOCKS_STOPS.map((s) => [s.mode, s.at])).toEqual([
      ['python', BLOCKS_PANE_SLIVER],
      ['split', 50],
      ['blocks', 100 - BLOCKS_PANE_SLIVER]
    ])
  })

  it('clicks into a stop when released near one', () => {
    expect(stopFor(50)?.mode).toBe('split')
    expect(stopFor(46)?.mode).toBe('split')
    expect(stopFor(57)?.mode).toBe('split')
    expect(stopFor(1)?.mode).toBe('python')
    expect(stopFor(98)?.mode).toBe('blocks')
  })

  it('leaves a deliberate ratio alone', () => {
    // A detent you cannot escape is not a detent, it is three buttons wearing a
    // costume. Somebody who wants 70/30 keeps 70/30.
    expect(stopFor(70)).toBeNull()
    expect(stopFor(30)).toBeNull()
    expect(stopFor(20)).toBeNull()
  })

  it('takes the NEAREST stop when two are in range', () => {
    expect(stopFor(BLOCKS_STOP_RANGE - 1)?.mode).toBe('python')
  })

  it('reads a ratio back as the stop it is sitting at', () => {
    expect(modeForRatio([100 - BLOCKS_PANE_SLIVER, BLOCKS_PANE_SLIVER])).toBe('blocks')
    expect(modeForRatio([BLOCKS_PANE_SLIVER, 100 - BLOCKS_PANE_SLIVER])).toBe('python')
    expect(modeForRatio([50, 50])).toBe('split')
    // Anything with both panes on screen is the middle stop: it means "both",
    // not "exactly half".
    expect(modeForRatio([70, 30])).toBe('split')
  })
})
