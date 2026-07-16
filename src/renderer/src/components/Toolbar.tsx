import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { reporter } from '../lib/report-error'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { isVirtualPort } from '../../../shared/virtual-device'
import { IS_WEB } from '../lib/env'
import './RunControls.css'
import './Toolbar.css'

/**
 * Inline pixel SVG wrapper for the file-action toolbar icons, matching the
 * crisp-edges style used by the activity bar.
 */
const ToolIcon = (children: ReactNode): JSX.Element => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

/**
 * Inline SVG wrapper for the panel-collapse "knob" icons on the right of the
 * toolbar — a rounded-rect window with a filled bar on the edge of the panel it
 * toggles, plus a divider line (matches the Skeuomorph concept's hardware keys).
 */
const PanelIcon = (children: ReactNode): JSX.Element => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

// page with a `+` (new file)
const NEW_FILE_ICON = ToolIcon(
  <g fill="currentColor">
    <path d="M3 1h6l4 4v10H3z M9 1v4h4" />
    <rect x="7" y="8" width="2" height="6" />
    <rect x="5" y="10" width="6" height="2" />
  </g>
)
// folder (open folder)
const OPEN_FOLDER_ICON = ToolIcon(<path d="M1 3h5l2 2h7v8H1z" fill="currentColor" />)
// floppy disk (save)
const SAVE_ICON = ToolIcon(
  <g fill="currentColor">
    <path d="M1 1h11l3 3v11H1z" />
    <rect x="4" y="2" width="6" height="4" fill="var(--bg-elevated)" />
    <rect x="8" y="2.5" width="1.5" height="3" fill="currentColor" />
    <rect x="3.5" y="9" width="9" height="5" fill="var(--bg-elevated)" />
  </g>
)

// Window with a filled bar on the left edge — toggles the left (Files) panel.
const PANEL_LEFT_ICON = PanelIcon(
  <g>
    <rect x="3" y="5" width="18" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <rect x="4.2" y="6.2" width="4.6" height="11.6" rx="1" fill="currentColor" opacity="0.3" />
    <line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" strokeWidth="1.6" />
  </g>
)
// Window with a filled bar on the bottom edge — toggles the bottom (Shell) panel.
const PANEL_BOTTOM_ICON = PanelIcon(
  <g>
    <rect x="3" y="5" width="18" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <rect x="4.2" y="14" width="15.6" height="3.8" rx="1" fill="currentColor" opacity="0.3" />
    <line x1="3" y1="14" x2="21" y2="14" stroke="currentColor" strokeWidth="1.6" />
  </g>
)
// Window with a filled bar on the right edge — toggles the right (Chat) panel.
const PANEL_RIGHT_ICON = PanelIcon(
  <g>
    <rect x="3" y="5" width="18" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <rect x="15.2" y="6.2" width="4.6" height="11.6" rx="1" fill="currentColor" opacity="0.3" />
    <line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" strokeWidth="1.6" />
  </g>
)

/**
 * Glossy green snake brand mark from the Skeuomorph concept: a green
 * vertical-gradient body with a round head, eye and a small red forked tongue.
 */
