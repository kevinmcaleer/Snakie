import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { useSnakiePresence } from './snakie-presence'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { I2C_DETECT_DEMO, I2C_DETECT_DEMO_NAME } from './i2c-detect-demo'
import { buildI2cGrid, formatI2cAddr, type I2cGridModel } from './scanner-logic'
import './I2cDetectInstrument.css'

/**
 * I²C DETECT (#121) — the classic `i2cdetect` 8×16 address grid as a dock
 * instrument.
 * =============================================================================
 *
 * An ON-DEMAND scanner: pressing SCAN kicks an on-device I²C bus scan over the
 * control channel (`SNKCMD scan:i2c`, the documented `scan:<kind>` trigger
 * token), and the result — every responding 7-bit address — arrives back as ONE
 * `I2cTelemetry` reading on the broadcast serial stream (the shared
 * `instrument-telemetry` parser decodes the board's `SNK I2C …` line). The grid
 * rows are the high nibble (0x00–0x70) and columns the low nibble (0x0–0xF);
 * detected cells glow the instrument accent.
 *
 * Reuses the shared {@link InstrumentWindow} chrome + {@link PhosphorScreen}
 * exactly like the scope/meter, so it sits natively in the dock. All the address
 * → cell / detected-set / grid-model maths lives in the unit-tested, DOM-free
 * {@link ./scanner-logic}; this file is just the SCAN button, the small scan
 * state machine, and the grid render.
 */

export interface I2cDetectInstrumentProps {
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

/** The on-device scan trigger token for the I²C bus (documented `scan:<kind>`). */
const SCAN_TRIGGER = 'scan:i2c'

export function I2cDetectInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: I2cDetectInstrumentProps): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { present } = useSnakiePresence()
  const { openBuffer } = useWorkspace()

  // `grid` is undefined until the first result lands; `scanning` lights the
  // "scanning…" state on SCAN and clears on the first reading.
  const [grid, setGrid] = useState<I2cGridModel | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  // Shown when SCAN can't reach the bus — no board, or no Snakie program running
  // an I²C bus to service the trigger (then we offer to run the demo). #149.
  const [prompt, setPrompt] = useState(false)
  // True while opening + running the demo (disables the prompt buttons).
  const [busy, setBusy] = useState(false)

  // The whole address set arrives in ONE `kind:'i2c'` reading, so we just rebuild
  // the grid from it and drop the scanning flag.
  useTelemetryStream(
    useCallback((reading) => {
      if (reading.kind !== 'i2c') return
      setGrid(buildI2cGrid(reading.addrs))
      setScanning(false)
    }, [])
  )

  // Kick a scan. The on-device `scan:i2c` trigger only exists when a Snakie
  // program called `inst.start(i2c=…)`; without a live program the SCAN can't
  // reach the bus, so — instead of a misleading "scanning…" that never resolves
  // (#149) — surface a prompt offering to run the I²C demo.
  const scan = useCallback(async () => {
    if (!connected || !present) {
      setPrompt(true)
      return
    }
    setPrompt(false)
    setScanning(true)
    try {
      await window.api.device.sendControl(SCAN_TRIGGER)
    } catch {
      // The send failed (no board / closed port): drop the scanning state so the
      // panel doesn't hang on "scanning…". The grid keeps its last result.
      setScanning(false)
    }
  }, [connected, present])

  // Open the I²C demo in a new tab and run it: interrupt any running program,
  // drop the demo in the editor, then paste-run it. Its `inst.start(i2c=…)`
  // registers the scan trigger (→ READY → present) and the initial scan fills the
  // grid. Mirrors the Wi-Fi scanner's demo flow.
  const runDemo = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.device.interrupt().catch(() => undefined)
      openBuffer(I2C_DETECT_DEMO_NAME, I2C_DETECT_DEMO)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.api.device.sendData(`\x05${I2C_DETECT_DEMO}\x04`)
      setPrompt(false)
      setScanning(true)
    } catch {
      setScanning(false)
    } finally {
      setBusy(false)
    }
  }, [openBuffer])

  const found = grid?.found ?? []
  const foundText = scanning && !grid ? '··' : String(found.length)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source="I2C0"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="i2cdet"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="instr__screen--accent">
          <div className="i2cdet__screen">
            {prompt ? (
              <div className="i2cdet__prompt">
                {connected ? (
                  <>
                    <p className="i2cdet__prompt-msg">
                      No Snakie program is running an I²C bus to scan.
                    </p>
                    <div className="i2cdet__prompt-actions">
                      <button
                        type="button"
                        className="i2cdet__demo"
                        onClick={() => void runDemo()}
                        disabled={busy}
                      >
                        {busy ? 'STARTING…' : '▶ Run I²C demo'}
                      </button>
                      <button
                        type="button"
                        className="i2cdet__dismiss"
                        onClick={() => setPrompt(false)}
                        disabled={busy}
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="i2cdet__prompt-hint">
                      Opens a demo that sets up an I²C bus and scans on the 2nd core — or run your
                      own program that calls <code>inst.start(i2c=…)</code>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="i2cdet__prompt-msg">Connect a board to scan the I²C bus.</p>
                    <div className="i2cdet__prompt-actions">
                      <button
                        type="button"
                        className="i2cdet__dismiss"
                        onClick={() => setPrompt(false)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : grid ? (
              <I2cGrid grid={grid} />
            ) : (
              <p className="i2cdet__hint">
                {scanning ? 'scanning…' : 'Press SCAN to probe the I²C bus'}
              </p>
            )}
            {scanning && grid && <div className="i2cdet__scanning">scanning…</div>}
          </div>
        </PhosphorScreen>

        <div className="i2cdet__controls">
          <button
            type="button"
            className="i2cdet__scan"
            onClick={() => void scan()}
            disabled={scanning}
            title="Run an I²C bus scan on the connected board"
          >
            {scanning ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>

        <div className="i2cdet__readout">
          <Cell label="FOUND" value={foundText} />
          <span className="i2cdet__div" aria-hidden="true" />
          <Cell label="SDA" value="—" />
          <span className="i2cdet__div" aria-hidden="true" />
          <Cell label="SCL" value="—" />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** The 8×16 i2cdetect grid: a column-header row, then 8 labelled rows of cells. */
function I2cGrid({ grid }: { grid: I2cGridModel }): JSX.Element {
  return (
    <div className="i2cdet__grid" role="grid" aria-label="I²C address grid">
      <div className="i2cdet__grid-head" role="row">
        <span className="i2cdet__rowlabel i2cdet__corner" aria-hidden="true" />
        {Array.from({ length: 16 }, (_, c) => (
          <span key={c} className="i2cdet__collabel" role="columnheader">
            {c.toString(16).toUpperCase()}
          </span>
        ))}
      </div>
      {grid.rows.map((row, r) => (
        <div className="i2cdet__grid-row" role="row" key={r}>
          <span className="i2cdet__rowlabel" role="rowheader">
            {(r * 16).toString(16).toUpperCase().padStart(2, '0')}
          </span>
          {row.map((cell) => (
            <span
              key={cell.addr}
              className={`i2cdet__cell${cell.detected ? ' i2cdet__cell--on' : ''}`}
              role="gridcell"
              title={cell.detected ? `Device at ${cell.label}` : cell.label}
              aria-label={cell.detected ? `${cell.label} detected` : cell.label}
            >
              {cell.detected ? formatI2cAddr(cell.addr).slice(2) : '··'}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="i2cdet__cell-readout">
      <span className="i2cdet__cell-lbl">{label}</span>
      <span className="i2cdet__cell-val">{value}</span>
    </div>
  )
}
