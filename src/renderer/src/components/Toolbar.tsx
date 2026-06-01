import { Theme } from '../hooks/useTheme'
import { useDeviceStatus } from '../hooks/useDeviceStatus'

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
 * indicator. The Run / Stop buttons remain VISUAL PLACEHOLDERS (wired in a
 * later issue). The connection-status indicator IS live: it reflects the
 * device layer's status via {@link useDeviceStatus}.
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
  const connected = status.state === 'connected'
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
        {/* Placeholder: not wired to a device. */}
        <button type="button" className="btn btn--primary btn--lg" aria-label="Run (placeholder)">
          <span className="btn__glyph">▶</span>
          <span>Run</span>
        </button>
        <button type="button" className="btn btn--danger btn--lg" aria-label="Stop (placeholder)">
          <span className="btn__glyph">■</span>
          <span>Stop</span>
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
          title="Toggle side Panel"
        >
          Panel
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onToggleTheme}
          title="Toggle light/dark theme"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}
