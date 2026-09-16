/**
 * WORKSPACE LAYOUT STORE — epic #259, Phases 0 + 1.
 * =============================================================================
 *
 * Phase 0: ALL layout geometry that previously lived as loose state inside
 * AppShell (three panel collapse flags, the instrument-dock visibility, the
 * active activity-bar view, and the react-resizable-panels sizes) now lives
 * here, in ONE versioned, corruption-safe store.
 *
 * Phase 1: the state is grouped into named WORKSPACES — `code` (today's
 * default), `board`, `lab` and `data` — each remembering its own geometry.
 * Switching workspaces is a one-click restyle of the same mounted component
 * tree: AppShell applies the target workspace's sizes IMPERATIVELY via the
 * panel-group handles (`setLayout`), so the editor, xterm scrollback and
 * instrument state all survive the switch (nothing remounts).
 *
 * Design notes:
 *  - Panel SIZES are kept in a ref (not React state): `onLayout` fires every
 *    drag frame, and re-rendering the shell per frame would be a regression
 *    over the library's own autoSaveId persistence this replaces. Writes are
 *    debounced to localStorage.
 *  - `applyNonce` bumps on switch/reset; AppShell watches it and re-applies
 *    the active workspace's geometry to the panel groups.
 *  - Legacy migration: the pre-#259 keys (`snakie.collapsed.*`,
 *    `snakie.activityView`, `snakie.instruments.dockOpen` and the
 *    react-resizable-panels autosave entries) seed the `code` workspace once,
 *    so existing users keep their exact layout.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ActivityView } from '../components/ActivityBar'

/**
 * The named workspaces, their labels and the id validator now live in
 * `src/shared/workspaces.ts` — the application menu builds View ▸ Workspace
 * from them (#916) and the main process cannot import this React store. They
 * are re-exported here so every existing `from '../store/layout'` import keeps
 * working, and so there is still only ONE list of workspaces.
 */
export {
  WORKSPACE_IDS,
  WORKSPACE_INFO,
  coerceWorkspaceId,
  type WorkspaceId
} from '../../../shared/workspaces'
import { WORKSPACE_IDS, type WorkspaceId } from '../../../shared/workspaces'

/** One workspace's remembered geometry. */
export interface WorkspaceLayout {
  /** Active left-sidebar view (activity bar). */
  activityView: ActivityView
  filesCollapsed: boolean
  /** The centre column (code editor + console). Collapsed to 0 in Electronics,
   *  where the Board View takes over the whole main area (#…). The editor stays
   *  MOUNTED behind the 0-width panel, so switching Code↔Electronics never
   *  remounts Monaco. */
  centreCollapsed: boolean
  shellCollapsed: boolean
  rightCollapsed: boolean
  /** The fixed-width instrument dock (not a Panel — a plain show/hide region). */
  dockOpen: boolean
  /** The embedded Board View pane (epic #259 / the Board workspace): rendered
   *  as a fourth Panel between the centre and the chat when true. */
  boardPaneOpen: boolean
  /** react-resizable-panels layouts: horizontal = [files, centre, board, chat]
   *  (the board slot is 0 whenever the pane is closed). */
  horizontal: [number, number, number, number]
  /** vertical = [editor, shell]. */
  vertical: [number, number]
  /**
   * The Blocks split (#1009, epic #1007): `[canvas, python]` shares of the
   * EDITOR slot when a blocks file is open.
   *
   * Per workspace, like every other ratio here, because that is the whole point
   * of the fourth segment: Blocks makes the canvas big and Code makes the Python
   * big, on the same file, with nothing remounted. It is the last DRAGGED ratio
   * — the `Blocks · Split · Python` control sets it from
   * {@link BLOCKS_VIEW_RATIOS}, and dragging the handle fine-tunes it from there.
   */
  blocksSplit: [number, number]
}

/**
 * The three STOPS of the split (#1009, reshaped by #1034).
 *
 * Not three layouts — one divider with three positions it clicks into. Blocks
 * at one end, code at the other, and both in the middle; the divider is the
 * control, so these are where it rests rather than what three buttons set.
 *
 * A collapsed pane is never a HIDDEN one: it keeps a sliver the divider can be
 * dragged back off, because a learner who cannot see where the blocks went has
 * lost their program.
 */
export type BlocksViewMode = 'blocks' | 'split' | 'python'

/**
 * A pane at or below this share is CLOSED — a tolerance, not a reserved strip.
 *
 * It used to be both. #1034 made the divider the only control, and a pane
 * collapsed to nothing would have put that divider flush against the edge of
 * the group where it cannot be grabbed, so an end stop left three percent
 * showing: an edge you could see and take hold of.
 *
 * #1053 gave the switcher a dot, which is a NAMED way back to the split from
 * either end — so the sliver stopped paying for itself and started costing
 * something instead. Three percent of a wide editor is forty pixels of the
 * other pane bleeding in at the edge: a column of chopped-off Python beside the
 * blocks, or a strip of half-blocks beside the code. "Blocks" should mean
 * blocks.
 *
 * So the stops are now hard 0/100, and this is what remains: the threshold
 * `modeForRatio` and friends read a ratio against. It also keeps a layout
 * persisted before this change — a stored `[97, 3]` — reading as the end stop
 * it was meant to be rather than as a very lopsided split.
 */
