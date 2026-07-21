import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelHeader } from './PanelHeader'
import { Terminal, type TerminalHandle } from './Terminal'
import { Problems } from './Problems'
import { ConnectionControl } from './ConnectionControl'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useDiagnostics } from '../store/diagnostics'
import { useConsole } from '../store/console'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { SEND_CONSOLE_EVENT } from './ChatPanel'
import { ChatIcon } from './ui-icons'
import './RunControls.css'
import './ShellPanel.css'

/** The full-body, mutually-exclusive shell views (Console ⟷ Problems). */
type ShellView = 'console' | 'problems'

interface ShellPanelProps {
  /** Whether the right-hand chat panel is open (controls the "Send to chat" button). */
  chatOpen?: boolean
  /** Toggle the AI chat panel open/closed. When provided (desktop), the console
   *  header shows a Chat button — the single opener for the chat pane (#…). */
  onToggleChat?: () => void
  /** Collapse this panel from its own header (Soft Shell per-panel control, #592). */
  onCollapse?: () => void
}

/**
 * BOTTOM — shell / console (REPL) region.
 *
 * Hosts an interactive xterm.js terminal bound to the MicroPython device's
 * friendly REPL, plus a compact connect/disconnect control in the header and a
 * big "Clear" (trashcan) button that wipes the terminal. This region is OPEN by
 * default by design (the REPL is core to the tool).
 *
 * The Shell header carries a Console / Problems segmented toggle (mutually
 * exclusive, full-body views). The live Plotter used to live here as a split
 * pane; it now lives in the instrument dock (right of chat) so the shell is
 * Console / Problems only.
 *
 * Both bodies (Terminal, Problems) stay mounted; the inactive one is hidden via
 * CSS so console scrollback survives toggling.
 */
export function ShellPanel({ chatOpen = false, onToggleChat, onCollapse }: ShellPanelProps): JSX.Element {
  const status = useDeviceStatus()
  const terminalRef = useRef<TerminalHandle>(null)
  const [view, setView] = useState<ShellView>('console')
  const { diagnostics } = useDiagnostics()
  const { getSinceRun, getAll } = useConsole()
  const [lintingEnabled, setLintingEnabled] = useLocalStorage<boolean>(
    'snakie.lintingEnabled',
    true
  )
  // The console can pop out into its own OS window (the instrument-window pattern,
  // #205). While popped out, the docked terminal is kept MOUNTED but hidden so its
  // scrollback survives; the docked area shows a "Redock" placeholder instead.
  const [poppedOut, setPoppedOut] = useState(false)

  // Closing the console window (native ✕ or Redock) returns it to the dock.
  useEffect(() => window.api.console.onClosed(() => setPoppedOut(false)), [])

  const popOut = useCallback(() => {
    setPoppedOut(true)
    // Seed the detached window with the current scrollback so it redraws prior
    // output instead of starting blank.
    void window.api.console.open(getAll())
  }, [getAll])
  const redock = useCallback(() => {
    // Closing the window fires `console:closed`, which clears `poppedOut`.
    window.api.console.close()
  }, [])

  const handleClear = useCallback(() => {
    terminalRef.current?.clear()
  }, [])

  /**
   * Grab the console output printed since the last Run and hand it to the chat
   * panel via a window CustomEvent (issue #78). The chat panel listens for this
   * and stages the output for the next message.
   */
  const handleSendToChat = useCallback(() => {
    const output = getSinceRun()
    window.dispatchEvent(
      new CustomEvent<string>(SEND_CONSOLE_EVENT, { detail: output })
    )
  }, [getSinceRun])

  const problemsLabel = diagnostics.length > 0 ? `Problems (${diagnostics.length})` : 'Problems'

  return (
    <section className="region region--shell" aria-label="Shell">
      <PanelHeader
        title=""
        actions={
          <div className="shell-actions">
            <div className="shell-toggle" role="tablist" aria-label="Shell view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'console'}
                className={`shell-toggle__btn${view === 'console' ? ' shell-toggle__btn--active' : ''}`}
                onClick={() => setView('console')}
              >
                Console
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'problems'}
                className={`shell-toggle__btn${view === 'problems' ? ' shell-toggle__btn--active' : ''}`}
                onClick={() => setView('problems')}
              >
                {problemsLabel}
              </button>
            </div>
            {view === 'problems' && (
              <label className="shell-lint-toggle" title="Toggle Python linting">
                <input
                  type="checkbox"
                  checked={lintingEnabled}
                  onChange={(e) => setLintingEnabled(e.target.checked)}
                />
                <span>Lint</span>
              </label>
            )}
            {view === 'console' && chatOpen && (
              <button
                type="button"
                className="btn btn--ghost btn--sm shell-actions__send-chat"
                onClick={handleSendToChat}
                title="Send console output (since last Run) to the chat"
                aria-label="Send console output to chat"
              >
                <span className="btn__glyph" aria-hidden="true">
                  <ChatIcon size={13} />
                </span>
                <span>Send to chat</span>
              </button>
            )}
            {/* Chat toggle (#…) — the single opener for the AI chat pane after the
                global toolbar toggles were retired (#592). Console view only. */}
            {view === 'console' && onToggleChat && (
              <button
                type="button"
                className={`btn btn--ghost btn--sm${chatOpen ? ' is-active' : ''}`}
                onClick={onToggleChat}
                title={chatOpen ? 'Hide the AI chat panel' : 'Show the AI chat panel'}
                aria-label={chatOpen ? 'Hide chat' : 'Show chat'}
                aria-pressed={chatOpen}
              >
                <span className="btn__glyph" aria-hidden="true">
                  <ChatIcon size={13} />
                </span>
                <span>Chat</span>
              </button>
            )}
            {view === 'console' && (
              <button
                type="button"
                className="btn btn--ghost btn--sm shell-actions__clear"
                onClick={handleClear}
                title="Clear shell output"
                aria-label="Clear shell output"
              >
                <span className="btn__glyph" aria-hidden="true">
                  ✕
                </span>
                <span>Clear</span>
              </button>
            )}
            <ConnectionControl status={status} />
            {onCollapse && (
              <button
                type="button"
                className="panel-collapse-btn"
                onClick={onCollapse}
                title="Collapse the console"
                aria-label="Collapse the console"
              >
                {/* Expanded → DOWN chevron (the console collapses downward). */}
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M4 6l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        }
      />
      <div className="region__body region__body--terminal shell-split">
        <div
          className={`shell-view${view === 'console' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          {/* Keep the terminal MOUNTED even when popped out, so its scrollback
              survives; just hide it and show a redock placeholder instead. */}
          <div className={`shell-console${poppedOut ? ' shell-console--popped' : ''}`}>
            <Terminal ref={terminalRef} />
            {!poppedOut && (
              <button
                type="button"
                className="shell-popout"
                title="Pop out the console into its own window"
                aria-label="Pop out console"
                onClick={popOut}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 3H3v10h10v-3M9.5 2.5H13.5V6.5M13 3 8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
          {poppedOut && (
            <div className="shell-popped">
              <span className="shell-popped__text">Console popped out to its own window</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={redock}>
                Redock
              </button>
            </div>
          )}
        </div>
        <div
          className={`shell-view shell-view--problems${view === 'problems' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          <Problems />
        </div>
      </div>
    </section>
  )
}
