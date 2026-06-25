import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { useSnakiePresence } from './snakie-presence'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { BT_SCAN_DEMO, BT_SCAN_DEMO_NAME } from './bt-scan-demo'
import {
  MAX_SIGNAL_BARS,
  addBt,
  btNameLabel,
  nearestBt,
  rssiToBars,
  sortBtByStrength,
  type BluetoothTelemetry
} from './scanner-logic'
import './BluetoothInstrument.css'

/**
 * BLUETOOTH (#121) — a BLE device list as a dock instrument.
 * ==========================================================
 *
 * An ON-DEMAND scanner: pressing SCAN kicks an on-device Bluetooth scan over the
 * control channel (`SNKCMD scan:bt`, the documented `scan:<kind>` trigger) and
 * RESETS the list. Results then arrive ONE `BluetoothTelemetry` reading PER
 * DEVICE on the broadcast serial stream (the shared `instrument-telemetry` parser
 * decodes each `SNK BT …` line); we accumulate them — deduped by MAC, keeping the
 * strongest (nearest) sample — and clear the "scanning…" state on the FIRST
 * result.
 *
 * Each row shows the device name, its MAC and a signal indicator + RSSI in dBm.
 * The list/nearest maths lives in the unit-tested, DOM-free
 * {@link ./scanner-logic}; this file is just the SCAN button, the accumulating
 * state, and the render.
 */

export interface BluetoothInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}

/** The on-device scan trigger token for Bluetooth (documented `scan:<kind>`). */
const SCAN_TRIGGER = 'scan:bt'

export function BluetoothInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: BluetoothInstrumentProps): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { present } = useSnakiePresence()
  const { openBuffer } = useWorkspace()

  const [devices, setDevices] = useState<BluetoothTelemetry[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  // Shown when SCAN can't drive a scan — no board, or no Snakie program running
  // to service the trigger (then we offer to run the BLE demo). #149.
  const [prompt, setPrompt] = useState(false)
  // True while opening + running the demo (disables the prompt buttons).
  const [busy, setBusy] = useState(false)

  // One device per reading: accumulate (dedupe by MAC), and the first result
  // clears the scanning flag.
  useTelemetryStream(
    useCallback((reading) => {
      if (reading.kind !== 'bt') return
      setDevices((prev) => addBt(prev, reading))
      setScanning(false)
    }, [])
  )

  // Kick a scan only when a Snakie program is live to service the `scan:bt`
  // trigger; otherwise surface a prompt offering to run the BLE demo (#149)
  // rather than spinning on "scanning…" that never resolves.
  const scan = useCallback(async () => {
    if (!connected || !present) {
      setPrompt(true)
      return
    }
    setPrompt(false)
    setDevices([]) // RESET on SCAN press — a fresh sweep.
    setScanning(true)
    setScanned(true)
    try {
      await window.api.device.sendControl(SCAN_TRIGGER)
    } catch {
      setScanning(false)
    }
  }, [connected, present])

  // Open the BLE demo in a new tab and run it: interrupt any running program,
  // drop the demo in the editor, then paste-run it. Its `inst.start()` brings the
  // background service up (→ READY → present) and the initial scan fills the list.
  const runDemo = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.device.interrupt().catch(() => undefined)
      openBuffer(BT_SCAN_DEMO_NAME, BT_SCAN_DEMO)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.api.device.sendData(`\x05${BT_SCAN_DEMO}\x04`)
      setPrompt(false)
      setDevices([])
      setScanning(true)
      setScanned(true)
    } catch {
      setScanning(false)
    } finally {
      setBusy(false)
    }
  }, [openBuffer])

  const sorted = sortBtByStrength(devices)
  const nearest = nearestBt(devices)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source="BLE"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="bscan"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="instr__screen--accent">
          <div className="bscan__screen">
            {prompt ? (
              <div className="bscan__prompt">
                {connected ? (
                  <>
                    <p className="bscan__prompt-msg">
                      No Snakie program is running to service the scan.
                    </p>
                    <div className="bscan__prompt-actions">
                      <button
                        type="button"
                        className="bscan__demo"
                        onClick={() => void runDemo()}
                        disabled={busy}
                      >
                        {busy ? 'STARTING…' : '▶ Run BLE demo'}
                      </button>
                      <button
                        type="button"
                        className="bscan__dismiss"
                        onClick={() => setPrompt(false)}
                        disabled={busy}
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="bscan__prompt-hint">
                      Opens a demo that scans on the 2nd core — or run your own program that calls{' '}
                      <code>inst.start()</code>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="bscan__prompt-msg">Connect a board to scan for BLE devices.</p>
                    <div className="bscan__prompt-actions">
                      <button
                        type="button"
                        className="bscan__dismiss"
                        onClick={() => setPrompt(false)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : sorted.length > 0 ? (
              <ul className="bscan__list" aria-label="Bluetooth devices">
                {sorted.map((d, i) => (
                  <BtRow key={`${d.mac}-${i}`} dev={d} />
                ))}
              </ul>
            ) : (
              <p className="bscan__hint">
                {scanning
                  ? 'scanning…'
                  : scanned
                    ? 'No devices found — radio unavailable?'
                    : 'Press SCAN to find BLE devices'}
              </p>
            )}
            {scanning && sorted.length > 0 && <div className="bscan__scanning">scanning…</div>}
          </div>
        </PhosphorScreen>

        <div className="bscan__controls">
          <button
            type="button"
            className="bscan__scan"
            onClick={() => void scan()}
            disabled={scanning}
            title="Run a Bluetooth scan on the connected board"
          >
            {scanning ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>

        <div className="bscan__readout">
          <Cell
            label="DEVICES"
            value={scanning && devices.length === 0 ? '··' : String(devices.length)}
          />
          <span className="bscan__div" aria-hidden="true" />
          <Cell label="NEAREST" value={nearest ? `${nearest.rssi}` : '—'} />
          <span className="bscan__div" aria-hidden="true" />
          <Cell label="MODE" value="BLE" />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One device row: name + MAC + signal bars + RSSI. */
function BtRow({ dev }: { dev: BluetoothTelemetry }): JSX.Element {
  const bars = rssiToBars(dev.rssi)
  return (
    <li className="bscan__row">
      <span className="bscan__dot" aria-hidden="true" />
      <span className="bscan__info">
        <span className="bscan__name" title={btNameLabel(dev.name)}>
          {btNameLabel(dev.name)}
        </span>
        <span className="bscan__mac">{dev.mac}</span>
      </span>
      <SignalBars level={bars} />
      <span className="bscan__rssi">{dev.rssi}</span>
    </li>
  )
}

/** A 4-bar signal meter; `level` (0–4) bars are lit the accent. */
function SignalBars({ level }: { level: number }): JSX.Element {
  return (
    <span className="bscan__bars" role="img" aria-label={`Signal ${level} of ${MAX_SIGNAL_BARS}`}>
      {Array.from({ length: MAX_SIGNAL_BARS }, (_, i) => (
        <span
          key={i}
          className={`bscan__bar${i < level ? ' bscan__bar--on' : ''}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </span>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bscan__cell-readout">
      <span className="bscan__cell-lbl">{label}</span>
      <span className="bscan__cell-val">{value}</span>
    </div>
  )
}
