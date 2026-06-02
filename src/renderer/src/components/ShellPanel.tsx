import { useCallback, useRef, useState } from 'react'
import { PanelHeader } from './PanelHeader'
import { Terminal, type TerminalHandle } from './Terminal'
import { Plotter } from './Plotter'
import { ConnectionControl } from './ConnectionControl'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import './RunControls.css'
import './ShellPanel.css'

type ShellView = 'console' | 'plotter'

/**
 * BOTTOM — shell / console (REPL) region.
 *
 * Hosts an interactive xterm.js terminal bound to the MicroPython device's
 * friendly REPL, plus a compact connect/disconnect control in the header and a
 * big "Clear" (trashcan) button that wipes the terminal. This region is OPEN by
 * default by design (the REPL is core to the tool).
 *
 * A Console / Plotter segmented toggle (issue #21) switches the body between
 * the xterm REPL and a live numeric {@link Plotter}. Both views stay mounted
 * (the inactive one is hidden via CSS) so console scrollback and plotted data
 * survive toggling, and both subscribe independently to the broadcast serial
 * stream.
 */
export function ShellPanel(): JSX.Element {
  const status = useDeviceStatus()
  const terminalRef = useRef<TerminalHandle>(null)
  const [view, setView] = useState<ShellView>('console')

  const handleClear = useCallback(() => {
    terminalRef.current?.clear()
  }, [])

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
                aria-selected={view === 'plotter'}
                className={`shell-toggle__btn${view === 'plotter' ? ' shell-toggle__btn--active' : ''}`}
                onClick={() => setView('plotter')}
              >
                Plotter
              </button>
            </div>
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
      <div className="region__body region__body--terminal">
        <div
          className={`shell-view${view === 'console' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          <Terminal ref={terminalRef} />
        </div>
        <div
          className={`shell-view${view === 'plotter' ? '' : ' shell-view--hidden'}`}
          role="tabpanel"
        >
          <Plotter />
        </div>
      </div>
    </section>
  )
}
