import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  MAX_SIGNAL_BARS,
  addWifi,
  bestWifi,
  dominantBand,
  rssiToBars,
  sortWifiByStrength,
  ssidLabel,
  type WifiTelemetry
} from './scanner-logic'
import './WifiScanInstrument.css'

/**
 * WI-FI SCAN (#121) — a signal-bar network list as a dock instrument.
 * ===================================================================
 *
 * An ON-DEMAND scanner: pressing SCAN kicks an on-device Wi-Fi scan over the
 * control channel (`SNKCMD scan:wifi`, the documented `scan:<kind>` trigger) and
 * RESETS the list. Results then arrive ONE `WifiTelemetry` reading PER NETWORK on
 * the broadcast serial stream (the shared `instrument-telemetry` parser decodes
 * each `SNK WIFI …` line); we accumulate them — deduped by SSID, keeping the
 * strongest sample — and clear the "scanning…" state on the FIRST result.
 *
 * Each row shows the SSID, a lock icon for a secured network, the signal as 0–4
 * bars (from {@link rssiToBars}) and the RSSI in dBm. The list/band/best maths
 * lives in the unit-tested, DOM-free {@link ./scanner-logic}; this file is just
 * the SCAN button, the accumulating state, and the render.
 */

export interface WifiScanInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

/** The on-device scan trigger token for Wi-Fi (documented `scan:<kind>`). */
const SCAN_TRIGGER = 'scan:wifi'

/** Treat these (case-insensitive) security tokens as an OPEN network (no lock). */
function isOpen(security: string): boolean {
  const s = security.trim().toUpperCase()
  return s === '' || s === 'OPEN' || s === 'NONE'
}

export function WifiScanInstrument({
  def,
  onClose,
  docked = true
}: WifiScanInstrumentProps): JSX.Element {
  const [nets, setNets] = useState<WifiTelemetry[]>([])
  const [scanning, setScanning] = useState(false)
  // True once a SCAN has been kicked at least once (drives the "no networks"
  // empty state vs. the initial "press SCAN" hint).
  const [scanned, setScanned] = useState(false)

  // One network per reading: accumulate (dedupe by SSID), and the first result
  // clears the scanning flag.
  useTelemetryStream(
    useCallback((reading) => {
      if (reading.kind !== 'wifi') return
      setNets((prev) => addWifi(prev, reading))
      setScanning(false)
    }, [])
  )

  const scan = useCallback(async () => {
    setNets([]) // RESET on SCAN press — a fresh sweep.
    setScanning(true)
    setScanned(true)
    try {
      await window.api.device.sendControl(SCAN_TRIGGER)
    } catch {
      setScanning(false)
    }
  }, [])

  const sorted = sortWifiByStrength(nets)
  const best = bestWifi(nets)
  const band = dominantBand(nets)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source="WLAN0"
      docked={docked}
      onClose={onClose}
    >
      <div
        className="wscan"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="instr__screen--accent">
          <div className="wscan__screen">
            {sorted.length > 0 ? (
              <ul className="wscan__list" aria-label="Wi-Fi networks">
                {sorted.map((n, i) => (
                  <WifiRow key={`${n.ssid}-${i}`} net={n} open={isOpen(n.security)} />
                ))}
              </ul>
            ) : (
              <p className="wscan__hint">
                {scanning
                  ? 'scanning…'
                  : scanned
                    ? 'No networks found — radio unavailable?'
                    : 'Press SCAN to list Wi-Fi networks'}
              </p>
            )}
            {scanning && sorted.length > 0 && <div className="wscan__scanning">scanning…</div>}
          </div>
        </PhosphorScreen>

        <div className="wscan__controls">
          <button
            type="button"
            className="wscan__scan"
            onClick={() => void scan()}
            disabled={scanning}
            title="Run a Wi-Fi scan on the connected board"
          >
            {scanning ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>

        <div className="wscan__readout">
          <Cell label="NETWORKS" value={scanning && nets.length === 0 ? '··' : String(nets.length)} />
          <span className="wscan__div" aria-hidden="true" />
          <Cell label="BEST" value={best ? `${best.rssi}` : '—'} />
          <span className="wscan__div" aria-hidden="true" />
          <Cell label="BAND" value={band} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One network row: SSID + lock icon + signal bars + RSSI. */
function WifiRow({ net, open }: { net: WifiTelemetry; open: boolean }): JSX.Element {
  const bars = rssiToBars(net.rssi)
  return (
    <li className="wscan__row">
      <span className="wscan__lock" aria-hidden="true">
        {open ? (
          <OpenIcon />
        ) : (
          <LockIcon />
        )}
      </span>
      <span className="wscan__ssid" title={ssidLabel(net.ssid)}>
        {ssidLabel(net.ssid)}
      </span>
      <SignalBars level={bars} />
      <span className="wscan__rssi">{net.rssi}</span>
    </li>
  )
}

/** A 4-bar signal meter; `level` (0–4) bars are lit the accent. */
function SignalBars({ level }: { level: number }): JSX.Element {
  return (
    <span
      className="wscan__bars"
      role="img"
      aria-label={`Signal ${level} of ${MAX_SIGNAL_BARS}`}
    >
      {Array.from({ length: MAX_SIGNAL_BARS }, (_, i) => (
        <span
          key={i}
          className={`wscan__bar${i < level ? ' wscan__bar--on' : ''}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </span>
  )
}

function LockIcon(): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="1.5" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function OpenIcon(): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-1.9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="wscan__cell-readout">
      <span className="wscan__cell-lbl">{label}</span>
      <span className="wscan__cell-val">{value}</span>
    </div>
  )
}
