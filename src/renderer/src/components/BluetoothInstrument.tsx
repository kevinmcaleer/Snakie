import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
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
}

/** The on-device scan trigger token for Bluetooth (documented `scan:<kind>`). */
const SCAN_TRIGGER = 'scan:bt'

export function BluetoothInstrument({
  def,
  onClose,
  docked = true
}: BluetoothInstrumentProps): JSX.Element {
  const [devices, setDevices] = useState<BluetoothTelemetry[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)

  // One device per reading: accumulate (dedupe by MAC), and the first result
  // clears the scanning flag.
  useTelemetryStream(
    useCallback((reading) => {
      if (reading.kind !== 'bt') return
      setDevices((prev) => addBt(prev, reading))
      setScanning(false)
    }, [])
  )

  const scan = useCallback(async () => {
    setDevices([]) // RESET on SCAN press — a fresh sweep.
    setScanning(true)
    setScanned(true)
    try {
      await window.api.device.sendControl(SCAN_TRIGGER)
    } catch {
      setScanning(false)
    }
  }, [])

  const sorted = sortBtByStrength(devices)
  const nearest = nearestBt(devices)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source="BLE"
      docked={docked}
      onClose={onClose}
    >
      <div
        className="bscan"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="instr__screen--accent">
          <div className="bscan__screen">
            {sorted.length > 0 ? (
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
    <span
      className="bscan__bars"
      role="img"
      aria-label={`Signal ${level} of ${MAX_SIGNAL_BARS}`}
    >
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
