import { useCallback, useState } from 'react'
import { Theme } from '../hooks/useTheme'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { FirmwareFlasher } from './FirmwareFlasher'
import './RunControls.css'

interface ToolbarProps {
  theme: Theme
  onToggleTheme: () => void
  filesCollapsed: boolean
  onToggleFiles: () => void
  shellCollapsed: boolean
  onToggleShell: () => void
  rightCollapsed: boolean
  onToggleRight: () => void
}

/**
 * TOP TOOLBAR.
 *
 * Big, easy-to-click action buttons (Run / Stop) plus a connection-status
 * indicator. Run executes the active editor file on the device via MicroPython
 * paste mode (output streams to the existing Shell terminal); Stop sends an
 * interrupt (Ctrl-C). The connection-status indicator reflects the device
 * layer's status via {@link useDeviceStatus}.
 *
 * Also hosts layout controls (panel show/hide toggles) and the theme toggle,
 * following progressive disclosure: complexity stays tucked away by default.
 */
export function Toolbar({
  theme,
  onToggleTheme,
  filesCollapsed,
  onToggleFiles,
  shellCollapsed,
  onToggleShell,
  rightCollapsed,
  onToggleRight
}: ToolbarProps): JSX.Element {
  const status = useDeviceStatus()
  const [flasherOpen, setFlasherOpen] = useState(false)
  const { openFiles, activeId } = useWorkspace()
  const connected = status.state === 'connected'
  const activeFile = openFiles.find((f) => f.id === activeId)
  const canRun = connected && activeFile != null

  /**
   * Execute the active file on the device using MicroPython paste mode:
   *   Ctrl-E (\x05) enters paste mode, the file content is streamed verbatim,
   *   then Ctrl-D (\x04) executes it. Device output flows back to the Shell
   *   terminal automatically via its existing `onData` subscription — so we
   *   never need a handle to the terminal here.
   */
  const handleRun = useCallback(() => {
    if (!connected || !activeFile) return
    const payload = `\x05${activeFile.content}\x04`
    window.api.device.sendData(payload).catch(() => undefined)
  }, [connected, activeFile])

  const handleStop = useCallback(() => {
    window.api.device.interrupt().catch(() => undefined)
  }, [])

  const label =
    status.state === 'connecting'
      ? 'Connecting…'
      : connected
        ? `Connected${status.path ? ` · ${status.path}` : ''}`
        : status.state === 'error'
          ? 'Error'
          : 'Disconnected'

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleRun}
          disabled={!canRun}
          title={
            !connected
              ? 'Connect to a device to run'
              : !activeFile
                ? 'Open a file to run'
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
          title={connected ? 'Interrupt the running program (Ctrl-C)' : 'Connect to a device to stop'}
          aria-label="Stop / interrupt running program"
        >
          <span className="btn__glyph" aria-hidden="true">
            ■
          </span>
          <span>Stop</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setFlasherOpen(true)}
          title="Flash MicroPython firmware to the device (ESP via esptool, RP2040 via UF2)"
          aria-label="Flash MicroPython firmware"
        >
          <span className="btn__glyph" aria-hidden="true">
            ⚡
          </span>
          <span>Flash firmware</span>
        </button>
      </div>

      <div className="toolbar__group">
        {/* Live connection-status indicator, driven by the device layer. */}
        <span
          className={`conn-status ${connected ? 'conn-status--connected' : 'conn-status--disconnected'}`}
          title={status.error ? `Connection error: ${status.error}` : 'Connection status'}
        >
          <span className="conn-status__dot" aria-hidden="true" />
          <span>{label}</span>
        </span>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <button
          type="button"
          className={`btn btn--ghost ${filesCollapsed ? '' : 'is-active'}`}
          aria-pressed={!filesCollapsed}
          onClick={onToggleFiles}
          title="Toggle Files panel"
        >
          Files
        </button>
        <button
          type="button"
          className={`btn btn--ghost ${shellCollapsed ? '' : 'is-active'}`}
          aria-pressed={!shellCollapsed}
          onClick={onToggleShell}
          title="Toggle Shell panel"
        >
          Shell
        </button>
        <button
          type="button"
          className={`btn btn--ghost ${rightCollapsed ? '' : 'is-active'}`}
          aria-pressed={!rightCollapsed}
          onClick={onToggleRight}
          title="Toggle Chat panel"
        >
          Chat
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            shapeRendering="crispEdges"
            aria-hidden="true"
            focusable="false"
          >
            {theme === 'dark' ? (
              // sun (currently dark → switch to light)
              <g fill="currentColor">
                <rect x="6" y="6" width="4" height="4" />
                <rect x="7" y="0" width="2" height="2" />
                <rect x="7" y="14" width="2" height="2" />
                <rect x="0" y="7" width="2" height="2" />
                <rect x="14" y="7" width="2" height="2" />
                <rect x="2" y="2" width="2" height="2" />
                <rect x="12" y="2" width="2" height="2" />
                <rect x="2" y="12" width="2" height="2" />
                <rect x="12" y="12" width="2" height="2" />
              </g>
            ) : (
              // crescent moon (currently light → switch to dark)
              <path d="M9.5 2A6 6 0 1 0 14 11 A4.5 4.5 0 0 1 9.5 2Z" fill="currentColor" />
            )}
          </svg>
        </button>
      </div>

      {flasherOpen && <FirmwareFlasher onClose={() => setFlasherOpen(false)} />}
    </header>
  )
}