export const BLOCKS_PANE_CLOSED = 3

/** `[canvas, python]` shares at each stop. */
export const BLOCKS_VIEW_RATIOS: Record<BlocksViewMode, [number, number]> = {
  blocks: [100, 0],
  split: [50, 50],
  python: [0, 100]
}

/**
 * Which emphasis a blocks file starts in, given the workspace showing it.
 *
 * Epic #1007 §8 Q5's proposal: per file, seeded from the workspace default. So
 * Blocks opens blocks-primary, Code opens Python-primary — which is what makes
 * pressing **Code** on a blocks file mean something — and a file the user has
 * set by hand keeps their choice while they have it open.
 *
 * The solo workspaces (Electronics/Build) never show the editor at all, so their
 * answer only matters if someone switches away with a blocks file open; blocks
 * is the friendlier place to land.
 */
export function defaultBlocksViewMode(workspace: WorkspaceId, both = false): BlocksViewMode {
  // THE DOT DECIDES (#1053). `both` is the switcher's middle position — the dot
  // between Blocks and Code — and when it is set the answer is the split
  // whichever side of it you came from.
  //
  // #1016 made the split the DEFAULT in Blocks instead, and said why: "a
  // canvas-primary default hid that behind a control most people never press,
  // which is the same as not shipping it". That reasoning was about
  // DISCOVERABILITY, and the control it was worried about did not exist — #1034
  // removed the three-button one in favour of the divider, which is elegant and
  // invisible. The dot is the control it was missing, so Blocks can go back to
  // meaning blocks: the split is now one click away and visibly so.
  if (both) return 'split'
  return workspace === 'code' ? 'python' : 'blocks'
}

/**
 * Would restoring this remembered ratio show only ONE pane (#1053)?
 *
 * The dot means "both on screen", and it restores the ratio the workspace
 * remembers — which is recorded on every drag frame, so the moment Blocks shows
 * its canvas-only view the remembered ratio becomes an end stop. Restoring that
 * is the canvas again, and the dot appears to do nothing at all.
 *
 * Only an END counts. A learner who dragged the divider to 65/35 meant it, and
 * pressing the dot should take them back to THEIR middle rather than ours.
 */
export function ratioShowsOnePane(ratio: readonly number[] | undefined): boolean {
  if (!ratio || ratio.length !== 2) return true
  if (!ratio.every((n) => typeof n === 'number' && Number.isFinite(n))) return true
  return ratio[0] <= BLOCKS_PANE_CLOSED || ratio[1] <= BLOCKS_PANE_CLOSED
}

/**
 * What pressing a workspace segment means when that workspace is ALREADY the
 * active one (#1060).
 *
 * There used to be one answer — "you re-clicked the current tab" — and it was
 * right while the switcher had one position per workspace. The dot (#1053) made
 * it three-position across Blocks and Code, and in the split BOTH of those
 * segments are lit while only one of them is `active`. So pressing the lit
 * segment you are already "on" fell through to the no-op, and the switcher
 * offered a button that visibly could not do what it said.
 *
 * Pressing a segment is a statement about which side you want — the same thing
 * it means when the dot is out — so it closes the split.
 *
 * Pure, so the three-way rule is a test rather than something you find out by
 * pressing Blocks in the split view and watching nothing happen.
 */
export type ActiveSegmentPress = 'close-split' | 'exit-focus'

export function pressingActiveSegment(id: WorkspaceId, both: boolean): ActiveSegmentPress {
  // Only Blocks and Code have a split to close; Electronics and Build are
  // whole workspaces and the dot is never lit on them.
  if (both && (id === 'blocks' || id === 'code')) return 'close-split'
  // Otherwise the old meaning stands: a way out of focus mode without
  // switching away.
  return 'exit-focus'
}

/** The persisted envelope. Bump `version` on breaking shape changes.
 *  v2 (#…): Electronics + Build were redesigned — Electronics hides code+console
 *  so the Board View fills the area; Build is the full-screen URDF editor with no
 *  code/board/instrument dock. A stored v1 envelope keeps the user's Code layout
 *  but resets those two workspaces to the new presets ({@link loadLayoutState}).
 *  v4 (#…): the "sticky lesson" used to REWRITE Electronics/Build's own panel
 *  state on every switch, so a `filesCollapsed:false` stored for them is residue
 *  of that bug rather than a choice the user could make stick — collapse it once
 *  on load.
 *  v5 (#1009): a fourth workspace (`blocks`) and a `blocksSplit` ratio on every
 *  workspace. A stored v4 envelope has neither — the missing workspace falls back
 *  to its preset and the missing ratio to each workspace's, both handled
 *  field-by-field by {@link sanitiseWorkspace}, so nothing the user arranged is
 *  disturbed. */
