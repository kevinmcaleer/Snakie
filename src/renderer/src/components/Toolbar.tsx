import { useCallback, type ReactNode } from 'react'
import { Theme } from '../hooks/useTheme'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useConsole } from '../store/console'
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
 * Big, easy-to-click action buttons (Run / Stop) plus the file actions
 * (New / Open / Save). Run executes the active editor file on the device via
 * MicroPython paste mode (output streams to the existing Shell terminal); Stop
 * sends an interrupt (Ctrl-C).
 *
 * Connection state and the Flash-firmware action now live in the bottom
 * {@link StatusBar} (issue #71); this toolbar still reads {@link useDeviceStatus}
 * only to enable/disable the Run/Stop buttons.
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
  const { openFiles, activeId, newFile, openFolder, saveFile } = useWorkspace()
  const { markRun } = useConsole()
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
    // Record the console position so "send console to chat" / the composer's
    // attach-console control grab only this run's output (issue #78).
    markRun()
    const payload = `\x05${activeFile.content}\x04`
    window.api.device.sendData(payload).catch(() => undefined)
  }, [connected, activeFile, markRun])

  const handleStop = useCallback(() => {
    window.api.device.interrupt().catch(() => undefined)
  }, [])

  const handleOpenFolder = useCallback(() => {
    void openFolder().catch(() => undefined)
  }, [openFolder])

  const handleSave = useCallback(() => {
    if (activeId) void saveFile(activeId).catch(() => undefined)
  }, [activeId, saveFile])

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={newFile}
          title="New file"
          aria-label="New file"
        >
          {NEW_FILE_ICON}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={handleOpenFolder}
          title="Open folder"
          aria-label="Open folder"
        >
          {OPEN_FOLDER_ICON}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={handleSave}
          disabled={!activeFile}
          title={activeFile ? `Save ${activeFile.name}` : 'Open a file to save'}
          aria-label="Save active file"
        >
          {SAVE_ICON}
        </button>
      </div>

      <span className="toolbar__divider" aria-hidden="true" />

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
    </header>
  )
}
