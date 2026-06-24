import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTheme } from '../hooks/useTheme'
import { Toolbar } from './Toolbar'
import { ActivityBar, ActivityView } from './ActivityBar'
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
import { defaultVisibility, deriveInUse } from './instruments-registry'
import { parsePins, type UsedPins } from './parse-pins'
import { ShellPanel } from './ShellPanel'
import { RightPanel } from './RightPanel'
import { StatusBar } from './StatusBar'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { OPEN_SETTINGS_EVENT } from './settingsBus'
import { InstrumentLibBanner } from './InstrumentLibBanner'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  installStateFromVersions,
  parseLibVersion,
  shouldShowBanner,
  type InstallState
} from '../lib/instrumentsLib'
import { useWorkspace } from '../store/workspace'

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
function LeftView({ view }: { view: ActivityView }): JSX.Element {
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
    case 'help':
      return (
        <LeftRegion title="Help">
          <HelpPanel />
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
  const { theme, toggleTheme } = useTheme()

  // The active file feeds the floating Board View window. Reading it here lets
  // us stream every edit / theme change to that window over IPC so it updates
  // live. `boardOpened` tracks whether the window has been opened this session
  // (so we only stream while it's open); it resets when the user closes it.
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const [boardOpened, setBoardOpened] = useState(false)

  const boardSource = activeFile?.content ?? ''
  const boardFileName = activeFile?.name
  const boardIsPython = !!activeFile && /\.py$/i.test(activeFile.name)

  // Toggle the floating Board View window from the toolbar button: open (and
  // push the current file immediately so it isn't blank) if closed, or close it
  // if it's already open. `onClosed` resets `boardOpened` either way.
  const toggleBoard = useCallback((): void => {
    if (boardOpened) {
      window.api.board.close()
      return
    }
    setBoardOpened(true)
    window.api.board
      .open()
      .then(() =>
        window.api.board.update({
          source: boardSource,
          fileName: boardFileName,
          isPython: boardIsPython,
          theme
        })
      )
      .catch(() => undefined)
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme])

  // While the window is open, stream the active file / content / theme to it on
  // every change so it stays live.
  useEffect(() => {
    if (!boardOpened) return
    window.api.board.update({
      source: boardSource,
      fileName: boardFileName,
      isPython: boardIsPython,
      theme
    })
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme])

  // Reset the "opened" flag when the user closes the board window.
  useEffect(() => {
    const off = window.api.board.onClosed(() => setBoardOpened(false))
    return off
  }, [])

  // Panel handles + the shared collapse toggle (Files / Shell / Chat / dock).
  // Defined here (above the instrument wiring) so the toolbar Instruments button
  // can reuse the same `toggle` helper to expand/collapse the dock region.
  const filesRef = useRef<ImperativePanelHandle>(null)
  const shellRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)

  const toggle = useCallback(
    (
      ref: React.RefObject<ImperativePanelHandle>,
      collapsed: boolean,
      setCollapsed: (v: boolean) => void
    ): void => {
      const panel = ref.current
      if (!panel) return
      if (collapsed) panel.expand()
      else panel.collapse()
      setCollapsed(!collapsed)
    },
    []
  )

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
  // board-view window's node launchers).
  const fileConns = useMemo(
    () => (boardIsPython ? parsePins(boardSource) : []),
    [boardSource, boardIsPython]
  )

  // Toggle one instrument's dock-header visibility (keyed by registry id, #119).
  //  - SCOPE/METER (per-pin): if NOTHING of this kind is open yet, the click
  //    SUMMONS one (the first matching PWM/ADC pin in the active file) and shows
  //    it docked — the in-window twin of the board-view node launchers. Turning a
  //    kind back ON also RE-DOCKS every instrument of that kind (via the host) so
  //    a previously-undocked/closed one reappears DOCKED.
  //  - Every singleton (Plotter + the #110–#121 placeholders): a plain show/hide
  //    flip of its boolean — visibility ONLY, never touches docked state.
  // Defined after the host so it can call `redockKind`.
  const { redockKind } = instruments
  const toggleVisible = useCallback(
    (id: string): void => {
      if (id === 'scope' || id === 'meter') {
        const kind = id
        const hasOpen = openInstruments.some((it) => it.kind === kind)
        if (!hasOpen) {
          const wantType = kind === 'scope' ? 'pwm' : 'adc'
          const conn = fileConns.find((c) => c.type === wantType)
          if (conn) {
            setOpenInstruments((cur) =>
              cur.some((it) => it.kind === kind && it.conn.variable === conn.variable)
                ? cur
                : [...cur, { kind, conn }]
            )
            setKindVisible(kind, true)
            redockKind(kind)
          }
          return
        }
        const next = !visibility[id]
        setVisibility({ ...visibility, [id]: next })
        if (next) redockKind(kind)
        return
      }
      // A singleton (Plotter or a placeholder): plain show/hide flip.
      setVisibility({ ...visibility, [id]: !visibility[id] })
    },
    [visibility, setVisibility, setKindVisible, redockKind, openInstruments, fileConns]
  )

  // Persisted collapsed state. Shell is open by default (core REPL tool); the
  // right pane + the instrument dock are collapsed by default to keep things
  // uncluttered (the dock reveals on toggle or when an instrument opens).
  const [filesCollapsed, setFilesCollapsed] = useLocalStorage('snakie.collapsed.files', false)
  const [shellCollapsed, setShellCollapsed] = useLocalStorage('snakie.collapsed.shell', false)
  const [rightCollapsed, setRightCollapsed] = useLocalStorage('snakie.collapsed.right', true)
  // The instrument dock is its OWN fixed-width region to the right of the panel
  // group — NOT a `Panel` in the group — so its show/hide is fully independent of
  // the chat panel (two collapsible panels in one PanelGroup redistribute each
  // other's freed space, which made toggling one reveal the other). Plain boolean.
  const [dockOpen, setDockOpen] = useLocalStorage('snakie.instruments.dockOpen', false)
  const instrumentsVisible = dockOpen
  const toggleInstruments = useCallback((): void => {
    setDockOpen(!dockOpen)
  }, [dockOpen, setDockOpen])

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

  // Reset the per-open-session dismissal when the dock CLOSES, so closing then
  // reopening the instrument panel surfaces the banner again (per the issue).
  useEffect(() => {
    if (!dockOpen) {
      setLibDismissed(false)
      setLibError(null)
    }
  }, [dockOpen])

  // One-off probe: when the dock is open + connected + not yet probed, stat the
  // two candidate paths on the board. A resolved stat ⇒ found; a rejected stat
  // (OSError on a missing path) ⇒ treat as not-found for that path. Tolerant of
  // any error → 'absent' (offer the install) rather than throwing.
  useEffect(() => {
    if (!dockOpen || !connected || libState !== 'unknown') return
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
      // present vs OUTDATED. Read both sources; any read failure → stay 'present'
      // (never nag on a transient error). A legacy copy with no `__version__`
      // parses to null → differs from the bundled version → 'outdated'.
      const path = libFound ? INSTRUMENTS_LIB_PATH : INSTRUMENTS_ROOT_PATH
      const [boardSrc, bundledSrc] = await Promise.all([
        window.api.device.readFile(path).catch(() => null),
        window.api.instruments.librarySource().catch(() => null)
      ])
      if (!active) return
      if (boardSrc == null || bundledSrc == null) {
        setLibState('present')
        return
      }
      setLibState(
        installStateFromVersions(true, parseLibVersion(boardSrc), parseLibVersion(bundledSrc))
      )
    })()
    return () => {
      active = false
    }
  }, [dockOpen, connected, libState])

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
        setLibState('present')
      } catch (err) {
        setLibError(err instanceof Error ? err.message : String(err))
      } finally {
        setLibInstalling(false)
      }
    })()
  }, [libInstalling])

  const dismissLibBanner = useCallback((): void => setLibDismissed(true), [])

  const showLibBanner = shouldShowBanner({
    dockOpen,
    connected,
    installState: libState,
    dismissed: libDismissed
  })

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

  // Which view the left sidebar shows, driven by the ActivityBar.
  const [activityView, setActivityView] = useLocalStorage<ActivityView>(
    'snakie.activityView',
    'files'
  )

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

  return (
    <div className="shell">
      {/* Top-of-screen manila notification offering a one-click install of the
          instrument library onto the connected board (#108). Topmost element of
          `.shell` (a column flex) so it reads as a full-width banner above the
          toolbar; shown only when the dock is open, a board is connected, the
          library isn't installed, and it hasn't been dismissed this session. */}
      {showLibBanner && (
        <InstrumentLibBanner
          installing={libInstalling}
          error={libError}
          outdated={libState === 'outdated'}
          onInstall={installInstrumentsLib}
          onDismiss={dismissLibBanner}
        />
      )}
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        filesCollapsed={filesCollapsed}
        onToggleFiles={() => toggle(filesRef, filesCollapsed, setFilesCollapsed)}
        shellCollapsed={shellCollapsed}
        onToggleShell={() => toggle(shellRef, shellCollapsed, setShellCollapsed)}
        rightCollapsed={rightCollapsed}
        onToggleRight={() => toggle(rightRef, rightCollapsed, setRightCollapsed)}
        onOpenSettings={() => openSettings('editor')}
        onOpenBoard={toggleBoard}
        onToggleInstruments={toggleInstruments}
        instrumentsVisible={instrumentsVisible}
        instrumentCount={openInstruments.length}
      />

      <div className="shell__body shell__main">
        <ActivityBar
          active={activityView}
          onSelect={(view) => {
            // Clicking the already-active view toggles the left panel collapse
            // (issue #86): collapse it when open, re-expand it when collapsed.
            if (view === activityView) {
              toggle(filesRef, filesCollapsed, setFilesCollapsed)
              return
            }
            // Switching to a different view selects it and reveals the sidebar
            // if it was collapsed.
            setActivityView(view)
            if (filesCollapsed) toggle(filesRef, true, setFilesCollapsed)
          }}
        />
        <PanelGroup
          direction="horizontal"
          autoSaveId="snakie.layout.horizontal"
          className="shell__panels"
        >
          <Panel
            ref={filesRef}
            order={1}
            collapsible
            collapsedSize={0}
            defaultSize={filesCollapsed ? 0 : 18}
            minSize={12}
            onCollapse={() => setFilesCollapsed(true)}
            onExpand={() => setFilesCollapsed(false)}
          >
            <LeftView view={activityView} />
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel order={2} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="snakie.layout.vertical">
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
                defaultSize={shellCollapsed ? 0 : 30}
                minSize={12}
                onCollapse={() => setShellCollapsed(true)}
                onExpand={() => setShellCollapsed(false)}
              >
                <ShellPanel chatOpen={!rightCollapsed} />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel
            ref={rightRef}
            order={3}
            collapsible
            collapsedSize={0}
            defaultSize={rightCollapsed ? 0 : 20}
            minSize={14}
            onCollapse={() => setRightCollapsed(true)}
            onExpand={() => setRightCollapsed(false)}
          >
            <RightPanel />
          </Panel>
        </PanelGroup>

        {/* The INSTRUMENT DOCK lives OUTSIDE the PanelGroup — a fixed-width region
            to the right of the chat. Kept out of the group so toggling it (or the
            chat) never resizes the other (two collapsible panels in one group
            redistribute each other's freed space). Shown by the toolbar
            Instruments button or an incoming `instruments:open`. */}
        {instrumentsVisible && (
          <aside className="shell__dock" aria-label="Instrument dock">
            <InstrumentDockRegion
              host={instruments}
              vis={visibility}
              inUse={inUse}
              onToggleVisible={toggleVisible}
            />
          </aside>
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
        <SettingsDialog initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}