export interface LayoutState {
  version: 5
  active: WorkspaceId
  workspaces: Record<WorkspaceId, WorkspaceLayout>
}

/** Where the envelope persists. (One key; see #228 for the registry idea.) */
export const LAYOUT_STORAGE_KEY = 'snakie.layout.workspaces'

/** The curated presets — each workspace's factory geometry (Phase 1). */
export const WORKSPACE_PRESETS: Record<WorkspaceId, WorkspaceLayout> = {
  // Blocks (#1009, epic #1007): Code's shape with the emphasis moved. Files open
  // (a learner needs to find their projects), editor + console, NO board pane —
  // a first-hour learner has enough to look at, and "blocks follow your circuit"
  // (#1017) is the argument for bringing it back later, not now. The centre is
  // the canvas/Python split with the CANVAS big.
  blocks: {
    activityView: 'files',
    filesCollapsed: false,
    centreCollapsed: false,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: false,
    boardPaneOpen: false,
    horizontal: [20, 80, 0, 0],
    // A shorter console than Code's: the canvas needs the height, and the
    // console here is for a traceback (#1015), not a working REPL.
    vertical: [68, 32],
    blocksSplit: [...BLOCKS_VIEW_RATIOS.split]
  },
  // Today's default layout, unchanged: files open, editor + console, no dock.
  code: {
    activityView: 'files',
    filesCollapsed: false,
    centreCollapsed: false,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: false,
    boardPaneOpen: false,
    // Files ~20% (≈ the design's 272px) — not the old 30% clamp. Console gets a
    // roomy ~45% so a couple of REPL lines are clearly visible by default, so the
    // user recognises the console for what it is (#…).
    horizontal: [20, 80, 0, 0],
    vertical: [55, 45],
    // Python-primary: the canvas collapses to a peek strip, which is what
    // pressing Code on a blocks file means.
    blocksSplit: [...BLOCKS_VIEW_RATIOS.python]
  },
  // Electronics: the Board View fills the whole main area — CODE AND CONSOLE ARE
  // HIDDEN (the centre column collapses to 0, editor still mounted behind it), so
  // wiring is the sole focus. The instrument dock stays closed (reopenable).
  board: {
    activityView: 'files',
    filesCollapsed: true,
    centreCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: false,
    boardPaneOpen: true,
    horizontal: [0, 0, 100, 0],
    vertical: [65, 35],
    blocksSplit: [...BLOCKS_VIEW_RATIOS.split]
  },
  // Build (#320): the URDF/3-D editor FULL SCREEN — no code, no board view. The
  // centre column hosts the full-screen Robot pose tool (files collapsed, board
  // pane closed, dock closed & reopenable for instruments). The 3-D IS the main
  // area now, so the old mini-3-D dock panel is gone.
  robot: {
    activityView: 'files',
    filesCollapsed: true,
    centreCollapsed: false,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: false,
    boardPaneOpen: false,
    horizontal: [0, 100, 0, 0],
    vertical: [65, 35],
    blocksSplit: [...BLOCKS_VIEW_RATIOS.split]
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no React, no window)
// ---------------------------------------------------------------------------

/** Is `v` a finite-number array of exactly `n` entries summing to ~100? */
function validSizes(v: unknown, n: number): v is number[] {
  if (!Array.isArray(v) || v.length !== n) return false
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) return false
  const sum = v.reduce((a, b) => a + b, 0)
  return Math.abs(sum - 100) < 1
}

const VIEWS: ActivityView[] = [
  'files',
  'source-control',
  'packages',
  'plugins',
  'inspect',
  'learn',
  'help',
  'report-bug'
]

/** Sidebar views that are a guided lesson (the Learn tutorials + the Help
 *  library) — the only views a solo workspace (Electronics/Build) shows at all. */
const LESSON_VIEWS: ReadonlySet<ActivityView> = new Set(['learn', 'help'])

/** The SOLO workspaces: one main surface, sidebar hidden unless a lesson is
 *  showing. Their panel state is the one the v4 migration re-collapses. */
const SOLO_WORKSPACE_IDS = ['board', 'robot'] as const

/** Why a workspace switch happened. */
export interface SwitchOptions {
  /** A LESSON asked for this switch — a tutorial step declaring the `view` it is
   *  about, or any other deliberate "show them this over there". Only then does
   *  an open Learn/Help panel follow the user into the target. */
  carryLesson?: boolean
}

