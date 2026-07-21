import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle
} from 'react-resizable-panels'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { appliedHorizontal, useWorkspaceLayout, type WorkspaceId } from '../store/layout'

// The embedded Board View pane (the Board workspace's tri-split, #259) is
// code-split: the whole board subsystem (BoardGraph + wiring + Part Editor)
// loads only when a workspace with the pane open is activated.
const BoardPane = lazy(() => import('./BoardPane'))
// The mini 3-D Robot panel (Robot mode, #320) — lazy so three.js only loads
// when you enter Robot mode.
const RobotDockPanel = lazy(() => import('./RobotDockPanel'))
import { MiniViewer } from './MiniViewer'
import { useTheme } from '../hooks/useTheme'
import { Toolbar } from './Toolbar'
import { ActivityBar, ActivityView, DESKTOP_ONLY_VIEWS } from './ActivityBar'
import { BugReportPanel } from './BugReportPanel'
import { PanelHeader } from './PanelHeader'
import { FilePanel } from './FilePanel'
import { GitPanel } from './GitPanel'
import { PackagesPanel } from './PackagesPanel'
import { PluginsPanel } from './PluginsPanel'
import { InspectPanel } from './InspectPanel'
import { HelpPanel } from './HelpPanel'
import { EditorArea } from './EditorArea'
import {
  InstrumentDockRegion,
  InstrumentFloatLayer,
  normaliseVisibility,
  useInstruments,
  type InstrumentVisibility,
  type OpenInstrument
} from './InstrumentHost'
import { defaultVisibility, deriveInUse, moduleCoveredByInstrument } from './instruments-registry'
import { type UsedPins } from './parse-pins'
import { runFindCommand } from './findController'
import { ShellPanel } from './ShellPanel'
import { RightPanel } from './RightPanel'
import { IS_WEB } from '../lib/env'
import { StatusBar } from './StatusBar'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { OPEN_SETTINGS_EVENT } from './settingsBus'
import { HELP_EVENT, type HelpEventDetail } from './editorBridge'
import { InstrumentLibBanner } from './InstrumentLibBanner'
import { PartsImportBanner } from './PartsImportBanner'
import { isElectron } from '../lib/platform'
import { TutorialPanel } from './TutorialPanel'
import {
  requiredPartModules,
  missingImports as computeMissingImports,
  missingOnBoard as computeMissingOnBoard,
  parsePyImports,
  type RequiredModule
} from './part-imports'
import { installPartDriver } from './driver-install'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useSkeletonSync } from '../hooks/useSkeletonSync'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  SNAKIE_LIB_PATH,
  SNAKIE_ROOT_PATH,
  classifyPresentCopy,
  parseLibVersion,
  shouldShowBanner,
  type InstallState
} from '../lib/instrumentsLib'
import { useWorkspace } from '../store/workspace'
import { useEditorSettings } from '../store/settings'
import './AppShell.css'

/**
 * Wrap a panel that lacks its own region chrome in a scrollable region.
 *
 * The label bar (`PanelHeader`) is opt-out: the activity bar already names the
 * active view, so redundant title bars are dropped for most views (issue #79)
 * by passing `showHeader={false}`. Views that still want a label (e.g. Help)
 * leave the default on.
 */
function LeftRegion({
  title,
  showHeader = true,
  children
}: {
  title: string
  showHeader?: boolean
  children: JSX.Element
}): JSX.Element {
  return (
    <section className="region" aria-label={title}>
      {showHeader && <PanelHeader title={title} />}
      <div className="region__body">{children}</div>
    </section>
  )
}

/**
 * Map each activity-bar view id to the component shown in the left sidebar.
 * FilePanel and InspectPanel bring their own region; the others are wrapped
 * here so every view gets a consistent scrollable container (previously
 * provided by the right-pane tab host). The redundant title bars are omitted
 * per issue #79 — the activity bar already labels the active view — except for
 * Help, which keeps its label.
 */
function LeftView({
  view,
  helpTarget
}: {
  view: ActivityView
  helpTarget?: { id: string; nonce: number }
}): JSX.Element {
  // Guard against a persisted `activityView` (from a previous Electron
  // session) pointing at a desktop-only view in a browser tab — the
  // ActivityBar already hides these, but a stale localStorage value could
  // still select one directly (Web W3, issue #284).
  if (DESKTOP_ONLY_VIEWS.has(view) && !isElectron()) {
    const title = view === 'source-control' ? 'Source Control' : 'Plugins'
    return (
      <LeftRegion title={title}>
        <p className="region__empty">
          {title} needs a real filesystem and local processes (git / the Python
          plugin host), so it&apos;s only available in the Snakie desktop app.
        </p>
      </LeftRegion>
    )
  }
  switch (view) {
    case 'source-control':
      return (
        <LeftRegion title="Source Control" showHeader={false}>
          <GitPanel />
        </LeftRegion>
      )
    case 'packages':
      return (
        <LeftRegion title="Packages" showHeader={false}>
          <PackagesPanel />
        </LeftRegion>
      )
    case 'plugins':
      return (
        <LeftRegion title="Plugins" showHeader={false}>
          <PluginsPanel />
        </LeftRegion>
      )
    case 'inspect':
      return <InspectPanel />
    case 'report-bug':
      // A NON-modal left panel (#206) so the editor + console stay usable while
      // the user copies error output into the report.
      return (
        <LeftRegion title="Report Bug">
          <BugReportPanel />
        </LeftRegion>
      )
    case 'learn':
      // The Learn panel (tutorials, #479) brings its own gallery/course header,
      // so drop the region title bar.
      return (
        <LeftRegion title="Learn" showHeader={false}>
          <TutorialPanel />
        </LeftRegion>
      )
    case 'help':
      // The Help Library brings its own brass header plate, so drop the region
      // title bar.
      return (
        <LeftRegion title="Help" showHeader={false}>
          <HelpPanel target={helpTarget} />
        </LeftRegion>
      )
    case 'files':
    default:
      return <FilePanel />
  }
}

/**
 * AppShell — the structural base layout that every later feature plugs into.
 *
 * Regions:
 *   - Top toolbar (Run/Stop placeholders, connection status, theme toggle)
 *   - Left sidebar: FilePanel (collapsible)
 *   - Center: EditorArea + bottom ShellPanel (shell open by default)
 *   - Right pane: RightPanel (collapsed by default)
 *
 * Panel sizes are persisted by react-resizable-panels' `autoSaveId`
 * (localStorage). Collapsed flags are persisted separately so the toolbar
 * toggles and resize handles stay in sync across restarts.
 */
