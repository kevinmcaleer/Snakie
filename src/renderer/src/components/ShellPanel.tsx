import { PanelHeader } from './PanelHeader'
import { Terminal } from './Terminal'
import { ConnectionControl } from './ConnectionControl'
import { useDeviceStatus } from '../hooks/useDeviceStatus'

/**
 * BOTTOM — shell / console (REPL) region.
 *
 * Hosts an interactive xterm.js terminal bound to the MicroPython device's
 * friendly REPL, plus a compact connect/disconnect control in the header. This
 * region is OPEN by default by design (the REPL is core to the tool).
 */
export function ShellPanel(): JSX.Element {
  const status = useDeviceStatus()

  return (
    <section className="region region--shell" aria-label="Shell">
      <PanelHeader title="Shell" actions={<ConnectionControl status={status} />} />
      <div className="region__body region__body--terminal">
        <Terminal />
      </div>
    </section>
  )
}
