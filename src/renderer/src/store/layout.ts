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

/** The named workspaces (Phase 1; slimmed 4 → 3 by the modes review). Order =
 *  the switcher's display order. Old `lab`/`data` envelopes migrate to
 *  `datalab` in {@link loadLayoutState}. */
export const WORKSPACE_IDS = ['code', 'board', 'datalab', 'robot'] as const
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

/** Display labels + a one-line description for the switcher tooltips. */
export const WORKSPACE_INFO: Record<WorkspaceId, { label: string; hint: string }> = {
  code: { label: 'Code', hint: 'Editor-first: files, editor and console' },
  board: { label: 'Board', hint: 'Focused Board View beside your code' },
  datalab: { label: 'Data Lab', hint: 'Instrument bench + a tall console/plotter' },
  robot: { label: 'Robot', hint: 'Code · board · a 3D robot over the instruments' }
}

/** One workspace's remembered geometry. */
export interface WorkspaceLayout {
  /** Active left-sidebar view (activity bar). */
  activityView: ActivityView
  filesCollapsed: boolean
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
}

/** The persisted envelope. Bump `version` on breaking shape changes. */
export interface LayoutState {
  version: 1
  active: WorkspaceId
  workspaces: Record<WorkspaceId, WorkspaceLayout>
}

/** Where the envelope persists. (One key; see #228 for the registry idea.) */
export const LAYOUT_STORAGE_KEY = 'snakie.layout.workspaces'

/** The curated presets — each workspace's factory geometry (Phase 1). */
export const WORKSPACE_PRESETS: Record<WorkspaceId, WorkspaceLayout> = {
  // Today's default layout, unchanged: files open, editor + console, no dock.
  code: {
    activityView: 'files',
    filesCollapsed: false,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: false,
    boardPaneOpen: false,
    horizontal: [18, 82, 0, 0],
    vertical: [70, 30]
  },
  // Board-first (the education tri-split): CODE on the left, the EMBEDDED
  // Board View (breadboard/schematic/node graph) on the right, and the
  // instrument dock at the far right — code, wiring and live instruments all
  // visible at once. Console stays under the code.
  board: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    // Instruments HIDDEN by default in Board mode — the board is the star, so it
    // gets the room (Data Lab opens the dock, Code keeps it closed).
    dockOpen: false,
    boardPaneOpen: true,
    horizontal: [0, 42, 58, 0],
    vertical: [65, 35]
  },
  // Data Lab (the old Lab + Data merged): the instrument bench — dock open —
  // with a tall shell region (Console | Plotter | Problems) for data work.
  datalab: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: true,
    boardPaneOpen: false,
    horizontal: [0, 100, 0, 0],
    vertical: [50, 50]
  },
  // Robot (#320): the robotics cockpit — files collapsed, CODE ~⅓ on the left,
  // the Board View (breadboard) in the middle, and the dock on the right (which
  // in this mode carries a mini 3-D Robot panel above the instruments).
  robot: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: true,
    boardPaneOpen: true,
    horizontal: [0, 34, 66, 0],
    vertical: [65, 35]
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
  'help',
  'report-bug'
]

