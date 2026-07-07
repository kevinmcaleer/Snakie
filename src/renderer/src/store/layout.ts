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

/** The named workspaces (Phase 1). Order = the switcher's display order. */
export const WORKSPACE_IDS = ['code', 'board', 'lab', 'data'] as const
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

/** Display labels + a one-line description for the switcher tooltips. */
export const WORKSPACE_INFO: Record<WorkspaceId, { label: string; hint: string }> = {
  code: { label: 'Code', hint: 'Editor-first: files, editor and console' },
  board: { label: 'Board', hint: 'Board-first: mini board + instruments beside the code' },
  lab: { label: 'Lab', hint: 'Instrument bench: big dock, editor and console' },
  data: { label: 'Data', hint: 'Data-first: large console/plotter under the editor' }
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
  /** react-resizable-panels layouts: horizontal = [files, centre, chat]. */
  horizontal: [number, number, number]
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
    horizontal: [18, 82, 0],
    vertical: [70, 30]
  },
  // Board-first: the dock (mini board view + instruments) open, sidebar tucked
  // away, console under the code. (The FULL Board View embed is its own work
  // item — see epic #259; the in-bundle mini board leads the dock meanwhile.)
  board: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: true,
    horizontal: [0, 100, 0],
    vertical: [65, 35]
  },
  // Instrument bench: maximum dock, slim console for the REPL.
  lab: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: true,
    horizontal: [0, 100, 0],
    vertical: [75, 25]
  },
  // Data-first: a tall shell region (Console | Plotter | Problems) + the dock
  // for the Plotter/logger instruments.
  data: {
    activityView: 'files',
    filesCollapsed: true,
    shellCollapsed: false,
    rightCollapsed: true,
    dockOpen: true,
    horizontal: [0, 100, 0],
    vertical: [45, 55]
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
  return {
    activityView: VIEWS.includes(r.activityView as ActivityView)
      ? (r.activityView as ActivityView)
      : preset.activityView,
    filesCollapsed: typeof r.filesCollapsed === 'boolean' ? r.filesCollapsed : preset.filesCollapsed,
    shellCollapsed: typeof r.shellCollapsed === 'boolean' ? r.shellCollapsed : preset.shellCollapsed,
    rightCollapsed: typeof r.rightCollapsed === 'boolean' ? r.rightCollapsed : preset.rightCollapsed,
    dockOpen: typeof r.dockOpen === 'boolean' ? r.dockOpen : preset.dockOpen,
    horizontal: validSizes(r.horizontal, 3)
      ? (r.horizontal as [number, number, number])
      : [...preset.horizontal],
    vertical: validSizes(r.vertical, 2) ? (r.vertical as [number, number]) : [...preset.vertical]
  }
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
        state.active = WORKSPACE_IDS.includes(parsed.active as WorkspaceId)
          ? (parsed.active as WorkspaceId)
          : 'code'
        for (const id of WORKSPACE_IDS) {
          state.workspaces[id] = sanitiseWorkspace(parsed.workspaces[id], WORKSPACE_PRESETS[id])
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
    const h = legacyPanelSizes(storage, 'snakie.layout.horizontal', 3)
    const v = legacyPanelSizes(storage, 'snakie.layout.vertical', 2)
    if (h) code.horizontal = h as [number, number, number]
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
  /** Latest sizes for a group (live ref-backed; safe to call every render). */
  getSizes: (group: 'horizontal' | 'vertical') => number[]
  switchWorkspace: (id: WorkspaceId) => void
  /** Restore the ACTIVE workspace to its factory preset. */
  resetActive: () => void
  setActivityView: (view: ActivityView) => void
  setCollapsed: (panel: 'files' | 'shell' | 'right', collapsed: boolean) => void
  setDockOpen: (open: boolean) => void
  /** Record a live panel-group layout (called from onLayout every drag frame). */
  recordSizes: (group: 'horizontal' | 'vertical', sizes: number[]) => void
}

const LayoutContext = createContext<LayoutStore | null>(null)

/** Debounce for localStorage writes while dragging (ms). */
const SAVE_DEBOUNCE_MS = 300

export function LayoutProvider({ children }: { children: ReactNode }): JSX.Element {
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
      if (group === 'horizontal' && validSizes(sizes, 3)) {
        ws.horizontal = sizes as [number, number, number]
      } else if (group === 'vertical' && validSizes(sizes, 2)) {
        ws.vertical = sizes as [number, number]
      } else {
        return
      }
      // Sizes deliberately DON'T touch React state (per-frame drags); persist only.
      persist()
    },
    [persist]
  )

  const switchWorkspace = useCallback(
    (id: WorkspaceId): void => {
      const s = stateRef.current as LayoutState
      if (s.active === id) return
      s.active = id
      setActive(id)
      setWorkspace(s.workspaces[id])
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

  const store = useMemo<LayoutStore>(
    () => ({
      active,
      workspace,
      applyNonce,
      getSizes,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
      recordSizes
    }),
    [
      active,
      workspace,
      applyNonce,
      getSizes,
      switchWorkspace,
      resetActive,
      setActivityView,
      setCollapsed,
      setDockOpen,
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
