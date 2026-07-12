import { useCallback, useEffect, useState } from 'react'
import { isVirtualPort, VIRTUAL_PORT_LABEL } from '../../../shared/virtual-device'
import type { DeviceStatus, PortInfo } from '../../../preload/index.d'

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
          const label = isWebSerial ? detail || 'USB board' : detail ? `${p.path} — ${detail}` : p.path
          return (
            <option key={p.path} value={p.path}>
              {label}
            </option>
          )
        })}
      </select>
      {!connected && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void refreshPorts()}
          disabled={connecting}
          title="Refresh ports"
          aria-label="Refresh serial ports"
        >
          ⟳
        </button>
      )}
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