/** Validate one workspace's shape, falling back to `preset` field-by-field. */
function sanitiseWorkspace(raw: unknown, preset: WorkspaceLayout): WorkspaceLayout {
  const r = (raw ?? {}) as Record<string, unknown>
  const ws: WorkspaceLayout = {
    activityView: VIEWS.includes(r.activityView as ActivityView)
      ? (r.activityView as ActivityView)
      : preset.activityView,
    filesCollapsed: typeof r.filesCollapsed === 'boolean' ? r.filesCollapsed : preset.filesCollapsed,
    shellCollapsed: typeof r.shellCollapsed === 'boolean' ? r.shellCollapsed : preset.shellCollapsed,
    rightCollapsed: typeof r.rightCollapsed === 'boolean' ? r.rightCollapsed : preset.rightCollapsed,
    dockOpen: typeof r.dockOpen === 'boolean' ? r.dockOpen : preset.dockOpen,
    boardPaneOpen:
      typeof r.boardPaneOpen === 'boolean' ? r.boardPaneOpen : preset.boardPaneOpen,
    horizontal: validSizes(r.horizontal, 4)
      ? (r.horizontal as [number, number, number, number])
      : [...preset.horizontal],
    vertical: validSizes(r.vertical, 2) ? (r.vertical as [number, number]) : [...preset.vertical]
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
  return [
    sizes[0],
    sizes[1],
    boardOn ? sizes[2] : 0,
    chatOn ? sizes[boardOn ? 3 : 2] : 0
  ]
}

/** A fresh factory-default state (every workspace at its preset). */
export function defaultLayoutState(): LayoutState {
  const workspaces = {} as Record<WorkspaceId, WorkspaceLayout>
  for (const id of WORKSPACE_IDS) {
    workspaces[id] = {
      ...WORKSPACE_PRESETS[id],
      horizontal: [...WORKSPACE_PRESETS[id].horizontal],
      vertical: [...WORKSPACE_PRESETS[id].vertical]
    }
  }
  return { version: 1, active: 'code', workspaces }
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
      if (parsed && parsed.version === 1 && parsed.workspaces) {
        const state = defaultLayoutState()
        // Modes review: the old `lab` and `data` workspaces merged into
        // `datalab`. Map a stale active id, and seed datalab's geometry from
        // the old data (preferred — it's the closer layout) else lab entry, so
        // an existing user's sizes carry over.
        const saved = parsed.workspaces as Record<string, unknown>
        const activeRaw = ['lab', 'data'].includes(parsed.active as string)
          ? 'datalab'
          : (parsed.active as WorkspaceId)
        state.active = WORKSPACE_IDS.includes(activeRaw) ? activeRaw : 'code'
        for (const id of WORKSPACE_IDS) {
          const legacy = id === 'datalab' ? (saved.datalab ?? saved.data ?? saved.lab) : saved[id]
          state.workspaces[id] = sanitiseWorkspace(legacy, WORKSPACE_PRESETS[id])
        }
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
  return state
}

// ---------------------------------------------------------------------------
// The store (context + provider)
// ---------------------------------------------------------------------------

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
  /** Latest sizes for a group (live ref-backed; safe to call every render). */
  getSizes: (group: 'horizontal' | 'vertical') => number[]
  switchWorkspace: (id: WorkspaceId) => void
  /** Restore the ACTIVE workspace to its factory preset. */
  resetActive: () => void
  setActivityView: (view: ActivityView) => void
  setCollapsed: (panel: 'files' | 'shell' | 'right', collapsed: boolean) => void
  setDockOpen: (open: boolean) => void
  /** Enter/leave transient editor-focus mode. */
  setFocus: (focus: boolean) => void
  /** Record a live panel-group layout (called from onLayout every drag frame). */
  recordSizes: (group: 'horizontal' | 'vertical', sizes: number[]) => void
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

  const getSizes = useCallback((group: 'horizontal' | 'vertical'): number[] => {
    const s = stateRef.current as LayoutState
    return [...s.workspaces[s.active][group]]
  }, [])

  const recordSizes = useCallback(
    (group: 'horizontal' | 'vertical', sizes: number[]): void => {
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
      } else {
        return
      }
      // Sizes deliberately DON'T touch React state (per-frame drags); persist only.
      persist()
    },
    [persist, chatPane]
  )

  const switchWorkspace = useCallback(
    (id: WorkspaceId): void => {
      const s = stateRef.current as LayoutState
      if (s.active === id) {
        // Re-clicking the active workspace tab exits focus mode (a way back to
        // the normal layout without switching away).
        setFocusState((f) => {
          if (f) setApplyNonce((n) => n + 1)
          return false
        })
        return
      }
      s.active = id
      setActive(id)
      setWorkspace(s.workspaces[id])
      setFocusState(false) // leaving focus mode when the workspace changes
      setApplyNonce((n) => n + 1)
      persist()
    },
    [persist]
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
    (panel: 'files' | 'shell' | 'right', collapsed: boolean): void =>
      patchActive(
        panel === 'files'
          ? { filesCollapsed: collapsed }
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
  const setFocus = useCallback((next: boolean): void => {
    setFocusState((cur) => {
      if (cur === next) return cur
      setApplyNonce((n) => n + 1)
      return next
    })
  }, [])

  const store = useMemo<LayoutStore>(
    () => ({
      active,
      workspace,
      applyNonce,
      focus,
      getSizes,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
      setFocus,
      recordSizes
    }),
    [
      active,
      workspace,
      applyNonce,
      focus,
      getSizes,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
      setFocus,
      recordSizes
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