/**
 * The layout the TARGET workspace should adopt when switching away from `from`.
 *
 * Every workspace remembers its OWN panel state, so a plain switch returns the
 * target UNCHANGED — Build opens the way the user last left it (collapsed, per
 * its preset), and a panel they expanded there is still expanded next time.
 *
 * Only a switch a lesson ASKED for (`carryLesson`) brings an open lesson panel
 * along, so a tutorial that sends the learner to Build still has its
 * instructions on screen. Before #…, EVERY switch did this whenever the
 * outgoing workspace happened to have Learn/Help selected with its sidebar open
 * — which in Code is the normal resting state after reading one help article —
 * so Build re-opened the help panel every single time, overwriting the user's
 * own collapse.
 */
export function resolveSwitchTarget(
  from: WorkspaceLayout,
  to: WorkspaceLayout,
  opts: SwitchOptions = {}
): WorkspaceLayout {
  if (!opts.carryLesson) return to
  if (from.filesCollapsed || !LESSON_VIEWS.has(from.activityView)) return to
  return { ...to, activityView: from.activityView, filesCollapsed: false }
}

/** Validate one workspace's shape, falling back to `preset` field-by-field. */
function sanitiseWorkspace(raw: unknown, preset: WorkspaceLayout): WorkspaceLayout {
  const r = (raw ?? {}) as Record<string, unknown>
  const ws: WorkspaceLayout = {
    activityView: VIEWS.includes(r.activityView as ActivityView)
      ? (r.activityView as ActivityView)
      : preset.activityView,
    filesCollapsed:
      typeof r.filesCollapsed === 'boolean' ? r.filesCollapsed : preset.filesCollapsed,
    centreCollapsed:
      typeof r.centreCollapsed === 'boolean' ? r.centreCollapsed : preset.centreCollapsed,
    shellCollapsed:
      typeof r.shellCollapsed === 'boolean' ? r.shellCollapsed : preset.shellCollapsed,
    rightCollapsed:
      typeof r.rightCollapsed === 'boolean' ? r.rightCollapsed : preset.rightCollapsed,
    dockOpen: typeof r.dockOpen === 'boolean' ? r.dockOpen : preset.dockOpen,
    boardPaneOpen: typeof r.boardPaneOpen === 'boolean' ? r.boardPaneOpen : preset.boardPaneOpen,
    horizontal: validSizes(r.horizontal, 4)
      ? (r.horizontal as [number, number, number, number])
      : [...preset.horizontal],
    vertical: validSizes(r.vertical, 2) ? (r.vertical as [number, number]) : [...preset.vertical],
    // Absent in every pre-v5 envelope, so the preset is the normal answer here
    // rather than the corruption case.
    blocksSplit: validSizes(r.blocksSplit, 2)
      ? (r.blocksSplit as [number, number])
      : [...preset.blocksSplit]
  }
  // A closed board pane always sits at 0 width — fold any stray share back into
  // the centre so the sizes stay consistent with what's rendered.
  if (!ws.boardPaneOpen && ws.horizontal[2] !== 0) {
    ws.horizontal[1] += ws.horizontal[2]
    ws.horizontal[2] = 0
  }
  return ws
}

/**
 * The horizontal PanelGroup renders a VARIABLE number of panels — the board
 * pane elides when closed (or in focus mode) and the chat pane doesn't exist
 * at all on the web build (#528). These two helpers translate between the
 * canonical 4-slot store layout `[files, centre, board, chat]` and whatever
 * the group actually renders, so setLayout never receives a stray slot and
 * onLayout sizes always land back in the right slots.
 */

/** The setLayout array for the RENDERED panels: elided slots fold into the
 *  centre so the shares still sum to 100. */
export function appliedHorizontal(
  horizontal: readonly [number, number, number, number],
  boardOn: boolean,
  chatOn: boolean
): number[] {
  const [files, centre, board, chat] = horizontal
  const sizes = [files, centre + (boardOn ? 0 : board) + (chatOn ? 0 : chat)]
  if (boardOn) sizes.push(board)
  if (chatOn) sizes.push(chat)
  return sizes
}

/** Map an onLayout report back into the canonical 4 slots (elided slots → 0),
 *  or null when the report doesn't match the rendered panel count. */
export function recordedHorizontal(
  sizes: number[],
  boardOn: boolean,
  chatOn: boolean
): [number, number, number, number] | null {
  const n = 2 + (boardOn ? 1 : 0) + (chatOn ? 1 : 0)
  if (!validSizes(sizes, n)) return null
  return [sizes[0], sizes[1], boardOn ? sizes[2] : 0, chatOn ? sizes[boardOn ? 3 : 2] : 0]
}

/** A fresh factory-default state (every workspace at its preset). */
export function defaultLayoutState(): LayoutState {
  const workspaces = {} as Record<WorkspaceId, WorkspaceLayout>
  for (const id of WORKSPACE_IDS) {
    workspaces[id] = {
      ...WORKSPACE_PRESETS[id],
      horizontal: [...WORKSPACE_PRESETS[id].horizontal],
      vertical: [...WORKSPACE_PRESETS[id].vertical],
      blocksSplit: [...WORKSPACE_PRESETS[id].blocksSplit]
    }
  }
  return { version: 5, active: 'code', workspaces }
}

