import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { buildI2cGrid, formatI2cAddr, type I2cGridModel } from './scanner-logic'
import { i2cOptions, i2cBuses, sdaOptions, sclOptions, type I2cOption } from './i2c-pins'
import { useBoards } from './use-boards'
import type { BoardDefinition } from '../../../shared/board'
import './I2cDetectInstrument.css'

/**
 * I²C DETECT (#121 / #165) — the classic `i2cdetect` 8×16 address grid as a dock
 * instrument.
 * =============================================================================
 *
 * The user picks the **bus + SDA + SCL** from dropdowns of the connected board's
 * valid I²C pins (#165 — invalid combos can't be chosen; see {@link ./i2c-pins}),
 * then SCAN runs a one-shot probe on the board over `device.exec`: it builds a
 * `machine.I2C` on those pins, scans, and prints the responding addresses, which
 * we parse into the grid. Works on demand — no running program needed — and the
 * address → cell maths still lives in the unit-tested {@link ./scanner-logic}.
 */

/** Sweep-playback speed (#218): ms per grid cell (128 cells ≈ 1.2 s total). */
const SWEEP_MS_PER_CELL = 9

/** GPIO numbers a board exposes (for the I²C pin dropdowns). */
function boardGpios(boards: BoardDefinition[], boardId: string | null): number[] {
  const def = boards.find((b) => b.id === boardId) ?? boards[0]
  return (def?.headers ?? [])
    .flatMap((h) => h.pins)
    .map((p) => p.gpio)
    .filter((g): g is number => typeof g === 'number')
}

/** The SCAN exec snippet: build I²C on the chosen pins, print the addresses. */
function scanSnippet(bus: number, sda: number, scl: number): string {
  return [
    'from machine import I2C, Pin',
    'try:',
    `    _b = I2C(${bus}, sda=Pin(${sda}), scl=Pin(${scl}))`,
    "    print('SNKI2C ' + ' '.join('%02x' % a for a in _b.scan()))",
    'except Exception as e:',
    "    print('SNKI2CERR ' + repr(e))"
  ].join('\n')
}

export interface I2cDetectInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