const SNAKE_LOGO = (
  <svg
    width="28"
    height="28"
    viewBox="0 0 32 32"
    className="toolbar__logo"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="snakie-mark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#86df6f" />
        <stop offset="1" stopColor="#369b2c" />
      </linearGradient>
    </defs>
    <path
      d="M10 27c0-4 6-3.5 6-8s-6-3.5-6-8 5.5-5 10-3.6"
      fill="none"
      stroke="url(#snakie-mark)"
      strokeWidth="4.3"
      strokeLinecap="round"
    />
    <circle cx="21" cy="7" r="3.7" fill="url(#snakie-mark)" stroke="#2f7a28" strokeWidth="0.7" />
    <circle cx="22.1" cy="6.3" r="0.95" fill="#16240f" />
    <path d="M24.4 8l3 .7m-3-.7l3-.9" stroke="#e23b2b" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

interface ToolbarProps {
  filesCollapsed: boolean
  onToggleFiles: () => void
  shellCollapsed: boolean
  onToggleShell: () => void
  rightCollapsed: boolean
  onToggleRight: () => void
  onOpenBoard: () => void
  /** Toggle the visibility of the docked/floating instruments (#101 / #102). */
  onToggleInstruments: () => void
  /** Whether the instruments are currently shown (drives the pressed look). */
  instrumentsVisible: boolean
  /** Number of open instruments (for the button title; 0 ⇒ still toggles). */
  instrumentCount: number
}

/**
 * TOP TOOLBAR.
 *
 * Big, easy-to-click action buttons (Run / Stop) plus the file actions
 * (New / Open / Save, grouped as one segmented control). Run executes the
 * active editor file on the device via MicroPython paste mode (output streams to
 * the existing Shell terminal); Stop sends an interrupt (Ctrl-C).
 *
 * Connection state and the Flash-firmware action now live in the bottom
 * {@link StatusBar} (issue #71); this toolbar still reads {@link useDeviceStatus}
 * only to enable/disable the Run/Stop buttons.
 *
 * Also hosts the Board View knob next to Run/Stop and the right cluster of
 * panel-collapse knobs (Files / Shell / Chat), which render as pressable hardware
 * keys in the Skeuomorph skin (a pressed-in look marks the active / shown panel).
 * Settings and the theme picker now live on the activity bar + Settings dialog.
 */
export function Toolbar({
  filesCollapsed,
  onToggleFiles,
  shellCollapsed,
  onToggleShell,
  rightCollapsed,
  onToggleRight,
  onOpenBoard,
  onToggleInstruments,
  instrumentsVisible,
  instrumentCount
}: ToolbarProps): JSX.Element {
  const status = useDeviceStatus()
  const { openFiles, activeId, newFile, openFolder, saveFile } = useWorkspace()
  const { markRun } = useConsole()
  const connected = status.state === 'connected'
  const activeFile = openFiles.find((f) => f.id === activeId)
  // Run is clickable whenever a file is open — if nothing is connected we boot
  // the simulator first (see handleRun), so Run never silently no-ops.
  const [connecting, setConnecting] = useState(false)
  const canRun = activeFile != null && !connecting

  /**
   * Execute the active file on the device using MicroPython paste mode:
   *   Ctrl-E (\x05) enters paste mode, the file content is streamed verbatim,
   *   then Ctrl-D (\x04) executes it. Device output flows back to the Shell
   *   terminal automatically via its existing `onData` subscription — so we
   *   never need a handle to the terminal here.
   */
  // Track whether a program is running so the Stop button can double as Reset.
  // Set on Run; cleared when the user Stops (interrupts) or the device drops.
  // A running program a user keeps in a loop stays "running" until Stop; a
  // freshly-connected/idle board is "not running".
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!connected) setRunning(false)
  }, [connected])

  const handleRun = useCallback(async (): Promise<void> => {
    if (!activeFile) return
    // Nothing connected? (e.g. a page reload dropped the simulated device, or the
    // user hasn't pressed Connect yet.) Boot the simulator and run on it, so Run
    // never silently does nothing. A real board the user already connected wins —
    // `connected` is true then and we skip straight to sending the program.
    if (!connected) {
      try {
        setConnecting(true)
        const ports = await window.api.device.listPorts()
        const target = ports.find((p) => isVirtualPort(p.path)) ?? ports[0]
        if (!target) throw new Error('No device is available to run on.')
        await window.api.device.connect(target.path)
      } catch (err) {
        reporter('connect', { notify: "Couldn't connect a device to run your program." })(err)
        return
      } finally {
        setConnecting(false)
      }
    }
    // Record the console position so "send console to chat" / the composer's
    // attach-console control grab only this run's output (issue #78).
    markRun()
    setRunning(true)
    const payload = `\x05${activeFile.content}\x04`
    window.api.device.sendData(payload).catch(reporter('run', { notify: "Couldn't send your program to the board." }))
  }, [connected, activeFile, markRun])

  // Stop is dual-purpose: interrupt a running program (Ctrl-C); or, when nothing
  // is running, soft-reset the board (Ctrl-D) — a quick way to clear device state.
  const handleStop = useCallback(() => {
    if (running) {
      window.api.device.interrupt().catch(reporter('stop', { notify: "Couldn't stop the board." }))
      setRunning(false)
    } else {
      window.api.device.softReset().catch(reporter('reset', { notify: "Couldn't reset the board." }))
    }
  }, [running])

  const handleOpenFolder = useCallback(() => {
    void openFolder().catch(reporter('open folder', { notify: "Couldn't open the folder." }))
  }, [openFolder])

  const handleSave = useCallback(() => {
    if (activeId) void saveFile(activeId).catch(reporter('save file', { notify: "Couldn't save the file." }))
  }, [activeId, saveFile])

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="toolbar__brand">
        {SNAKE_LOGO}
        <span className="toolbar__wordmark">Snakie</span>
      </div>

      <div className="toolbar__group">
        <div className="toolbar__seg" role="group" aria-label="File actions">
          <button
            type="button"
            className="btn btn--ghost btn--icon toolbar__seg-btn"
            onClick={newFile}
            title="New file"
            aria-label="New file"
          >
            {NEW_FILE_ICON}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon toolbar__seg-btn toolbar__seg-btn--open"
            onClick={handleOpenFolder}
            title="Open folder"
            aria-label="Open folder"
          >
            {OPEN_FOLDER_ICON}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon toolbar__seg-btn"
            onClick={handleSave}
            disabled={!activeFile}
            title={activeFile ? `Save ${activeFile.name}` : 'Open a file to save'}
            aria-label="Save active file"
          >
            {SAVE_ICON}
          </button>
        </div>
      </div>

      <span className="toolbar__divider" aria-hidden="true" />

      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void handleRun()}
          disabled={!canRun}
          title={
            !activeFile
              ? 'Open a file to run'
              : connecting
                ? 'Connecting…'
                : !connected
                  ? 'Run on the simulator'
                  : `Run ${activeFile.name} on the device`
          }
          aria-label="Run active file on device"
        >
          <span className="btn__glyph" aria-hidden="true">
            ▶
          </span>
          <span>Run</span>
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={handleStop}
          disabled={!connected}
          title={
            !connected
              ? 'Connect to a device to stop'
              : running
                ? 'Interrupt the running program (Ctrl-C)'
                : 'Reset the board (soft reboot)'
          }
          aria-label={running ? 'Stop / interrupt running program' : 'Reset the board'}
        >
          <span className="btn__glyph" aria-hidden="true">
            {running ? '■' : '⟳'}
          </span>
          <span>{running ? 'Stop' : 'Reset'}</span>
        </button>
      </div>

      <span className="toolbar__divider" aria-hidden="true" />

      {/* Board View pops out into its own window — an OS BrowserWindow on the
          desktop, a browser popup on the web (see web/web-board.ts). */}
      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--knob"
          onClick={onOpenBoard}
          title="Board View — pop out into its own window (toggle)"
          aria-label="Toggle Board View"
        >
          {/* dev board: outlined PCB with two rows of header pads + a chip */}
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <rect x="4" y="3" width="16" height="18" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.35" />
            <g fill="currentColor">
              <rect x="5.4" y="5.5" width="1.6" height="1.6" />
              <rect x="5.4" y="8.5" width="1.6" height="1.6" />
              <rect x="5.4" y="11.5" width="1.6" height="1.6" />
              <rect x="5.4" y="14.5" width="1.6" height="1.6" />
              <rect x="17" y="5.5" width="1.6" height="1.6" />
              <rect x="17" y="8.5" width="1.6" height="1.6" />
              <rect x="17" y="11.5" width="1.6" height="1.6" />
              <rect x="17" y="14.5" width="1.6" height="1.6" />
            </g>
          </svg>
        </button>
      </div>

      <div className="toolbar__spacer" />

      {/* Workspace layouts (epic #259): Code / Board / Lab / Data + reset. */}
      <WorkspaceSwitcher />

      <div className="toolbar__group">
        <button
          type="button"
          className={`btn btn--ghost btn--icon btn--knob ${filesCollapsed ? '' : 'is-active'}`}
          aria-pressed={!filesCollapsed}
          onClick={onToggleFiles}
          title="Toggle Files panel"
          aria-label="Toggle Files panel"
        >
          {PANEL_LEFT_ICON}
        </button>
        <button
          type="button"
          className={`btn btn--ghost btn--icon btn--knob ${shellCollapsed ? '' : 'is-active'}`}
          aria-pressed={!shellCollapsed}
          onClick={onToggleShell}
          title="Toggle Shell panel"
          aria-label="Toggle Shell panel"
        >
          {PANEL_BOTTOM_ICON}
        </button>
        {/* Chat panel — hidden on the web build (the LLM chat is desktop-only). */}
        {!IS_WEB && (
          <button
            type="button"
            className={`btn btn--ghost btn--icon btn--knob ${rightCollapsed ? '' : 'is-active'}`}
            aria-pressed={!rightCollapsed}
            onClick={onToggleRight}
            title="Toggle Chat panel"
            aria-label="Toggle Chat panel"
          >
            {PANEL_RIGHT_ICON}
          </button>
        )}
        <button
          type="button"
          className={`btn btn--ghost btn--icon btn--knob ${instrumentsVisible ? 'is-active' : ''}`}
          aria-pressed={instrumentsVisible}
          onClick={onToggleInstruments}
          title={
            instrumentCount > 0
              ? `${instrumentsVisible ? 'Hide' : 'Show'} instruments (${instrumentCount} open)`
              : 'Toggle instruments — open a scope/meter from a PWM/ADC pin in the Board View'
          }
          aria-label="Toggle instruments"
        >
          {/* Instrument cluster: a CRT scope screen with a square-wave trace +
              a gauge tick, marking the oscilloscope/multimeter dock. Placed right
              of the Chat toggle so the buttons match the panel order on screen. */}
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <rect x="3" y="4.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M5.5 12.5 L8 12.5 L8 9.5 L11 9.5 L11 12.5 L13.5 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <line x1="15" y1="12.5" x2="18" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}
