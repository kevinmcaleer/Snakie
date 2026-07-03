import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTheme } from '../hooks/useTheme'
import { Toolbar } from './Toolbar'
import { ActivityBar, ActivityView } from './ActivityBar'
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
import { parsePins, type UsedPins } from './parse-pins'
import { runFindCommand } from './findController'
import { ShellPanel } from './ShellPanel'
import { RightPanel } from './RightPanel'
import { StatusBar } from './StatusBar'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { OPEN_SETTINGS_EVENT } from './settingsBus'
import { HELP_EVENT, type HelpEventDetail } from './editorBridge'
import { InstrumentLibBanner } from './InstrumentLibBanner'
import { PartsImportBanner } from './PartsImportBanner'
import {
  requiredPartModules,
  missingImports as computeMissingImports,
  missingOnBoard as computeMissingOnBoard,
  parsePyImports,
  type RequiredModule
} from './part-imports'
import { installPartDriver } from './driver-install'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  classifyPresentCopy,
  parseLibVersion,
  shouldShowBanner,
  type InstallState
} from '../lib/instrumentsLib'
import { useWorkspace } from '../store/workspace'
import { useEditorSettings } from '../store/settings'

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

  const boardSource = activeFile?.content ?? ''
  const boardFileName = activeFile?.name
  const boardIsPython = !!activeFile && /\.py$/i.test(activeFile.name)
  // The open project folder, streamed to the board window so its Wiring mode can
  // read/write robot.yml next to the user's code.
  const boardFolder = currentFolder ?? undefined

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
          theme,
          breadboardBg,
          folder: boardFolder
        })
      )
      .catch(() => undefined)
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme, breadboardBg, boardFolder])

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
  useEffect(() => {
    const off = window.api.board.onOpened(() => setBoardOpened(true))
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
      // A singleton (Plotter or a placeholder): show/hide flip; re-dock on show.
      const next = !visibility[id]
      setVisibility({ ...visibility, [id]: next })
      if (next) redockByKey(`singleton:${id}`)
    },
    [visibility, setVisibility, setKindVisible, redockKind, redockByKey, openInstruments, fileConns]
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

  // Probe the board (once per connection, and again on a project change) for which
  // required modules import. Including boardFolder avoids a stale probe set when you
  // switch projects while staying connected (modules change but the cache wouldn't).
  useEffect(() => setInstalledModules(null), [deviceStatus.state, deviceStatus.path, boardFolder])
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
      if (active) setInstalledModules(new Set(present))
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
        setInstalledModules(null) // re-probe → banner clears if now present
        // Tell the OTHER windows too (the Board View's driver banner re-probes).
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

  // An instrument's `?` (or any deep link) reveals the Help view + opens an
  // article. `nonce` bumps so re-clicking the same instrument re-opens it.
  const [helpTarget, setHelpTarget] = useState<{ id: string; nonce: number } | undefined>(undefined)
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<HelpEventDetail>).detail
      if (!detail?.articleId) return
      setActivityView('help')
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
      <Toolbar
        filesCollapsed={filesCollapsed}
        onToggleFiles={() => toggle(filesRef, filesCollapsed, setFilesCollapsed)}
        shellCollapsed={shellCollapsed}
        onToggleShell={() => toggle(shellRef, shellCollapsed, setShellCollapsed)}
        rightCollapsed={rightCollapsed}
        onToggleRight={() => toggle(rightRef, rightCollapsed, setRightCollapsed)}
        onOpenBoard={toggleBoard}
        onToggleInstruments={toggleInstruments}
        instrumentsVisible={instrumentsVisible}
        instrumentCount={openInstruments.length}
      />

      <div className="shell__body shell__main">
        <ActivityBar
          active={activityView}
          onOpenSettings={() => openSettings('appearance')}
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
            <LeftView view={activityView} helpTarget={helpTarget} />
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