/** Storage surface the loader reads (injectable for tests). */
export type StorageLike = Pick<Storage, 'getItem'>

/**
 * Best-effort read of a pre-#259 react-resizable-panels autosave entry (the
 * library stored `react-resizable-panels:<autoSaveId>` →
 * `{ "<panel ids>": { layout: number[] } }`). Returns the layout or null.
 */
function legacyPanelSizes(storage: StorageLike, autoSaveId: string, n: number): number[] | null {
  try {
    const raw = storage.getItem(`react-resizable-panels:${autoSaveId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, { layout?: unknown }>
    for (const entry of Object.values(parsed)) {
      if (entry && validSizes(entry.layout, n)) return entry.layout as number[]
    }
  } catch {
    // fall through
  }
  return null
}

/** Read a legacy boolean key persisted by useLocalStorage (JSON booleans). */
function legacyBool(storage: StorageLike, key: string): boolean | null {
  try {
    const raw = storage.getItem(key)
    if (raw === 'true' || raw === 'false') return raw === 'true'
  } catch {
    // fall through
  }
  return null
}

/**
 * Load the layout envelope: the versioned key when valid, else factory
 * defaults SEEDED from the pre-#259 legacy keys (so an existing user's layout
 * carries into their `code` workspace). Never throws.
 */
export function loadLayoutState(storage: StorageLike): LayoutState {
  // 1) The new envelope.
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LayoutState>
      const ver = (parsed as { version?: number } | null)?.version
      const known = typeof ver === 'number' && ver >= 1 && ver <= 5
      if (parsed && known && parsed.workspaces) {
        const state = defaultLayoutState()
        // Any retired active workspace (`lab`/`data`/`datalab` — Data Lab was
        // never surfaced and is retired in Soft Shell, #581) coerces to `code`
        // via the WORKSPACE_IDS membership check below, so a stale session can't
        // land on a workspace with no switcher segment.
        const saved = parsed.workspaces as Record<string, unknown>
        const activeRaw = parsed.active as WorkspaceId
        state.active = WORKSPACE_IDS.includes(activeRaw) ? activeRaw : 'code'
        // v1 → v2: Electronics (`board`) + Build (`robot`) were redesigned, so a v1
        // envelope's saved geometry for them no longer makes sense (old Build kept
        // the code + board panes; new Build is a full-screen URDF editor). Reset
        // those two to the new presets; the user's Code layout still carries over.
        const resetRedesigned = ver === 1
        // v2 → v3: the Code proportions were corrected — files were clamped too wide
        // (~30%) and the console too short. A pre-v3 envelope resets the Code
        // workspace's sizes to the new preset (files ~20%, console ~45%) so the fix
        // actually reaches existing users; collapse flags + the active view carry over.
        const resetCodeSizes = ver === 1 || ver === 2
        for (const id of WORKSPACE_IDS) {
          if (resetRedesigned && (id === 'board' || id === 'robot')) continue // keep preset
          state.workspaces[id] = sanitiseWorkspace(saved[id], WORKSPACE_PRESETS[id])
        }
        if (resetCodeSizes) {
          const c = state.workspaces.code
          c.horizontal = [...WORKSPACE_PRESETS.code.horizontal] as [number, number, number, number]
          c.vertical = [...WORKSPACE_PRESETS.code.vertical] as [number, number]
        }
        // v3 → v4: until #…, switching INTO Electronics/Build rewrote their own
        // `filesCollapsed` to false whenever the outgoing workspace had Learn/Help
        // selected — so a stored open lesson panel there is the bug's residue, not
        // a preference the user could make stick (collapsing it was undone by the
        // next switch). Collapse it once; a deliberate open after this persists.
        if (ver < 4) {
          for (const id of SOLO_WORKSPACE_IDS) {
            state.workspaces[id].filesCollapsed = WORKSPACE_PRESETS[id].filesCollapsed
          }
        }
        ensureUsableConsole(state)
        return state
      }
    }
  } catch {
    // corrupt → fall through to defaults
  }

  // 2) Factory defaults + one-off migration of the legacy loose keys.
  const state = defaultLayoutState()
  const code = state.workspaces.code
  try {
    const files = legacyBool(storage, 'snakie.collapsed.files')
    const shell = legacyBool(storage, 'snakie.collapsed.shell')
    const right = legacyBool(storage, 'snakie.collapsed.right')
    const dock = legacyBool(storage, 'snakie.instruments.dockOpen')
    if (files !== null) code.filesCollapsed = files
    if (shell !== null) code.shellCollapsed = shell
    if (right !== null) code.rightCollapsed = right
    if (dock !== null) code.dockOpen = dock
    const viewRaw = storage.getItem('snakie.activityView')
    if (viewRaw) {
      const view = JSON.parse(viewRaw) as ActivityView
      if (VIEWS.includes(view)) code.activityView = view
    }
    // Pre-#259 the horizontal group had THREE panels [files, centre, chat];
    // the board slot (index 2) didn't exist yet, so it maps in as 0.
    const h = legacyPanelSizes(storage, 'snakie.layout.horizontal', 3)
    const v = legacyPanelSizes(storage, 'snakie.layout.vertical', 2)
    if (h) code.horizontal = [h[0], h[1], 0, h[2]]
    if (v) code.vertical = v as [number, number]
  } catch {
    // any migration hiccup → plain defaults
  }
  ensureUsableConsole(state)
  return state
}

/**
 * Guarantee a usable Code console height on EVERY load: a persisted split whose
 * console share is too short to show the REPL (any version) is bumped to the
 * preset, so the console is always recognisable — a hard floor over the runtime
 * `minSize`, which can't retro-fix an already-stored tiny value (#…).
 */
function ensureUsableConsole(state: LayoutState): void {
  const c = state.workspaces.code
  if (c.vertical[1] < 30) c.vertical = [...WORKSPACE_PRESETS.code.vertical] as [number, number]
}

// ---------------------------------------------------------------------------
// The store (context + provider)
// ---------------------------------------------------------------------------

/** A panel group whose sizes this store remembers per workspace. */
export type SizeGroup = 'horizontal' | 'vertical' | 'blocksSplit'

export interface LayoutStore {
  /** The active workspace id. */
  active: WorkspaceId
  /** The ACTIVE workspace's non-size fields (sizes live behind getSizes). */
  workspace: WorkspaceLayout
  /** Bumps when geometry must be re-applied to the panel groups (switch/reset). */
  applyNonce: number
  /** Transient editor focus (Robot pop-out): hide board/instruments/console so the
   *  URDF fills the editor. NOT persisted; cleared on workspace switch. */
  focus: boolean
  /**
   * THE DOT (#1053): the switcher's middle position, between Blocks and Code.
   *
   * Blocks and code on screen together is not a fourth workspace — it is an
   * emphasis inside the one that shows a blocks file, which is why it is a flag
   * here rather than a `WorkspaceId`. Electronics and Build are workspaces; this
   * is the dot between two of them.
   *
   * NOT PERSISTED, and cleared by any plain workspace switch: pressing Blocks or
   * Code is a statement about which side you want, and leaving the dot lit after
   * it would make the switcher describe something that is not on screen.
   */
  blocksBoth: boolean
  /** Latest sizes for a group (live ref-backed; safe to call every render). */
  getSizes: (group: SizeGroup) => number[]
  /** Show a workspace. Pass `{ carryLesson: true }` only when a LESSON asked for
   *  the switch — an open Learn/Help panel then follows the user into the target
   *  (a plain switch leaves the target's own panel state alone). */
  switchWorkspace: (id: WorkspaceId, opts?: SwitchOptions) => void
  /** Restore the ACTIVE workspace to its factory preset. */
  resetActive: () => void
  setActivityView: (view: ActivityView) => void
  setCollapsed: (panel: 'files' | 'centre' | 'shell' | 'right', collapsed: boolean) => void
  setDockOpen: (open: boolean) => void
  /** Enter/leave transient editor-focus mode. */
  setFocus: (focus: boolean) => void
  /**
   * Show blocks and code together (#1053) — the dot.
   *
   * Takes the workspace to show them in, because the dot is reachable from
   * either side: clicking it from Code has to land somewhere that renders a
   * canvas. Passing `false` just puts the dot out, leaving the workspace alone.
   */
  setBlocksBoth: (both: boolean) => void
  /**
   * Apply a `[canvas, python]` ratio to the Blocks split and make the mounted
   * panel group adopt it (#1009).
   *
   * Distinct from {@link recordSizes}, which only REMEMBERS what a drag already
   * did: this one has to move panels that are on screen, so it bumps
   * {@link applyNonce} — the same signal the workspace switch uses, for the same
   * reason (restyle the mounted tree, remount nothing).
   */
  setBlocksSplit: (sizes: [number, number]) => void
  /** Record a live panel-group layout (called from onLayout every drag frame). */
  recordSizes: (group: SizeGroup, sizes: number[]) => void
  /** A board id the Electronics view should swap to (from the mini board view when
   *  the swap would drop wires — the confirm belongs in the wiring context). Held
   *  until the Board View consumes it. Transient; never persisted. */
  pendingBoardSwap: string | null
  /** Ask the Electronics view to swap to `id` (switches to it + sets the pending). */
  requestBoardSwap: (id: string) => void
  /** Clear the pending board swap once the Board View has handled it. */
  clearBoardSwap: () => void
}

const LayoutContext = createContext<LayoutStore | null>(null)

/** Debounce for localStorage writes while dragging (ms). */
const SAVE_DEBOUNCE_MS = 300

export function LayoutProvider({
  children,
  chatPane = true
}: {
  children: ReactNode
  /** Whether the chat right-pane exists in this build (false on web, #528) —
   *  recordSizes needs it to slot onLayout reports back into the 4-slot store. */
  chatPane?: boolean
}): JSX.Element {
  // The full envelope lives in a ref (sizes mutate every drag frame); the
  // pieces React must re-render on (active id + the active workspace's
  // non-size fields) are mirrored into state.
  const stateRef = useRef<LayoutState | null>(null)
  if (stateRef.current === null) stateRef.current = loadLayoutState(window.localStorage)
  const [active, setActive] = useState<WorkspaceId>(stateRef.current.active)
  const [workspace, setWorkspace] = useState<WorkspaceLayout>(
    stateRef.current.workspaces[stateRef.current.active]
  )
  const [applyNonce, setApplyNonce] = useState(0)
  // Transient editor-focus (Robot pop-out) — never persisted.
  const [focus, setFocusState] = useState(false)
  /** The dot (#1053) — blocks and code on screen together. Not persisted. */
  const [blocksBoth, setBlocksBothState] = useState(false)
  /**
   * The same value as a REF, because `switchWorkspace` has to branch on it
   * (#1060) and a callback that closed over the state would read a stale one.
   * Every write goes through {@link setBoth} so the two cannot drift.
   */
  const blocksBothRef = useRef(false)
  const setBoth = useCallback((next: boolean): void => {
    blocksBothRef.current = next
    setBlocksBothState(next)
  }, [])
  // A board swap the mini board view punted to the Electronics view for its confirm
  // dialog (transient; never persisted).
  const [pendingBoardSwap, setPendingBoardSwap] = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persist = useCallback((): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stateRef.current))
      } catch {
        // storage may be unavailable — layout still works for the session
      }
    }, SAVE_DEBOUNCE_MS)
  }, [])

  /** Mutate the ACTIVE workspace and sync the React mirror + persistence. */
  const patchActive = useCallback(
    (patch: Partial<WorkspaceLayout>): void => {
      const s = stateRef.current as LayoutState
      const next = { ...s.workspaces[s.active], ...patch }
      s.workspaces[s.active] = next
      setWorkspace(next)
      persist()
    },
    [persist]
  )

  const getSizes = useCallback((group: SizeGroup): number[] => {
    const s = stateRef.current as LayoutState
    return [...s.workspaces[s.active][group]]
  }, [])

  const setBlocksSplit = useCallback(
    (sizes: [number, number]): void => {
      if (!validSizes(sizes, 2)) return
      const s = stateRef.current as LayoutState
      s.workspaces[s.active].blocksSplit = [...sizes]
      persist()
      // The split is MOUNTED when this runs (the control lives above it), so
      // remembering the ratio is not enough — the group has to move.
      setApplyNonce((n) => n + 1)
    },
    [persist]
  )

  const recordSizes = useCallback(
    (group: SizeGroup, sizes: number[]): void => {
      const s = stateRef.current as LayoutState
      const ws = s.workspaces[s.active]
      if (group === 'horizontal') {
        // Elided panels (closed board pane; no chat pane on web) report fewer
        // sizes — map them back into the canonical 4 slots. A count mismatch
        // (e.g. transient focus mode) is ignored, as before.
        const mapped = recordedHorizontal(sizes, ws.boardPaneOpen, chatPane)
        if (!mapped) return
        ws.horizontal = mapped
      } else if (group === 'vertical' && validSizes(sizes, 2)) {
        ws.vertical = sizes as [number, number]
      } else if (group === 'blocksSplit' && validSizes(sizes, 2)) {
        ws.blocksSplit = sizes as [number, number]
      } else {
        return
      }
      // Sizes deliberately DON'T touch React state (per-frame drags); persist only.
      persist()
    },
    [persist, chatPane]
  )

  const switchWorkspace = useCallback(
    (id: WorkspaceId, opts?: SwitchOptions): void => {
      const s = stateRef.current as LayoutState
      if (s.active === id) {
        // THE DOT MAKES THIS CONTROL THREE-POSITION (#1060). In the split, the
        // active workspace is ALREADY Blocks or Code — so pressing that same
        // segment used to fall into "re-clicking the active tab" and do
        // nothing at all, leaving the switcher offering a button that could
        // not do the thing it said. Pressing a segment is a statement about
        // which side you want, exactly as it is when the dot is out, so the
        // dot goes out and the pane opens to the end.
        if (pressingActiveSegment(id, blocksBothRef.current) === 'close-split') {
          setBoth(false)
          setApplyNonce((n) => n + 1)
          return
        }
        // Re-clicking the active workspace tab exits focus mode (a way back to
        // the normal layout without switching away).
        setFocusState((f) => {
          if (f) setApplyNonce((n) => n + 1)
          return false
        })
        return
      }
      // The target keeps its OWN remembered panel state — a plain switch never
      // opens a panel the user didn't ask for. Only a lesson-driven switch
      // (`carryLesson`) carries an open Learn/Help panel across (#…).
      s.workspaces[id] = resolveSwitchTarget(s.workspaces[s.active], s.workspaces[id], opts)
      s.active = id
      setActive(id)
      // Pressing Blocks or Code is a statement about which side you want, so the
      // dot goes out (#1053) — leaving it lit would make the switcher describe
      // something that is not on screen.
      setBoth(false)
      setWorkspace(s.workspaces[id])
      setFocusState(false) // leaving focus mode when the workspace changes
      setApplyNonce((n) => n + 1)
      persist()
    },
    [persist, setBoth]
  )

  const resetActive = useCallback((): void => {
    const s = stateRef.current as LayoutState
    const preset = WORKSPACE_PRESETS[s.active]
    s.workspaces[s.active] = {
      ...preset,
      horizontal: [...preset.horizontal],
      vertical: [...preset.vertical]
    }
    setWorkspace(s.workspaces[s.active])
    setApplyNonce((n) => n + 1)
    persist()
  }, [persist])

  const setActivityView = useCallback(
    (view: ActivityView): void => patchActive({ activityView: view }),
    [patchActive]
  )
  const setCollapsed = useCallback(
    (panel: 'files' | 'centre' | 'shell' | 'right', collapsed: boolean): void =>
      patchActive(
        panel === 'files'
          ? { filesCollapsed: collapsed }
          : panel === 'centre'
            ? { centreCollapsed: collapsed }
            : panel === 'shell'
              ? { shellCollapsed: collapsed }
              : { rightCollapsed: collapsed }
      ),
    [patchActive]
  )
  const setDockOpen = useCallback(
    (open: boolean): void => patchActive({ dockOpen: open }),
    [patchActive]
  )

  // TRANSIENT focus mode (not persisted): the Robot pop-out hides the board,
  // instruments + console so the URDF fills the editor, without changing the
  // workspace. Bumps applyNonce so the shell re-collapses/expands + the board
  // pane elides; switching workspace clears it (below).
  /**
   * The dot (#1053). Turning it ON also makes sure we are somewhere that shows a
   * canvas, because it is reachable from the Code side too.
   *
   * `switchWorkspace` clears the dot (a plain switch is a statement about which
   * side you want), so the order matters: switch first, then light it.
   */
  const setBlocksBoth = useCallback(
    (next: boolean): void => {
      if (!next) {
        setBoth(false)
        return
      }
      if (stateRef.current?.active !== 'blocks') switchWorkspace('blocks')
      const state = stateRef.current as LayoutState
      const remembered = state.workspaces[state.active].blocksSplit
      // THE REMEMBERED RATIO CAN BE AN END STOP, and then the dot does nothing
      // visible. Blocks is canvas-only now (#1053), so `recordSizes` stores
      // [97, 3] the moment it is shown — and the split would "restore" to that,
      // which is the canvas again.
      //
      // Only an END is overridden. A learner who dragged the divider to 65/35
      // meant it, and pressing the dot should take them back to THEIR middle,
      // not to ours.
      if (ratioShowsOnePane(remembered)) {
        state.workspaces[state.active].blocksSplit = [...BLOCKS_VIEW_RATIOS.split]
        persist()
      }
      setBoth(true)
      setApplyNonce((n) => n + 1)
    },
    [switchWorkspace, persist, setBoth]
  )

  const setFocus = useCallback((next: boolean): void => {
    setFocusState((cur) => {
      if (cur === next) return cur
      setApplyNonce((n) => n + 1)
      return next
    })
  }, [])

  // Punt a board swap to the Electronics view (for its confirm dialog) + go there.
  const requestBoardSwap = useCallback(
    (id: string): void => {
      setPendingBoardSwap(id)
      switchWorkspace('board')
    },
    [switchWorkspace]
  )
  const clearBoardSwap = useCallback((): void => setPendingBoardSwap(null), [])

  const store = useMemo<LayoutStore>(
    () => ({
      active,
      workspace,
      applyNonce,
      focus,
      blocksBoth,
      getSizes,
      setBlocksSplit,
      setBlocksBoth,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
      setFocus,
      recordSizes,
      pendingBoardSwap,
      requestBoardSwap,
      clearBoardSwap
    }),
    [
      active,
      workspace,
      applyNonce,
      focus,
      blocksBoth,
      getSizes,
      setBlocksSplit,
      setBlocksBoth,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
      setFocus,
      recordSizes,
      pendingBoardSwap,
      requestBoardSwap,
      clearBoardSwap
    ]
  )

  return createElement(LayoutContext.Provider, { value: store }, children)
}

/** Access the workspace-layout store. Must be used within <LayoutProvider>. */
export function useWorkspaceLayout(): LayoutStore {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error('useWorkspaceLayout must be used within a LayoutProvider')
  return ctx
}
