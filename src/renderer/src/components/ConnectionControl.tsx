import { useCallback, useEffect, useState } from 'react'
import { isVirtualPort, VIRTUAL_PORT_LABEL, VIRTUAL_PORT_PATH } from '../../../shared/virtual-device'
import { SimMemoryDialog } from './SimMemoryDialog'
import { pushSimHeapBytes, readSimHeapBytes, writeSimHeapBytes } from '../store/sim-memory'
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
  // Simulated-device memory (#901): the stored preference, the heap the live
  // simulator actually booted with, and whether the cog's dialog is open.
  const [memOpen, setMemOpen] = useState(false)
  const [heapBytes, setHeapBytes] = useState(readSimHeapBytes)
  const [bootedHeap, setBootedHeap] = useState<number | null>(null)

  const connected = status.state === 'connected'
  const connecting = status.state === 'connecting' || busy
  // The cog belongs to the SELECTED port, not the connected one — the setting is
  // about the simulator's next boot, so it has to be reachable before connecting.
  const simSelected = isVirtualPort(selected)

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

  // Hand the stored heap to the device layer once, on mount, so a preference set
  // in an earlier session is in force before anything auto-connects the sim
  // (the web build does so ~400ms after first render) (#901).
  useEffect(() => {
    void pushSimHeapBytes(readSimHeapBytes())
  }, [])

  // What the LIVE simulator booted with — the device layer owns that truth, so
  // the dialog can say honestly whether a restart is still owed. Re-read on
  // every connection change, since connecting is what fixes a heap in place.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const state = await window.api.device.getSimMemory?.()
        if (!cancelled && state) setBootedHeap(state.booted)
      } catch {
        /* an older preload has no such channel — the dialog just won't offer a restart */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status.state, status.path])

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

  /** Persist a new simulated heap and hand it to the device layer. */
  const saveHeap = useCallback(async (bytes: number): Promise<number> => {
    const stored = writeSimHeapBytes(bytes)
    setHeapBytes(stored)
    await pushSimHeapBytes(stored)
    return stored
  }, [])

  const handleSaveHeap = useCallback(
    (bytes: number): void => {
      void saveHeap(bytes)
      setMemOpen(false)
    },
    [saveHeap]
  )

  /**
   * Save AND restart the simulator, because the heap is fixed at interpreter
   * start-up. A disconnect/connect cycle is the supported way to get a fresh
   * interpreter — the same terminate-and-respawn Stop performs — so the RAM
   * filesystem resets with it, which the dialog warns about before we get here.
   */
  const handleSaveAndRestartHeap = useCallback(
    (bytes: number): void => {
      setMemOpen(false)
      void (async () => {
        setError(null)
        setBusy(true)
        try {
          await saveHeap(bytes)
          await window.api.device.disconnect()
          await window.api.device.connect(VIRTUAL_PORT_PATH)
          const state = await window.api.device.getSimMemory?.()
          if (state) setBootedHeap(state.booted)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      })()
    },
    [saveHeap]
  )

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
      {/* Memory cog — only for the simulated board, which is the only device
          whose RAM we get to choose (#901). */}
      {simSelected && (
        <button
          type="button"
          className="btn btn--ghost btn--sm conn-control__cog"
          onClick={() => setMemOpen(true)}
          title="Simulated device memory"
          aria-label="Simulated device memory"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
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
      {memOpen && (
        <SimMemoryDialog
          value={heapBytes}
          booted={bootedHeap}
          onSave={handleSaveHeap}
          onSaveAndRestart={handleSaveAndRestartHeap}
          onClose={() => setMemOpen(false)}
        />
      )}
    </div>
  )
}
