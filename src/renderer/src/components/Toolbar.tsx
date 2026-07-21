import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { reporter } from '../lib/report-error'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
import { isVirtualPort } from '../../../shared/virtual-device'
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
 * Hosts the file actions (New / Open / Save), Run / Stop, and the centred
 * workspace switcher (Code · Electronics · Build). The Board View lives in the
 * Electronics workspace now, so the old pop-out board knob is gone (#…); the old
 * global panel-collapse knobs went in Soft Shell (#592) — each panel owns its own
 * collapse control. Settings + the theme picker live on the activity bar.
 */
export function Toolbar(): JSX.Element {
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
      {/* Left cluster: brand + file/run/board controls. Wrapped in a flex side
          that's balanced by an empty side on the right, so the workspace
          switcher sits CENTRED at the top of the toolbar (not shoved right). */}
      <div className="toolbar__side">
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

      </div>

      {/* Workspace layouts (epic #259): Code · Electronics · Build + reset.
          Per-panel collapse controls live IN each panel's own header now (#592),
          so the old global Files/Shell/Chat/Instruments toggle knobs are gone.
          Centred between two equal-weight sides. */}
      <WorkspaceSwitcher />
      <div className="toolbar__side toolbar__side--end" aria-hidden="true" />
    </header>
  )
}
