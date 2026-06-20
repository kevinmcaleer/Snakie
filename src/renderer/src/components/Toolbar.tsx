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
  theme: Theme
  onToggleTheme: () => void
  filesCollapsed: boolean
  onToggleFiles: () => void
  shellCollapsed: boolean
  onToggleShell: () => void
  rightCollapsed: boolean
  onToggleRight: () => void
  onOpenSettings: () => void
  onOpenBoard: () => void
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
 * Also hosts the utility knobs next to Run/Stop (Settings / Board View /
 * light-dark toggle) and the right cluster of panel-collapse knobs (Files /
 * Shell / Chat), which render as pressable hardware keys in the Skeuomorph skin
 * (a pressed-in look marks the active / shown panel).
 */
export function Toolbar({
  theme,
  onToggleTheme,
  filesCollapsed,
  onToggleFiles,
  shellCollapsed,
  onToggleShell,
  rightCollapsed,
  onToggleRight,
  onOpenSettings,
  onOpenBoard
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

      <span className="toolbar__divider" aria-hidden="true" />

      <div className="toolbar__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--knob"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open settings"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
            />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--knob"
          onClick={onOpenBoard}
          title="Board View — visualise pin wiring (toggle)"
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
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--knob"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to the Skeuomorph theme' : 'Switch to the dark theme'}
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

      <div className="toolbar__spacer" />

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
      </div>
    </header>
  )
}
