import { useCallback, useRef } from 'react'
import { PanelHeader } from './PanelHeader'
import { Terminal, type TerminalHandle } from './Terminal'
import { ConnectionControl } from './ConnectionControl'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import './RunControls.css'

/**
 * BOTTOM — shell / console (REPL) region.
 *
 * Hosts an interactive xterm.js terminal bound to the MicroPython device's
 * friendly REPL, plus a compact connect/disconnect control in the header and a
 * big "Clear" (trashcan) button that wipes the terminal. This region is OPEN by
 * default by design (the REPL is core to the tool).
 */
export function ShellPanel(): JSX.Element {
  const status = useDeviceStatus()
  const terminalRef = useRef<TerminalHandle>(null)

  const handleClear = useCallback(() => {
    terminalRef.current?.clear()
  }, [])

  return (
    <section className="region region--shell" aria-label="Shell">
      <PanelHeader
        title="Shell"
        actions={
          <div className="shell-actions">
            <button
              type="button"
              className="btn btn--ghost btn--lg shell-actions__clear"
              onClick={handleClear}
              title="Clear shell output"
              aria-label="Clear shell output"
            >
              <span className="btn__glyph" aria-hidden="true">
                🗑
              </span>
              <span>Clear</span>
            </button>
            <ConnectionControl status={status} />
          </div>
        }
      />
      <div className="region__body region__body--terminal">
        <Terminal ref={terminalRef} />
      </div>
    </section>
  )
}