export function I2cDetectInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: I2cDetectInstrumentProps): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  // Boards sourced from the installed parts libraries (#52).
  const boards = useBoards()

  // Valid I²C combos for the selected board (the board picker persists its id).
  let boardId: string | null = null
  try {
    boardId = window.localStorage.getItem('snakie.board.id')
  } catch {
    boardId = null
  }
  const opts = i2cOptions(boardGpios(boards, boardId))
  const buses = i2cBuses(opts)

  const [sel, setSel] = useState<I2cOption>(() => opts[0] ?? { bus: 0, sda: 0, scl: 1 })
  const [grid, setGrid] = useState<I2cGridModel | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickBus = (bus: number): void => {
    const first = opts.find((o) => o.bus === bus)
    if (first) setSel(first)
  }
  const pickSda = (sda: number): void => {
    const first = opts.find((o) => o.bus === sel.bus && o.sda === sda)
    if (first) setSel(first)
  }
  const pickScl = (scl: number): void => {
    const match = opts.find((o) => o.bus === sel.bus && o.sda === sel.sda && o.scl === scl)
    if (match) setSel(match)
  }

  // Scan-sweep playback (#218): after the (fast, one-shot) device scan returns,
  // a cursor sweeps the grid cell-by-cell; detected addresses "ping" with a
  // water-ripple as the cursor crosses them. `sweep` is the cursor's flat cell
  // index (0..127), or null when idle/complete. `scanSeq` keys the grid per scan
  // so the ripple animations replay on a re-scan.
  const [sweep, setSweep] = useState<number | null>(null)
  const [scanSeq, setScanSeq] = useState(0)
  useEffect(() => {
    if (sweep === null) return
    const id = window.setInterval(() => {
      setSweep((s) => (s === null || s >= 8 * 16 ? null : s + 1))
    }, SWEEP_MS_PER_CELL)
    return () => window.clearInterval(id)
  }, [sweep === null]) // eslint-disable-line react-hooks/exhaustive-deps -- restart only on idle↔sweeping flips

  // One-shot scan on the chosen pins (no running program needed).
  const scan = useCallback(async () => {
    if (!connected) return
    setError(null)
    setScanning(true)
    try {
      const res = await window.api.device.exec(scanSnippet(sel.bus, sel.sda, sel.scl))
      const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
      const okLine = out.split('\n').find((l) => l.startsWith('SNKI2C '))
      const errLine = out.split('\n').find((l) => l.startsWith('SNKI2CERR '))
      if (okLine) {
        const addrs = okLine
          .slice('SNKI2C '.length)
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((h) => parseInt(h, 16))
        setGrid(buildI2cGrid(addrs))
        setScanSeq((n) => n + 1)
        // Play the sweep — unless the user prefers reduced motion (show at once).
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        setSweep(reduce ? null : 0)
      } else {
        setError(errLine ? errLine.slice('SNKI2CERR '.length) : 'Scan failed — check the pins/wiring.')
      }
    } catch {
      setError('Scan failed — is the board connected?')
    } finally {
      setScanning(false)
    }
  }, [connected, sel])

  const found = grid?.found ?? []
  // While the cursor sweeps, FOUND counts up as detected cells are crossed.
  const foundText =
    scanning && !grid
      ? '··'
      : sweep !== null
        ? String(found.filter((a) => a < sweep).length)
        : String(found.length)
  const noPins = opts.length === 0

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={`I2C${sel.bus}`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div className="i2cdet" style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}>
        <PhosphorScreen className="instr__screen--accent">
          <div className="i2cdet__screen">
            {!connected ? (
              <p className="i2cdet__hint">Connect a board to scan the I²C bus.</p>
            ) : error ? (
              <p className="i2cdet__hint i2cdet__error">{error}</p>
            ) : grid ? (
              <I2cGrid key={scanSeq} grid={grid} sweep={sweep} />
            ) : (
              <p className="i2cdet__hint">{scanning ? 'scanning…' : 'Pick the bus + pins, then SCAN'}</p>
            )}
            {scanning && grid && <div className="i2cdet__scanning">scanning…</div>}
          </div>
        </PhosphorScreen>

        <div className="i2cdet__controls">
          <label className="i2cdet__pick">
            <span>BUS</span>
            <select value={sel.bus} onChange={(e) => pickBus(Number(e.target.value))} disabled={noPins}>
              {buses.map((b) => (
                <option key={b} value={b}>
                  I2C{b}
                </option>
              ))}
            </select>
          </label>
          <label className="i2cdet__pick">
            <span>SDA</span>
            <select value={sel.sda} onChange={(e) => pickSda(Number(e.target.value))} disabled={noPins}>
              {sdaOptions(opts, sel.bus).map((p) => (
                <option key={p} value={p}>
                  GP{p}
                </option>
              ))}
            </select>
          </label>
          <label className="i2cdet__pick">
            <span>SCL</span>
            <select value={sel.scl} onChange={(e) => pickScl(Number(e.target.value))} disabled={noPins}>
              {sclOptions(opts, sel.bus, sel.sda).map((p) => (
                <option key={p} value={p}>
                  GP{p}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="i2cdet__scan"
            onClick={() => void scan()}
            disabled={scanning || noPins || !connected}
            title="Run an I²C bus scan on the chosen pins"
          >
            {scanning ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>

        <div className="i2cdet__readout">
          <Cell label="FOUND" value={foundText} />
          <span className="i2cdet__div" aria-hidden="true" />
          <Cell label="SDA" value={`GP${sel.sda}`} />
          <span className="i2cdet__div" aria-hidden="true" />
          <Cell label="SCL" value={`GP${sel.scl}`} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/**
 * The 8×16 i2cdetect grid: a column-header row, then 8 labelled rows of cells.
 * During the scan-sweep playback (#218) `sweep` is the cursor's flat address
 * index: the cell AT it draws as the cursor, cells past it stay unswept (dim),
 * and a detected cell pings a water-ripple as the cursor crosses it.
 * Exported for the render tests.
 */
export function I2cGrid({ grid, sweep }: { grid: I2cGridModel; sweep: number | null }): JSX.Element {
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
          {row.map((cell) => {
            const swept = sweep === null || cell.addr < sweep
            const isCursor = sweep !== null && cell.addr === sweep
            const on = cell.detected && swept
            const cls =
              `i2cdet__cell${on ? ' i2cdet__cell--on i2cdet__cell--ping' : ''}` +
              `${isCursor ? ' i2cdet__cell--cursor' : ''}${!swept && !isCursor ? ' i2cdet__cell--unswept' : ''}`
            return (
              <span
                key={cell.addr}
                className={cls}
                role="gridcell"
                title={cell.detected ? `Device at ${cell.label}` : cell.label}
                aria-label={cell.detected ? `${cell.label} detected` : cell.label}
              >
                {on ? formatI2cAddr(cell.addr).slice(2) : '··'}
              </span>
            )
          })}
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
