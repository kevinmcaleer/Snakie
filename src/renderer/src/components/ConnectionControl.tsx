import { useCallback, useEffect, useState } from 'react'
import { isVirtualPort, VIRTUAL_PORT_LABEL } from '../../../shared/virtual-device'
import type { DeviceStatus, PortCircuitPy, PortInfo } from '../../../preload/index.d'

/**
 * Tooltip for a port identified from its CIRCUITPY drive (#753). Names the
 * board id and the mount path, and is honest about HOW it was matched: a `uid`
 * pairing is the board's own id matched against the port's USB serial number,
 * while `sole` is only "there was one of each", which is a deduction rather
 * than an identification.
 */
function circuitpyTitle(cp: PortCircuitPy): string {
  const board = cp.boardId ? `${cp.boardId} — ` : ''
  const how =
    cp.confidence === 'uid'
      ? 'matched by board id'
      : 'the only CircuitPython drive mounted, and the only board connected'
  return `${board}CIRCUITPY at ${cp.mountPath} (${how})`
}

interface ConnectionControlProps {
  status: DeviceStatus
}

/**
 * Compact connect / disconnect control for the shell header.
 *
 * Renders a port dropdown (refreshed from `device.listPorts()`), and a single
 * toggle button whose label/action reflects the live connection state. The
 * state itself is owned by the device layer and supplied via `status`, so this
 * component stays stateless about connectedness and simply reacts.
 */
export function ConnectionControl({ status }: ConnectionControlProps): JSX.Element {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connected = status.state === 'connected'
  const connecting = status.state === 'connecting' || busy

  const refreshPorts = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.device.listPorts()
      setPorts(list)
      setSelected((prev) => {
        if (prev && list.some((p) => p.path === prev)) return prev
        return list[0]?.path ?? ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refreshPorts()
  }, [refreshPorts])

  // Keep the dropdown showing the active port while connected.
  // Keep the dropdown showing the active port while connected. A board picked via
  // Web Serial's chooser isn't in the list yet (it was only just granted), so pull
  // the ports again — otherwise the <select> falls back to showing the first option.
  useEffect(() => {
    if (!connected || !status.path) return
    setSelected(status.path)
    void refreshPorts()
  }, [connected, status.path, refreshPorts])

  const handleToggle = useCallback(async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      if (connected) {
        await window.api.device.disconnect()
      } else if (selected) {
        await window.api.device.connect(selected)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [connected, selected])

  return (
    <div className="conn-control" title={error ?? undefined}>
      <select
        className="conn-control__select"
        value={selected}
        disabled={connected || connecting}
        onChange={(e) => setSelected(e.target.value)}
        // Refresh the port list as the dropdown is opened, so the manual refresh
        // button is no longer needed (space-efficient header). onMouseDown fires
        // before the native list renders; onFocus covers keyboard users.
        onMouseDown={() => void refreshPorts()}
        onFocus={() => void refreshPorts()}
        aria-label="Serial port"
      >
        {ports.length === 0 && <option value="">No ports</option>}
        {ports.map((p) => {
          // The simulated device shows just its friendly label (its sentinel
          // path, `snakie://virtual`, is an implementation detail).
          if (isVirtualPort(p.path)) {
            return (
              <option key={p.path} value={p.path}>
                {VIRTUAL_PORT_LABEL}
              </option>
            )
          }
          const detail = p.friendlyName ?? p.manufacturer
          // A Web Serial board's `webserial://n` path is a synthetic index, not a
          // real device node — show just its USB name. OS serial paths (e.g.
          // /dev/ttyACM0) DO identify the port, so keep those.
          const isWebSerial = p.path.startsWith('webserial://')
          const base = isWebSerial ? detail || 'USB board' : detail ? `${p.path} — ${detail}` : p.path
          // A board whose CIRCUITPY drive we found says what it's running before
          // you connect to it (#753). Only shown when the drive was tied to THIS
          // port, so a second board can't borrow the first one's identity.
          const cp = p.circuitpy
          const label = cp ? `${base} · CircuitPython${cp.version ? ` ${cp.version}` : ''}` : base
          return (
            <option key={p.path} value={p.path} title={cp ? circuitpyTitle(cp) : undefined}>
              {label}
            </option>
          )
        })}
      </select>
      <button
        type="button"
        className={`btn btn--sm ${connected ? 'btn--danger' : 'btn--primary'}`}
        onClick={() => void handleToggle()}
        disabled={connecting || (!connected && !selected)}
      >
        {connected ? 'Disconnect' : connecting ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}
