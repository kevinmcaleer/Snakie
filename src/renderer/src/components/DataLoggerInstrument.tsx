import { useCallback, useEffect, useRef, useState } from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  emptySession,
  foldReading,
  seriesKeys,
  seriesSamples,
  paperRows,
  pointsFor,
  csvFor,
  csvFilename,
  type LogSession
} from './logger-logic'
import './DataLoggerInstrument.css'

/**
 * DATA LOGGER (#242) — a vintage **dot-matrix printer** that writes the robot's
 * measurements onto tractor-feed paper.
 * =============================================================================
 *
 * Hit **RECORD** and every numeric `SNK` telemetry reading (meter, plot, dist,
 * imu, env…) is captured with a timestamp and "printed" onto continuous paper
 * scrolling out of the printer: a strip-chart per series plus periodic printed
 * value rows in a dotty printhead font. **TEAR OFF** exports the session as a
 * spreadsheet-ready CSV (the `time_s` + one-column-per-series wide format) and
 * starts a fresh sheet. All the session/CSV/paper geometry is the pure,
 * unit-tested {@link ./logger-logic}; this component is the printer chrome +
 * capture wiring.
 *
 * On-brand for the retro theme and instantly legible to kids: the robot is
 * literally *writing down* what it measures. Works fully offline against the
 * Simulated device, so a hardware-free classroom still gets real data logging.
 */

export interface DataLoggerProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
  /**
   * Seed a session (mirrors the scope's `samples` seam, #256): lets render
   * tests exercise the printed paper without a live stream (effects don't run
   * under static markup).
   */
  initialSession?: LogSession
}

/** How often the paper re-renders while recording (ms) — paint, not capture. */
const PAINT_MS = 250
/** Printed-row cadence on the paper (ms of recording per printed line). */
const PRINT_INTERVAL_MS = 1000
/** Strip-chart box (viewBox units). */
const CHART_W = 260
const CHART_H = 54

const TRACE_COLORS = ['#3a3a3a', '#5a4a2a', '#2a3a4a', '#3a2a3a', '#2a4a3a', '#4a3a2a']

export function DataLoggerInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float,
  initialSession
}: DataLoggerProps): JSX.Element {
  // The recording session lives in a ref (high-rate capture must not re-render
  // per sample); a paint tick bumps a few times a second to redraw the paper.
  const sessionRef = useRef<LogSession>(initialSession ?? emptySession())
  const startRef = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [, setPaintTick] = useState(0)
  // Bump each time we tear off, so a fresh empty session re-mounts cleanly.
  const [sheet, setSheet] = useState(0)

  useTelemetryStream(
    useCallback(
      (r) => {
        if (!recording || startRef.current === null) return
        foldReading(sessionRef.current, r, performance.now() - startRef.current)
      },
      [recording]
    )
  )

  // Repaint the paper while recording.
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setPaintTick((t) => t + 1), PAINT_MS)
    return () => window.clearInterval(id)
  }, [recording])

  const toggleRecord = useCallback((): void => {
    setRecording((on) => {
      if (!on && startRef.current === null) startRef.current = performance.now()
      return !on
    })
  }, [])

  const tearOff = useCallback((): void => {
    const csv = csvFor(sessionRef.current)
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFilename(stamp)
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Download blocked (rare) — the session still resets below.
    }
    sessionRef.current = emptySession()
    startRef.current = null
    setRecording(false)
    setSheet((s) => s + 1)
  }, [])

  const session = sessionRef.current
  const keys = seriesKeys(session)
  const hasData = session.samples.length > 0
  const duration = hasData ? session.samples[session.samples.length - 1].t : 0
  const rows = paperRows(session, PRINT_INTERVAL_MS)
  const sourcePill = recording
    ? `REC · ${keys.length} series · ${(duration / 1000).toFixed(0)}s`
    : hasData
      ? `${session.samples.length} samples`
      : 'ready'

  // The empty state is NOT an early return: RECORD must always be reachable so
  // you can arm the logger BEFORE any telemetry arrives. The printer head is
  // always shown; only the PAPER swaps between the how-to hint and the chart.
  const empty = !hasData && !recording

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={sourcePill}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div className="dlog">
        {/* The printer head: status lamp + the transport controls. */}
        <div className="dlog__head">
          <span className={`dlog__lamp${recording ? ' is-rec' : ''}`} aria-hidden="true" />
          <span className="dlog__model">SNAKIE&nbsp;DMP-242</span>
          <div className="dlog__controls">
            <button
              type="button"
              className={`dlog__btn dlog__btn--rec${recording ? ' is-active' : ''}`}
              onClick={toggleRecord}
              aria-pressed={recording}
              title={recording ? 'Pause recording' : 'Record telemetry'}
            >
              {recording ? '❚❚ PAUSE' : '● REC'}
            </button>
            <button
              type="button"
              className="dlog__btn dlog__btn--tear"
              onClick={tearOff}
              disabled={!hasData}
              title="Tear off the page — export this session as CSV"
            >
              ✂ TEAR OFF
            </button>
          </div>
        </div>

        {/* Tractor-feed paper: sprocket holes down each edge, the strip-chart at
            the top, printed value rows below, freshest at the bottom. */}
        <div className="dlog__paper-frame">
          <div className="dlog__sprockets dlog__sprockets--l" aria-hidden="true" />
          {empty ? (
            <div className="dlog__paper dlog__paper--empty">
              <div className="dlog__hint">
                <p className="dlog__hint-title">Nothing logged yet</p>
                <p className="dlog__hint-line">
                  The logger prints every reading your program streams — meter volts,
                  plotted values, distances, temperature — as a chart you can tear off
                  as a CSV.
                </p>
                <p className="dlog__hint-line">
                  Press <strong>● REC</strong>, then stream some telemetry:
                </p>
                <pre className="dlog__hint-code">
                  <code>{'import instruments as inst\n\ninst.plot(temp=t, light=l)\ninst.update()'}</code>
                </pre>
              </div>
            </div>
          ) : (
            <div className="dlog__paper" key={sheet}>
            <svg
              className="dlog__chart"
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Recorded strip chart"
            >
              {/* Faint feed lines. */}
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  className="dlog__gridline"
                  x1={0}
                  x2={CHART_W}
                  y1={CHART_H * f}
                  y2={CHART_H * f}
                />
              ))}
              {keys.map((k, i) => {
                const pts = pointsFor(seriesSamples(session, k), duration || 1, CHART_W, CHART_H)
                return pts ? (
                  <polyline
                    key={k}
                    className="dlog__trace"
                    points={pts}
                    stroke={TRACE_COLORS[i % TRACE_COLORS.length]}
                  />
                ) : null
              })}
            </svg>

            <div className="dlog__print">
              {rows.length === 0 ? (
                <p className="dlog__row dlog__row--muted">— waiting for readings —</p>
              ) : (
                rows.slice(-40).map((r) => (
                  <p className="dlog__row" key={r.t}>
                    {r.text}
                  </p>
                ))
              )}
              {recording && <p className="dlog__row dlog__caret">▮</p>}
            </div>
            </div>
          )}
          <div className="dlog__sprockets dlog__sprockets--r" aria-hidden="true" />
        </div>
      </div>
    </InstrumentWindow>
  )
}