export function AppShell(): JSX.Element {
  const { theme, setTheme } = useTheme()
  // Breadboard background choice (#…) — streamed to the Board View window alongside
  // the theme so its wiring canvas repaints live when the setting changes.
  const { breadboardBg } = useEditorSettings()

  // The active file feeds the floating Board View window. Reading it here lets
  // us stream every edit / theme change to that window over IPC so it updates
  // live. `boardOpened` tracks whether the window has been opened this session
  // (so we only stream while it's open); it resets when the user closes it.
  const { openFiles, activeId, currentFolder } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const [boardOpened, setBoardOpened] = useState(false)

  // skeleton.json autogen (#537): regenerate from the URDF on every save, and
  // check the board's copy for staleness at connect time.
  useSkeletonSync(currentFolder)

  const boardSource = activeFile?.content ?? ''
  const boardFileName = activeFile?.name
  const boardIsPython = !!activeFile && /\.py$/i.test(activeFile.name)
  // The open project folder, streamed to the board window so its Wiring mode can
  // read/write robot.yml next to the user's code.
  const boardFolder = currentFolder ?? undefined

  // Board pop-out plumbing (modes review) — declared BEFORE the open handlers so
  // they can consult/flip these synchronously. The `.current` values are kept
  // fresh in the workspace-layout block further down (after `layout` exists).
  const poppedFromBoardRef = useRef(false)
  const switchWorkspaceRef = useRef<(id: WorkspaceId) => void>(() => undefined)
  const activeWsRef = useRef<WorkspaceId>('code')

  // Toggle the floating Board View window from the toolbar button: open (and
  // push the current file immediately so it isn't blank) if closed, or close it
  // if it's already open. `onClosed` resets `boardOpened` either way.
  // (The toolbar's pop-out board knob was removed (#…) now that the Board View is
  // the Electronics workspace; the board window can still open via other paths —
  // e.g. the web build — so the streaming/close subscriptions below stay.)

  // While the window is open, stream the active file / content / theme to it on
  // every change so it stays live.
  useEffect(() => {
    if (!boardOpened) return
    window.api.board.update({
      source: boardSource,
      fileName: boardFileName,
      isPython: boardIsPython,
      theme,
      breadboardBg,
      folder: boardFolder
    })
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme, breadboardBg, boardFolder])

  // Reset the "opened" flag when the user closes the board window.
  useEffect(() => {
    const off = window.api.board.onClosed(() => setBoardOpened(false))
    return off
  }, [])

  // Mark the board opened whenever the window opens via ANY path — notably the
  // mini board panel's open button, which calls board.open() directly. Flipping
  // `boardOpened` true triggers the streaming effect above to relay the active
  // file, so the full viewer isn't left blank ("Open a Python file…").
  // Pop-out (modes review): if the window opens while Board MODE is active, the
  // board moved homes — hand it to the window and return the main split to Code
  // IN THE SAME HANDLER (the two state updates batch into one commit, so the
  // "close the window when Board mode is picked while it's open" effect below
  // never sees a half-switched state and can't mistake a pop-out for a re-dock).
  useEffect(() => {
    const off = window.api.board.onOpened(() => {
      setBoardOpened(true)
      if (activeWsRef.current === 'board') {
        poppedFromBoardRef.current = true
        switchWorkspaceRef.current('code')
      }
    })
    return off
  }, [])

  // --- Workspace layout (epic #259, Phases 0+1) ------------------------------
  // ALL layout geometry (collapse flags, dock visibility, activity view, panel
  // sizes) lives in the layout store, grouped into named workspaces. This
  // component owns the IMPERATIVE side only: panel handles + applying a
  // workspace's geometry when it becomes active (nothing remounts — the editor,
  // xterm scrollback and instruments survive every switch).
  const layout = useWorkspaceLayout()
  const { shellCollapsed, rightCollapsed, activityView, boardPaneOpen } = layout.workspace
  // Build (#…): the centre column hosts the full-screen URDF/3-D editor instead of
  // the code editor + console — no code, no board view.
  const robotMain = layout.active === 'robot'
  // The instrument dock (mini-viewer peek + instruments + reopen rail) belongs to
  // the CODE workspace only. Electronics fills the area with the Board View and
  // Build with the URDF editor — both are self-contained, so neither shows the
  // dock or the mini Board/3-D viewer.
  const dockWorkspace = layout.active === 'code'
  // Electronics + Build are "solo" workspaces: a single main surface (the Board
  // View / the URDF 3-D editor) fills the area with NO code editor, console or
  // instrument dock — a dedicated non-RRP layout, so a persisted flag can never
  // resurface the code panels. Only Code uses the resizable panel group.
  const soloWorkspace = robotMain || layout.active === 'board'
  // A solo workspace hides the sidebar by default. ONLY a lesson (the Learn
  // tutorials or the Help library) shows there — carried in from another workspace
  // or opened from the activity bar — so a stale `filesCollapsed:false` for the
  // plain Files view can't resurface a file tree in Electronics/Build.
  const isLessonView = activityView === 'learn' || activityView === 'help'
  const soloLessonOpen = soloWorkspace && isLessonView && !layout.workspace.filesCollapsed
  const dockOpen = layout.workspace.dockOpen
  // Transient editor focus (Robot pop-out): hide the board, instruments + console
  // around the URDF without touching the workspace (#320 follow-up).
  const focus = layout.focus
  // Build (robot) is the full-screen URDF editor ONLY — it structurally never
  // shows the board pane, whatever a persisted `boardPaneOpen` says (belt-and-
  // braces over the v2 layout migration).
  const boardPaneVisible = boardPaneOpen && !focus && !robotMain

  const filesRef = useRef<ImperativePanelHandle>(null)
  const centreRef = useRef<ImperativePanelHandle>(null)
  const shellRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const hGroupRef = useRef<ImperativePanelGroupHandle>(null)
  const vGroupRef = useRef<ImperativePanelGroupHandle>(null)

  // Mount-time size snapshot for the panels' defaultSize (imperative setLayout
  // drives every later change, so this is only the first paint).
  const initialSizes = useRef<{ h: number[]; v: number[] } | null>(null)
  if (initialSizes.current === null) {
    initialSizes.current = { h: layout.getSizes('horizontal'), v: layout.getSizes('vertical') }
  }

  // Collapse/expand a panel; the Panel's own onCollapse/onExpand callbacks sync
  // the store flag, so this stays the single imperative entry point. Read the
  // ACTUAL panel state (not the store flag), so a transient desync — e.g. after
  // a workspace switch or a drag-collapse — can never leave the toggle stuck
  // calling collapse() on an already-collapsed panel (the "won't reopen" bug).
  const toggle = useCallback((ref: React.RefObject<ImperativePanelHandle>): void => {
    const panel = ref.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  // Ensure a panel is open (no-op when already expanded).
  const openPanel = useCallback((ref: React.RefObject<ImperativePanelHandle>): void => {
    const panel = ref.current
    if (panel && panel.isCollapsed()) panel.expand()
  }, [])

  // A panel toggle (or activity click) while in focus mode simply LEAVES focus,
  // restoring the full Robot layout, rather than fighting the focus overrides.
  const exitFocus = useCallback((): boolean => {
    if (layout.focus) {
      layout.setFocus(false)
      return true
    }
    return false
  }, [layout])

  // Apply a workspace's geometry to the panel groups: setLayout drives the sizes;
  // the explicit collapse()/expand() calls are belt-and-braces so a collapsible
  // panel lands collapsed even if the group clamps a 0 size. Reads the LIVE store
  // each call so re-applies (below) always use current state.
  const applyWorkspaceGeometry = useCallback((): void => {
    const ws = layout.workspace
    const rMain = layout.active === 'robot'
    // The horizontal group's setLayout array must match the RENDERED panels: the
    // board slot elides when the pane is closed (or in Build), and the chat slot
    // doesn't exist on web (#528) — a stray extra size makes RRP throw.
    const boardOn = ws.boardPaneOpen && !focus && !rMain
    hGroupRef.current?.setLayout(appliedHorizontal(ws.horizontal, boardOn, !IS_WEB))
    vGroupRef.current?.setLayout([...ws.vertical])
    // Then sync each collapsible panel's collapsed state (belt-and-braces over the
    // sizes, so a panel lands collapsed even if the group clamped a 0 size). Order
    // matters: sizes first, collapse/expand second — reversing it leaves Electronics'
    // centre column at a 50/50 split instead of collapsed.
    const sync = (ref: React.RefObject<ImperativePanelHandle>, collapsed: boolean): void => {
      const panel = ref.current
      if (!panel) return
      if (collapsed) panel.collapse()
      else panel.expand()
    }
    sync(filesRef, ws.filesCollapsed)
    // Electronics collapses the centre column (code + console) so the Board View
    // fills the main area; the editor stays mounted behind the 0-width panel.
    sync(centreRef, ws.centreCollapsed)
    sync(shellRef, focus || ws.shellCollapsed)
    sync(rightRef, ws.rightCollapsed)
  }, [layout.workspace, layout.active, focus])
  const applyGeomRef = useRef(applyWorkspaceGeometry)
  applyGeomRef.current = applyWorkspaceGeometry

  // Apply the active workspace's geometry whenever it changes (switch / reset).
  // Deferred one frame: switching INTO Electronics mounts the board Panel in this
  // same commit, and a setLayout before the group registers it is ignored (the
  // "board pane opens tiny" bug). A second pass the next frame re-asserts after the
  // content settles. (Build uses its own NON-RRP layout, so it isn't affected.)
  useEffect(() => {
    if (layout.applyNonce === 0) return // initial mount already used defaultSize
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      applyGeomRef.current()
      raf2 = requestAnimationFrame(() => applyGeomRef.current())
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyNonce IS the signal
  }, [layout.applyNonce])

  // --- Instruments hosted in the MAIN window (#101 / #102 / #103) ------------
  // The Oscilloscope + Multimeter + Plotter now live in a dedicated DOCK REGION
  // (the rightmost panel, to the RIGHT of the chat panel) while *undocked*
  // scope/meter windows float over the WHOLE window from an app-root layer. The
  // board-view window's node launchers fire a cross-window `instruments.open(...)`
  // request (relayed by the main process); we receive it here, add the
  // instrument, and reveal the dock.
  //
  // All the instrument state is lifted here (single source of truth) because the
  // toolbar (count), the dock region, AND the app-root float layer all read it:
  //   - `openInstruments` — the open scope/meter list.
  //   - `visibility` — the SCOPE/METER/PLOT dock-header visibility flags (all on
  //     by default); orthogonal to each instrument's docked state.
  //   - the dock panel collapse (the toolbar Instruments button toggles it).
  const [openInstruments, setOpenInstruments] = useState<OpenInstrument[]>([])

  // Which instruments the ACTIVE FILE declares in-use (peripheral types from
  // `parse-pins` + cheap driver/import hints, #119). Drives the prominent
  // markers in the dock header AND the default-visible singletons below, so a
  // file using an OLED lights the I²C-display instrument without the user
  // hunting for it. Recomputed only when the source/python-ness changes.
  const inUse = useMemo(
    () => deriveInUse(boardSource, boardIsPython),
    [boardSource, boardIsPython]
  )

  // SCOPE/METER start hidden (nothing is open until you summon one — so the dock
  // button isn't lit with no instrument behind it); both open paths (the dock
  // button and the board-view node launcher) turn the kind ON when they open one.
  // Singletons default per the in-use rule (in-use ⇒ visible, plus the always-on
  // Plotter so the dock is never empty); the rest stay discoverable via the
  // palette. Persisted across restarts, MIGRATED from the old {scope,meter,
  // plotter} shape via `normaliseVisibility` so a stored value never wipes the
  // new ids.
  const [visibilityRaw, setVisibilityRaw] = useLocalStorage<Partial<InstrumentVisibility>>(
    'snakie.instruments.visibility',
    {}
  )
  // The in-use-derived defaults are only consulted for ids the user hasn't
  // explicitly toggled (no persisted boolean). Memoised on the first in-use set
  // so a later edit doesn't yank a singleton the user has open out from under
  // them; the in-use markers in the header always reflect the LIVE `inUse`.
  const initialDefaultsRef = useRef<Record<string, boolean> | null>(null)
  if (initialDefaultsRef.current === null) {
    initialDefaultsRef.current = defaultVisibility(inUse)
  }
  const visibility = useMemo(
    () => normaliseVisibility(visibilityRaw, initialDefaultsRef.current as Record<string, boolean>),
    [visibilityRaw]
  )
  const setVisibility = setVisibilityRaw as (v: InstrumentVisibility) => void

  // Set one kind's dock visibility directly (used by the close→hide flow and the
  // open→reveal flow below). `useLocalStorage`'s setter takes a value (not a
  // functional updater — it JSON-serialises whatever it gets), so we spread the
  // current `visibility` from the closure.
  const setKindVisible = useCallback(
    (kind: string, value: boolean): void => {
      if (visibility[kind] === value) return
      setVisibility({ ...visibility, [kind]: value })
    },
    [visibility, setVisibility]
  )
  // Closing (✕) a scope/meter HIDES its kind (and re-docks the instrument, in
  // useInstruments) — routed into the host so close can set both pieces of state.
  const hideKind = useCallback(
    (kind: 'scope' | 'meter'): void => setKindVisible(kind, false),
    [setKindVisible]
  )

  // The GLOBAL instrument live-poll switch. DEFAULT OFF: opening a scope/meter no
  // longer auto-polls the board (which entered the raw REPL and interrupted a
  // running program every ~800ms). One switch for all instruments because the
  // poll is a single batched probe shared across every open scope/meter (a
  // per-instrument toggle would mislead). Persisted so it survives a restart, but
  // starts off for a fresh user.
  const [instrumentsLive, setInstrumentsLive] = useLocalStorage('snakie.instruments.live', false)
  const toggleInstrumentsLive = useCallback(
    (): void => setInstrumentsLive(!instrumentsLive),
    [instrumentsLive, setInstrumentsLive]
  )
  const stopInstrumentsLive = useCallback((): void => setInstrumentsLive(false), [setInstrumentsLive])

  const instruments = useInstruments({
    source: boardSource,
    isPython: boardIsPython,
    instruments: openInstruments,
    onChange: setOpenInstruments,
    live: instrumentsLive,
    onToggleLive: toggleInstrumentsLive,
    onHideKind: hideKind
  })

  // The PWM/ADC pins declared in the active file — so the dock's SCOPE/METER
  // buttons can summon an instrument directly (without going through the
  // Toggle one instrument's dock-header visibility (keyed by registry id, #119).
  //  - SCOPE/METER (per-pin): if NOTHING of this kind is open yet, the click
  //    SUMMONS one (the first matching PWM/ADC pin in the active file) and shows
  //    it docked — the in-window twin of the board-view node launchers. Turning a
  //    kind back ON also RE-DOCKS every instrument of that kind (via the host) so
  //    a previously-undocked/closed one reappears DOCKED.
  //  - Every singleton (Plotter + the #110–#121 placeholders): a show/hide flip,
  //    and — like the kinds above — RE-DOCK it when turning it back ON, so a
  //    singleton that was undocked into its own OS window (#205) returns to the
  //    dock instead of reappearing windowed (or vanishing).
  // Defined after the host so it can call `redockKind` / `redockByKey`.
  const { redockKind, redockByKey } = instruments
  const toggleVisible = useCallback(
    (id: string): void => {
      if (id === 'scope' || id === 'meter') {
        const kind = id
        // Toggle the scope/meter like a singleton. It can be opened with NO
        // PWM/ADC pin at all — the dock renders it from the file's PWM/ADC conns
        // when present, else a placeholder that shows the requirement help (see
        // InstrumentDockRegion). No `openInstruments` injection needed.
        const next = !visibility[id]
        setVisibility({ ...visibility, [id]: next })
        if (next) redockKind(kind)
        return
      }
      // A singleton (Plotter or a placeholder): show/hide flip; re-dock on show.
      const next = !visibility[id]
      setVisibility({ ...visibility, [id]: next })
      if (next) redockByKey(`singleton:${id}`)
    },
    [visibility, setVisibility, redockKind, redockByKey]
  )

  // The instrument dock is its OWN fixed-width region to the right of the panel
  // group — NOT a `Panel` in the group — so its show/hide is fully independent of
  // the chat panel (two collapsible panels in one PanelGroup redistribute each
  // other's freed space, which made toggling one reveal the other). Its flag is
  // part of the workspace layout (the Board/Data Lab workspaces open it).
  const setDockOpen = layout.setDockOpen
  const instrumentsVisible = dockOpen && !focus

  // --- Board pop-out (modes review): the floating window and the Board MODE are
  // the same board in two homes, never both. Mirrors instrument undocking:
  //  - opening the window while Board mode is active (the toolbar knob, or the
  //    mini board's open button) POPS the board out → main window returns to Code
  //    (the switch happens inside the open handlers themselves — see toggleBoard
  //    and the board.onOpened subscription — so it batches with the open);
  //  - closing the window returns the board to being a mode (switch back);
  //  - picking the Board mode while the window is open re-docks (closes) it.
  switchWorkspaceRef.current = layout.switchWorkspace
  activeWsRef.current = layout.active
  useEffect(() => {
    const off = window.api.board.onClosed(() => {
      if (poppedFromBoardRef.current) {
        poppedFromBoardRef.current = false
        switchWorkspaceRef.current('board')
      }
    })
    return off
  }, [])
  useEffect(() => {
    if (layout.active === 'board' && boardOpened) {
      poppedFromBoardRef.current = false
      window.api.board.close()
    }
  }, [layout.active, boardOpened])

  // --- Offer to install the instrument library (#108) ------------------------
  // When the dock opens AND a board is connected, we check (once per connection)
  // whether the board already has `instruments.py` (#107). If not, a manila
  // banner at the top of the app offers a one-click install of `/lib/instruments.py`.
  //
  //  - `libState` is the per-connection install cache ('unknown' until probed,
  //    'present'/'absent' after). It RESETS to 'unknown' on every connection
  //    change (disconnect/reconnect), so a fresh board is re-probed.
  //  - `libDismissed` hides the banner this open-session; it resets to false when
  //    the dock CLOSES, so reopening the dock shows it again (per the issue).
  //  - `libInstalling` / `libError` drive the busy + error states on the banner.
  //
  // The detect + install run over the raw REPL (device.stat / mkdir / writeFile),
  // which momentarily interrupts a running program — so the probe is one-off
  // (gated on the dock opening, cached) and the install is user-initiated.
  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const [libState, setLibState] = useState<InstallState>('unknown')
  const [libDismissed, setLibDismissed] = useState(false)
  const [libInstalling, setLibInstalling] = useState(false)
  const [libError, setLibError] = useState<string | null>(null)

  // Reset the per-connection cache whenever the connection state flips, so a
  // newly connected (or reconnected) board is re-probed and a disconnect clears
  // any stale 'absent'/'present' result.
  useEffect(() => {
    setLibState('unknown')
  }, [deviceStatus.state, deviceStatus.path])

  // Reset the dismissal when the board (re)connects, so a fresh connection
  // re-offers the update even after a previous dismissal.
  useEffect(() => {
    setLibDismissed(false)
    setLibError(null)
  }, [deviceStatus.state, deviceStatus.path])

  // One-off probe: as soon as a board is connected (NOT gated on the dock — the
  // library backs any `import instruments` program), stat the two candidate paths.
  // A resolved stat ⇒ found; a rejected stat (OSError on a missing path) ⇒ treat
  // as not-found for that path. Tolerant of any error → 'absent' (offer install).
  useEffect(() => {
    if (!connected || libState !== 'unknown') return
    let active = true
    const probe = (path: string): Promise<boolean> =>
      window.api.device
        .stat(path)
        .then(() => true)
        .catch(() => false)
    void (async (): Promise<void> => {
      const [libFound, rootFound] = await Promise.all([
        probe(INSTRUMENTS_LIB_PATH),
        probe(INSTRUMENTS_ROOT_PATH)
      ])
      if (!active) return
      if (!libFound && !rootFound) {
        setLibState('absent')
        return
      }
      // Present — compare the installed version against the bundled one to decide
      // present vs OUTDATED. A legacy copy with no `__version__` parses to null →
      // differs from the bundled version → 'outdated'.
      //
      // PREFER the ROOT copy when present: `''` (cwd `/`) sits BEFORE `/lib` on
      // MicroPython's sys.path, so `/instruments.py` SHADOWS `/lib` — it's the
      // copy actually imported, so its freshness is what matters (otherwise a
      // current /lib masks a stale root copy and we'd never offer the update).
      const path = rootFound ? INSTRUMENTS_ROOT_PATH : INSTRUMENTS_LIB_PATH
      const [boardSrc, bundledSrc] = await Promise.all([
        window.api.device.readFile(path).catch(() => null),
        window.api.instruments.librarySource().catch(() => null)
      ])
      if (!active) return
      const state = classifyPresentCopy(boardSrc, bundledSrc)
      if (state === null) {
        // Couldn't read our OWN bundled library (empty/unreadable source), so we
        // can neither compare versions nor install. DON'T silently settle on
        // 'present' — that hid a genuinely out-of-date board. Warn (so it's
        // visible in devtools / the dev terminal, alongside the main-process path
        // log) and leave libState 'unknown' so re-opening the dock or reconnecting
        // the board RETRIES instead of sticking on a wrong result.
        console.warn(
          '[instruments] could not read the bundled library to compare versions — leaving the board unchanged; re-open the dock or reconnect to retry'
        )
        return
      }
      // Always log the outcome so a mis-detected banner is diagnosable at a glance.
      console.info('[instruments] library version check', {
        path,
        boardVersion: parseLibVersion(boardSrc),
        bundledVersion: parseLibVersion(bundledSrc),
        state
      })
      setLibState(state)
    })()
    return () => {
      active = false
    }
  }, [connected, libState])

  // Install action: read the bundled source, ensure /lib exists (tolerate
  // "already exists"), write /lib/instruments.py, then mark present (hiding the
  // banner). Surfaces a brief error on failure; never crashes.
  const installInstrumentsLib = useCallback((): void => {
    if (libInstalling) return
    setLibInstalling(true)
    setLibError(null)
    void (async (): Promise<void> => {
      try {
        const source = await window.api.instruments.librarySource()
        if (!source) throw new Error('library source unavailable')
        await window.api.device.mkdir(INSTRUMENTS_LIB_DIR).catch(() => undefined)
        await window.api.device.writeFile(INSTRUMENTS_LIB_PATH, source)
        // A legacy copy at the FS root (`/instruments.py`) shadows `/lib` on
        // MicroPython's sys.path, so updating only `/lib` would leave the OLD
        // root copy being imported. If one is there, overwrite it with the same
        // new source so `import instruments` gets the current code wherever it
        // resolves from.
        const rootShadow = await window.api.device
          .stat(INSTRUMENTS_ROOT_PATH)
          .then(() => true)
          .catch(() => false)
        if (rootShadow) {
          await window.api.device.writeFile(INSTRUMENTS_ROOT_PATH, source)
        }
        // Install the `snakie.py` hardware umbrella beside it (best-effort — an
        // older bundle without it just skips this), so `from snakie import Servo`
        // works and a vendor `servo` module can't shadow ours.
        const umbrella = await window.api.instruments.umbrellaSource().catch(() => '')
        if (umbrella) {
          await window.api.device.writeFile(SNAKIE_LIB_PATH, umbrella)
          if (rootShadow) await window.api.device.writeFile(SNAKIE_ROOT_PATH, umbrella)
        }
        setLibState('present')
        // The device's files changed — tell every window so e.g. the Device
        // Files tree re-lists and shows the fresh /lib/instruments.py.
        window.api.modules.notifyChanged()
      } catch (err) {
        setLibError(err instanceof Error ? err.message : String(err))
      } finally {
        setLibInstalling(false)
      }
    })()
  }, [libInstalling])

  const dismissLibBanner = useCallback((): void => setLibDismissed(true), [])

  const showLibBanner = shouldShowBanner({
    connected,
    installState: libState,
    dismissed: libDismissed
  })

  // --- Parts import check (#166) ---------------------------------------------
  // The project's placed parts may link MicroPython libraries. When the board
  // connects or a .py file opens, flag any required module the file doesn't import
  // and/or the board doesn't have installed, and offer to install the missing ones.
  const [requiredModules, setRequiredModules] = useState<RequiredModule[]>([])
  // Bumped when the Board View window saves robot.yml (adds/removes a part), so
  // the required-modules load below re-runs and the parts banner reflects it.
  const [robotNonce, setRobotNonce] = useState(0)
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
  // Belt-and-braces reconcile: parts are usually added/removed in the SEPARATE
  // Board View window, so the user's next move is to click back to THIS window. Re-
  // read robot.yml whenever the main window regains focus/visibility, so the parts
  // banner always reflects the current build even if the live robot:didChange push
  // was missed while this window was backgrounded.
  useEffect(() => {
    const bump = (): void => setRobotNonce((n) => n + 1)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') bump()
    }
    window.addEventListener('focus', bump)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', bump)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  const [installedModules, setInstalledModules] = useState<Set<string> | null>(null)
  const [partsDismissed, setPartsDismissed] = useState(false)
  const [partsInstalling, setPartsInstalling] = useState(false)
  const [partsInstallError, setPartsInstallError] = useState<string | null>(null)

  // Load the required modules from the project's robot.yml + installed libraries.
  // Refreshed on connect / file-open / folder change AND when the Board View saves
  // the robot (robotNonce) — so removing a part clears its import nag.
  useEffect(() => {
    let active = true
    void (async (): Promise<void> => {
      try {
        const [robotDef, libs] = await Promise.all([
          window.api.robot.load(boardFolder),
          window.api.parts.listLibraries()
        ])
        if (active) setRequiredModules(requiredPartModules(robotDef, libs))
      } catch {
        if (active) setRequiredModules([])
      }
    })()
    return () => {
      active = false
    }
  }, [boardFolder, boardFileName, connected, robotNonce])

  // Modules WE successfully installed onto this board (ground truth for this
  // connection): a re-probe that races a running program / busy REPL can read
  // nothing back — it must never resurrect the "Install servo" button for a
  // driver we just copied. Merged into every probe result below.
  const selfInstalledRef = useRef<Set<string>>(new Set())
  // Probe the board (once per connection, and again on a project change) for which
  // required modules import. Including boardFolder avoids a stale probe set when you
  // switch projects while staying connected (modules change but the cache wouldn't).
  useEffect(() => {
    selfInstalledRef.current = new Set()
    setInstalledModules(null)
  }, [deviceStatus.state, deviceStatus.path, boardFolder])
  // Re-probe when ANY window installs a driver/library (e.g. the Board View's
  // Driver Install banner copies a file to the board), so the "missing library"
  // banner clears once the module is actually present — not only after the main
  // window's own install.
  useEffect(() => window.api.modules.onChanged(() => setInstalledModules(null)), [])
  useEffect(() => {
    if (!connected || requiredModules.length === 0 || installedModules !== null) return
    let active = true
    void (async (): Promise<void> => {
      const present = await window.api.modules.probeInstalled(requiredModules.map((m) => m.module))
      if (active) setInstalledModules(new Set([...present, ...selfInstalledRef.current]))
    })()
    return () => {
      active = false
    }
  }, [connected, requiredModules, installedModules])

  // Re-surface the banner when the file or connection changes (per-trigger dismiss).
  useEffect(() => {
    setPartsDismissed(false)
    setPartsInstallError(null)
  }, [boardFileName, deviceStatus.state, deviceStatus.path])

  // A part driven through its INSTRUMENT (e.g. servo_showcase.py uses the Servo
  // instrument via `inst.start(servo_pin=…)`) needs neither its driver imported
  // NOR the driver file on the board — so drop such modules from both nags when a
  // matching instrument is in use.
  const missImports = useMemo(
    () =>
      (boardIsPython ? computeMissingImports(requiredModules, boardSource) : []).filter(
        (m) => !moduleCoveredByInstrument(m.module, inUse)
      ),
    [boardIsPython, requiredModules, boardSource, inUse]
  )
  const missBoard = useMemo(() => {
    // Instrument coverage only excuses a module the file DOESN'T import: a
    // direct `import bme280` will fail on a board without the driver, however
    // in-use its instrument looks (the instrument hints match the very same
    // module name the import mentions), so that nag — and its one-click
    // install — must stand.
    const imported = boardIsPython ? parsePyImports(boardSource) : new Set<string>()
    return (installedModules ? computeMissingOnBoard(requiredModules, installedModules) : []).filter(
      (m) => imported.has(m.module) || !moduleCoveredByInstrument(m.module, inUse)
    )
  }, [installedModules, requiredModules, inUse, boardIsPython, boardSource])
  const showPartsBanner =
    requiredModules.length > 0 && !partsDismissed && (missImports.length > 0 || missBoard.length > 0)

  const installMissingLibs = useCallback((): void => {
    // Installable = the module ships bundled driver file(s) (copied straight to
    // the board — the SG90/BME280/ICM20948 model) or declares a mip source URL.
    const targets = missBoard.filter((m) => (m.drivers?.length ?? 0) > 0 || m.url)
    if (partsInstalling || targets.length === 0) return
    setPartsInstalling(true)
    setPartsInstallError(null)
    void (async (): Promise<void> => {
      try {
        for (const t of targets) {
          if (t.drivers && t.drivers.length > 0 && t.libraryId && t.partId) {
            for (const d of t.drivers) {
              const res = await installPartDriver(t.libraryId, t.partId, d)
              if (!res.ok) throw new Error(res.message || `Failed to install ${t.module}`)
            }
          } else {
            const res = await window.api.packages.install(t.url as string)
            if (!res.ok) throw new Error(res.log || `Failed to install ${t.module}`)
          }
        }
        // The installs SUCCEEDED — that's ground truth, so mark those modules
        // present directly and the banner clears at once. (A `null` reset +
        // re-probe here could race a running program / busy REPL, read garbage,
        // and leave the "Install servo" button stuck on screen.) The ref keeps
        // them present across any later re-probe this connection.
        for (const t of targets) selfInstalledRef.current.add(t.module)
        setInstalledModules(
          (prev) => new Set([...(prev ?? []), ...targets.map((t) => t.module)])
        )
        // Tell the OTHER windows too (the Board View's driver banner re-probes,
        // the device file tree re-lists).
        window.api.modules.notifyChanged()
      } catch (err) {
        setPartsInstallError(err instanceof Error ? err.message : String(err))
      } finally {
        setPartsInstalling(false)
      }
    })()
  }, [missBoard, partsInstalling])

  // Opening an instrument must RELIABLY reveal it docked. We carry the FULL
  // parsed connection (`conn`) from the board node in the payload, so the
  // instrument is SELF-CONTAINED — it renders from `conn` regardless of the main
  // editor's active file (the fix for the scope/meter never reaching the dock).
  // Three things have to line up, so we route them through a ref the
  // once-registered IPC listener reads live (no stale closure): (1) add it to
  // `openInstruments` (deduped by kind+conn.variable; default `docked` is true →
  // it resolves into the DOCK, not the float layer); (2) re-dock it + turn its
  // KIND's visibility back ON, so an instrument that was floated/closed (hidden)
  // earlier comes back docked + visible; (3) expand the dock panel if collapsed
  // so the 404px window actually has room.
  const revealForOpen = useCallback(
    (kind: 'scope' | 'meter', conn: UsedPins): void => {
      setOpenInstruments((cur) =>
        cur.some((it) => it.kind === kind && it.conn.variable === conn.variable)
          ? cur
          : [...cur, { kind, conn }]
      )
      setKindVisible(kind, true)
      redockKind(kind)
      setDockOpen(true) // reveal the dock region
    },
    [setKindVisible, redockKind, setDockOpen]
  )
  const revealForOpenRef = useRef(revealForOpen)
  revealForOpenRef.current = revealForOpen

  useEffect(() => {
    // Registered once; the handler delegates to the live ref so it never goes
    // stale across re-renders (the dock reveal can't race the open). The relayed
    // payload's `conn` is the preload's structural `InstrumentConn`; it's the
    // same shape as `UsedPins` (the renderer's `PinType` union narrows `type`),
    // so we cast at the IPC boundary.
    const off = window.api.instruments.onOpen((payload) => {
      revealForOpenRef.current(payload.kind, payload.conn as UsedPins)
    })
    return off
  }, [])

  // Drive the Find & Replace window (issue #146): it has no editor access, so it
  // relays find/replace commands here; we run them against the live Monaco editor
  // (`findController`) and push the match status back to the window.
  useEffect(() => {
    const off = window.api.find.onCommand((cmd) => {
      const status = runFindCommand(cmd as Parameters<typeof runFindCommand>[0])
      window.api.find.sendStatus(status)
    })
    return off
  }, [])

  // Which view the left sidebar shows, driven by the ActivityBar — remembered
  // per workspace (part of the layout store).
  const setActivityView = layout.setActivityView

  // Settings dialog (issues #80/#81, tabbed in #83/#84) — opened from the
  // toolbar gear (Editor tab) or the chat's ⚙ (Chat tab, via settingsBus).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('editor')

  const openSettings = useCallback((tab: SettingsTab): void => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  // Let any component (e.g. the chat panel) deep-link a settings tab via a
  // window event, so we don't have to thread a callback through the tree.
  useEffect(() => {
    const handler = (e: Event): void => {
      const tab = (e as CustomEvent<SettingsTab>).detail ?? 'editor'
      openSettings(tab)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, handler)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler)
  }, [openSettings])

  // An instrument's `?` (or any deep link) reveals the Help view + opens an
  // article. `nonce` bumps so re-clicking the same instrument re-opens it.
  const [helpTarget, setHelpTarget] = useState<{ id: string; nonce: number } | undefined>(undefined)
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<HelpEventDetail>).detail
      if (!detail?.articleId) return
      setActivityView('help')
      // Reveal the left sidebar if it's collapsed — otherwise switching to the
      // help view has no visible effect (e.g. Board mode collapses the sidebar,
      // so the Board's Help button appeared to do nothing). expand() is
      // idempotent, so this is a no-op when the sidebar is already open.
      filesRef.current?.expand()
      setHelpTarget((prev) => ({ id: detail.articleId, nonce: (prev?.nonce ?? 0) + 1 }))
    }
    window.addEventListener(HELP_EVENT, handler)
    return () => window.removeEventListener(HELP_EVENT, handler)
  }, [setActivityView])

  // The Parts Library + Part Editor live in the Board Viewer window now (it's the
  // only place that uses parts), so the main window no longer hosts them.

  return (
    <div className="shell">
      {/* Top-of-screen manila notification offering a one-click install of the
          instrument library onto the connected board (#108). Topmost element of
          `.shell` (a column flex) so it reads as a full-width banner above the
          toolbar; shown whenever a board is connected and its library is missing
          or out of date (not tied to the dock), unless dismissed this connection. */}
      {/* Persistent live region so a banner is ANNOUNCED when it appears: the
          container stays mounted (empty when no banner is shown), so screen
          readers pick up the injected banner text (a11y, #188). */}
      <div aria-live="polite">
        {showLibBanner && (
          <InstrumentLibBanner
            installing={libInstalling}
            error={libError}
            outdated={libState === 'outdated'}
            onInstall={installInstrumentsLib}
            onDismiss={dismissLibBanner}
          />
        )}
        {/* #166: the project's parts need libraries this file doesn't import / the
            board doesn't have — offer to install the missing ones. */}
        {showPartsBanner && (
          <PartsImportBanner
            missingImports={missImports}
            missingOnBoard={missBoard}
            installing={partsInstalling}
            error={partsInstallError}
            onInstall={installMissingLibs}
            onDismiss={() => setPartsDismissed(true)}
          />
        )}
      </div>
      <Toolbar />

      <div className="shell__body shell__main">
        <ActivityBar
          active={activityView}
          onOpenSettings={() => openSettings('appearance')}
          onSelect={(view) => {
            // In focus mode, any activity click just restores the Robot layout.
            if (exitFocus()) {
              setActivityView(view)
              return
            }
            // Solo workspaces (Electronics/Build) have no RRP files panel — only a
            // lesson (Learn/Help) opens a sidebar there, driven by the store flag.
            if (soloWorkspace) {
              const lessonView = view === 'learn' || view === 'help'
              if (!lessonView) {
                // Files/Packages/etc. have no panel in a solo workspace — remember
                // the choice but keep the sidebar hidden.
                setActivityView(view)
                layout.setCollapsed('files', true)
              } else if (view === activityView && soloLessonOpen) {
                layout.setCollapsed('files', true) // toggle the open lesson closed
              } else {
                setActivityView(view)
                layout.setCollapsed('files', false) // open the lesson
              }
              return
            }
            // Clicking the already-active view toggles the left panel collapse
            // (issue #86): collapse it when open, re-expand it when collapsed.
            if (view === activityView) {
              toggle(filesRef)
              return
            }
            // Switching to a different view selects it and reveals the sidebar
            // if it was collapsed.
            setActivityView(view)
            openPanel(filesRef)
          }}
        />
        {/* Electronics + Build (#…) get a dedicated, NON-RRP layout: a single main
            surface (the Board View / the URDF 3-D pose editor) fills the whole area
            — no code editor, console or instrument dock. A tutorial/help lesson
            carried in from another workspace shows in a left panel beside it;
            otherwise there's no sidebar. Keeping these out of the resizable panel
            group makes the code panels structurally absent (no persisted flag can
            resurface them) and avoids RRP collapse races. */}
        {soloWorkspace ? (
          <div className="shell__solo">
            {soloLessonOpen && (
              <aside className="shell__solo-lesson" aria-label="Lesson">
                <LeftView view={activityView} helpTarget={helpTarget} />
              </aside>
            )}
            {robotMain ? (
              <div className="shell__robot-main">
                <Suspense fallback={<div className="shell__robot3d-loading">Loading 3D…</div>}>
                  <RobotDockPanel full />
                </Suspense>
              </div>
            ) : (
              <div className="shell__solo-board">
                <Suspense
                  fallback={
                    <div className="board-pane__loading" role="status">
                      Loading Board View…
                    </div>
                  }
                >
                  <BoardPane />
                </Suspense>
              </div>
            )}
          </div>
        ) : (
        /* Sizes are recorded into the ACTIVE workspace via onLayout and applied
            imperatively on workspace switch (setLayout) — the library's own
            autoSaveId persistence is replaced by the layout store (#259). */
        <PanelGroup
          direction="horizontal"
          ref={hGroupRef}
          onLayout={(sizes) => layout.recordSizes('horizontal', sizes)}
          className="shell__panels"
        >
          <Panel
            ref={filesRef}
            order={1}
            collapsible
            collapsedSize={0}
            defaultSize={initialSizes.current.h[0]}
            minSize={30}
            onCollapse={() => layout.setCollapsed('files', true)}
            onExpand={() => layout.setCollapsed('files', false)}
          >
            <LeftView view={activityView} helpTarget={helpTarget} />
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel
            ref={centreRef}
            order={2}
            collapsible
            collapsedSize={0}
            defaultSize={initialSizes.current.h[1]}
            minSize={30}
            onCollapse={() => layout.setCollapsed('centre', true)}
            onExpand={() => layout.setCollapsed('centre', false)}
          >
            <div className="shell__center-col">
              <PanelGroup
                direction="vertical"
                ref={vGroupRef}
                className="shell__vgroup"
                onLayout={(sizes) => layout.recordSizes('vertical', sizes)}
              >
                <Panel order={1} minSize={20}>
                  <div className="shell__editor-region">
                    <EditorArea />
                  </div>
                </Panel>

                <PanelResizeHandle className="resize-handle resize-handle--horizontal" />

                <Panel
                  ref={shellRef}
                  order={2}
                  collapsible
                  collapsedSize={0}
                  defaultSize={initialSizes.current.v[1]}
                  minSize={12}
                  onCollapse={() => layout.setCollapsed('shell', true)}
                  onExpand={() => layout.setCollapsed('shell', false)}
                >
                  <ShellPanel
                    chatOpen={!rightCollapsed}
                    onToggleChat={IS_WEB ? undefined : () => toggle(rightRef)}
                    onCollapse={() => {
                      if (!exitFocus()) toggle(shellRef)
                    }}
                  />
                </Panel>
              </PanelGroup>
              {/* Reopen rail (#592): when the console is collapsed to nothing, a
                  slim clickable bar is its own reopen affordance (the global
                  toolbar toggle is gone). */}
              {shellCollapsed && !focus && (
                <button
                  type="button"
                  className="shell__reopen shell__reopen--bottom"
                  onClick={() => openPanel(shellRef)}
                  title="Show the console"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path
                      d="M4 6l4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Console</span>
                </button>
              )}
            </div>
          </Panel>

          {/* The embedded Board View (the Board workspace's tri-split, #259):
              code on the left, the board here, the instrument dock at the far
              right — code, wiring and instruments visible together. */}
          {boardPaneVisible && (
            <>
              <PanelResizeHandle className="resize-handle resize-handle--vertical" />
              {/* defaultSize = the ACTIVE workspace's board share (not the mount-time
                  snapshot): the pane mounts when switching into Board, and the deferred
                  setLayout can lose a race — this keeps the fallback correct too. */}
              <Panel order={3} minSize={25} defaultSize={layout.workspace.horizontal[2] || 40}>
                <Suspense
                  fallback={
                    <div className="board-pane__loading" role="status">
                      Loading Board View…
                    </div>
                  }
                >
                  <BoardPane />
                </Suspense>
              </Panel>
            </>
          )}

          {/* The Chat right-pane is desktop-only — hidden on the web build. */}
          {!IS_WEB && (
            <>
              <PanelResizeHandle className="resize-handle resize-handle--vertical" />

              <Panel
                ref={rightRef}
                order={4}
                collapsible
                collapsedSize={0}
                defaultSize={initialSizes.current.h[3]}
                minSize={14}
                onCollapse={() => layout.setCollapsed('right', true)}
                onExpand={() => layout.setCollapsed('right', false)}
              >
                <RightPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
        )}

        {/* The INSTRUMENT DOCK lives OUTSIDE the PanelGroup — a fixed-width region
            to the right of the chat. Kept out of the group so toggling it (or the
            chat) never resizes the other (two collapsible panels in one group
            redistribute each other's freed space). Shown by the toolbar
            Instruments button or an incoming `instruments:open`. */}
        {instrumentsVisible && dockWorkspace && (
          <aside
            className="shell__dock shell__dock--mini"
            aria-label="Instrument dock"
          >
            {/* Per-panel collapse (#592) — the dock hides itself; the toolbar
                Instruments toggle is gone, so the reopen rail below takes over. */}
            <button
              type="button"
              className="shell__dock-collapse"
              onClick={() => setDockOpen(false)}
              title="Hide the instrument dock"
              aria-label="Hide the instrument dock"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M6 4l4 4-4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {/* Dock-top slot (#595): the Code workspace gets the MiniViewer card —
                a Board/3D peek that expands to the matching workspace. (Electronics
                and Build are self-contained — the Board View / URDF editor fill the
                area — so the whole dock is gated to Code above.) */}
            <div className="shell__miniviewer">
              <MiniViewer source={boardSource} isPython={boardIsPython} />
            </div>
            <InstrumentDockRegion
              host={instruments}
              vis={visibility}
              inUse={inUse}
              onToggleVisible={toggleVisible}
              hideMiniBoard
            />
          </aside>
        )}
        {/* Reopen rail (#592): when the dock is hidden, a slim clickable rail at
            the far right is its own reopen affordance. Code only — Electronics and
            Build have no instrument dock (the Board View / URDF editor fill the area). */}
        {!dockOpen && !focus && dockWorkspace && (
          <button
            type="button"
            className="shell__dock-rail"
            onClick={() => setDockOpen(true)}
            title="Show the instrument dock"
            aria-label="Show the instrument dock"
          >
            <span className="shell__dock-rail-label">Instruments</span>
          </button>
        )}
      </div>

      <StatusBar
        instrumentsLive={instrumentsLive}
        instrumentCount={openInstruments.length}
        onStopLive={stopInstrumentsLive}
      />

      {/* App-root float layer: undocked scope/meter windows float over the WHOLE
          window (above the panels, below modals). Click-through layer. */}
      <InstrumentFloatLayer
        host={instruments}
        vis={visibility}
        visible={instrumentsVisible}
        onToggleVisible={toggleVisible}
      />

      {settingsOpen && (
        <SettingsDialog
          initialTab={settingsTab}
          theme={theme}
          setTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}

    </div>
  )
}
