import { useCallback, useRef, useState } from 'react'
import { PanelHeader } from './PanelHeader'
import { Terminal, type TerminalHandle } from './Terminal'
import { Plotter } from './Plotter'
import { Problems } from './Problems'
import { ConnectionControl } from './ConnectionControl'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useDiagnostics } from '../store/diagnostics'
import { useConsole } from '../store/console'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { SEND_CONSOLE_EVENT } from './ChatPanel'
import './RunControls.css'
import './ShellPanel.css'

/** The full-body, mutually-exclusive shell views (Console ⟷ Problems). */
type ShellView = 'console' | 'problems'

interface ShellPanelProps {
  /** Whether the right-hand chat panel is open (controls the "Send to chat" button). */
  chatOpen?: boolean
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
 * exclusive, full-body views) plus an independent **Plotter** toggle key
 * (issue #103). When the Plotter is ON it opens as a *secondary* pane **beside**
 * the console (split: console left, the skeuomorphic strip-chart {@link Plotter}
 * right) so the user sees both the REPL scrollback **and** the live plot at once
 * — rather than swapping the body as the old segmented tab did. The toggle
 * persists in `localStorage` (`snakie.plotterOpen`).
 *
 * All three bodies (Terminal, Plotter, Problems) stay mounted; the inactive ones
 * are hidden via CSS so console scrollback and plotted data survive toggling,
 * and the Plotter subscribes independently to the broadcast serial stream.
 */
export function ShellPanel({ chatOpen = false }: ShellPanelProps): JSX.Element {
  const status = useDeviceStatus()
  const terminalRef = useRef<TerminalHandle>(null)
  const [view, setView] = useState<ShellView>('console')
  const [plotterOpen, setPlotterOpen] = useLocalStorage<boolean>('snakie.plotterOpen', false)
  const { diagnostics } = useDiagnostics()
  const { getSinceRun } = useConsole()
  const [lintingEnabled, setLintingEnabled] = useLocalStorage<boolean>(
    'snakie.lintingEnabled',
    true
  )

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

  // The Plotter shows alongside whichever full-body view is active EXCEPT
  // Problems, which keeps its own full-body view (the plot pane stays mounted so
  // its data survives — it just hides while Problems is showing).
  const plotterVisible = plotterOpen && view !== 'problems'

  return (
    <section className="region region--shell" aria-label="Shell">
      <PanelHeader
        title="Shell"
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
            <button
              type="button"
              className={`shell-key${plotterOpen ? ' shell-key--active' : ''}`}
              aria-pressed={plotterOpen}
              onClick={() => setPlotterOpen(!plotterOpen)}
              title={plotterOpen ? 'Hide the live plotter' : 'Show the live plotter beside the console'}
            >
              <span className="shell-key__glyph" aria-hidden="true">
                📈
              </span>
              <span>Plotter</span>
            </button>
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
                className="btn btn--ghost shell-actions__send-chat"
                onClick={handleSendToChat}
                title="Send console output (since last Run) to the chat"
                aria-label="Send console output to chat"
              >
                <span className="btn__glyph" aria-hidden="true">
                  💬
                </span>
                <span>Send to chat</span>
              </button>
            )}
            {view === 'console' && (
              <button
                type="button"
                className="btn btn--ghost shell-actions__clear"
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
          </div>
        }
      />
      <div className={`region__body region__body--terminal shell-split${plotterVisible ? ' shell-split--plotter' : ''}`}>
        <div
          className={`shell-view${view === 'console' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          <Terminal ref={terminalRef} />
        </div>
        <div
          className={`shell-view shell-view--problems${view === 'problems' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          <Problems />
        </div>
        <div
          className={`shell-view shell-view--plotter${plotterVisible ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
          aria-label="Live plotter"
        >
          <Plotter />
        </div>
      </div>
    </section>
  )
}
