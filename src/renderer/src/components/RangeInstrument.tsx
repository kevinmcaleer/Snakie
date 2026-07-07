import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reporter } from '../lib/report-error'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { InstrumentRequirement } from './InstrumentRequirement'
import type { InstrumentDef } from './range-instrument-def'
import { useTelemetryStream, type DistanceTelemetry } from './range-telemetry'
import { useSnakiePresence } from './snakie-presence'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { rangeDemo, RANGE_DEMO_NAME } from './range-demo'
import {
  blipOpacity,
  classifyProximity,
  clampRange,
  DEFAULT_MAX_MM,
  findRangePinsInCode,
  formatRange,
  historyPath,
  HISTORY_CAP,
  isNoEcho,
  polarToPoint,
  pushBlip,
  pushHistory,
  rangePinsPayload,
  setRangePinsInCode,
  SWEEP_TRAIL,
  type RadarBlip,
  type RangeUnit
} from './range-logic'
import './RangeInstrument.css'

/**
 * RANGE — a skeuomorphic distance-sensor RADAR instrument (issue #112).
 * =============================================================================
 *
 * A SELF-CONTAINED dock panel for a ToF / ultrasonic distance sensor, driven by
 * the board PRINTING `SNK DIST <ch> <mm> [<angle>]` lines (passive, always-on, no
 * REPL interruption — see {@link ./range-telemetry}). It renders in one of two
 * modes, chosen automatically by whether readings carry a sweep `angle`:
 *
 *   - SINGLE sensor (no `angle`)  → a RANGE GAUGE (a sweep needle on a 180° arc)
 *     plus a rolling HISTORY graph of distance over time.
 *   - SWEPT sensor (`angle` present) → a POLAR RADAR sweep plotting distance vs.
 *     angle with FADING persistence trails (older blips dim toward the rim).
 *
 * The user configures the MAX RANGE, the display UNITS (mm / cm), and a PROXIMITY
 * ALERT threshold that highlights close obstacles (the gauge / blips turn the
 * alert colour, and the readout flips to an ALERT state). Out-of-range / no-echo
 * readings (mm = 0 or beyond max) clear the blip and show "NO ECHO".
 *
 * All the maths (polar→cartesian, the history ring, proximity classification,
 * mm↔cm, no-echo detection, the fade) is the pure, unit-tested {@link ./range-logic};
 * this component is the chrome + the telemetry plumbing.
 */

/** Radar screen geometry (matches the green-screen aspect used by the scope). */
const SCREEN_W = 358
const SCREEN_H = 172
const RADAR_PAD = 14

/** Selectable max-range presets (mm). */
const MAX_PRESETS: { mm: number; label: string }[] = [
  { mm: 500, label: '0.5 m' },
  { mm: 1000, label: '1 m' },
  { mm: 2000, label: '2 m' },
  { mm: DEFAULT_MAX_MM, label: '4 m' }
]

/** A short, theme-able cell in the bottom readout strip. */
function Cell({
  label,
  value,
  pad,
  alert
}: {
  label: string
  value: string
  pad?: boolean
  alert?: boolean
}): JSX.Element {
  return (
    <div
      className={`range__cell ${pad ? 'range__cell--pad' : ''} ${alert ? 'range__cell--alert' : ''}`}
    >
      <span className="range__cell-lbl">{label}</span>
      <span className="range__cell-val">{value}</span>
    </div>
  )
}

/** GPIO numbers the TRIG / ECHO selectors offer (GP0–GP28, the Pico range). */
const GP_PINS = Array.from({ length: 29 }, (_, i) => i)

/** Fire-and-forget a `range` control line; swallow errors so the UI never throws. */
function sendRange(payload: string): void {
  try {
    void window.api?.device?.sendControl?.('range', payload)?.catch(reporter('range send'))
  } catch {
    /* offline / no device — the radar still renders any telemetry it has. */
  }
}

export function RangeInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}): JSX.Element {
  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const { present } = useSnakiePresence()
  const { openBuffer, openFiles, activeId, updateContent } = useWorkspace()

  // The active editor buffer (if any) — the target for the code-sync update + the
  // source we scan for declared RANGE_TRIG / RANGE_ECHO pins to warn on a mismatch.
  const activeFile = useMemo(
    () => openFiles.find((f) => f.id === activeId) ?? null,
    [openFiles, activeId]
  )

  // Sticky "a Snakie program has serviced control this session" flag (mirrors the
  // Buzzer panel): presence is detected from the `SNK READY` heartbeat, which can
  // briefly lapse — and a hard `present` gate would then silently DROP a retarget
  // even though the program is running. So once we've seen a program, we keep
  // sending; a board that has NEVER run one (a bare REPL) still gets nothing (a
  // SNKCMD there just SyntaxErrors). Reset on disconnect.
  const everPresent = useRef(false)
  useEffect(() => {
    if (present) everPresent.current = true
  }, [present])
  useEffect(() => {
    if (!connected) everPresent.current = false
  }, [connected])

  // Only WRITE to the board when connected AND a Snakie program has serviced the
  // control channel (now, or earlier this session).
  const txRange = useCallback(
    (payload: string): void => {
      if (connected && (present || everPresent.current)) sendRange(payload)
    },
    [connected, present]
  )

  // --- pin selectors --------------------------------------------------------
  // The HC-SR04 trig (OUT) + echo (IN) pins the panel drives. Defaults match the
  // demo's RANGE_TRIG / RANGE_ECHO so "Run range demo" lines up out of the box.
  const [trig, setTrig] = useState<number>(3)
  const [echo, setEcho] = useState<number>(2)
  // Shown when a retarget can't reach a live program (offer to run the demo).
  const [prompt, setPrompt] = useState(false)
  // True while opening + running the demo (disables the prompt buttons).
  const [busy, setBusy] = useState(false)

  // --- user configuration ---------------------------------------------------
  const [maxMm, setMaxMm] = useState<number>(2000)
  const [unit, setUnit] = useState<RangeUnit>('cm')
  // Proximity-alert threshold (mm). Default a quarter of a typical 2 m range.
  const [threshold, setThreshold] = useState<number>(300)

  // --- live telemetry state -------------------------------------------------
  const [latest, setLatest] = useState<DistanceTelemetry | null>(null)
  // Single-sensor rolling history (mm), and swept-sensor fading persistence trail.
  const [history, setHistory] = useState<number[]>([])
  const [trail, setTrail] = useState<RadarBlip[]>([])
  // Whether ANY reading so far carried a sweep angle → swept (radar) mode.
  const [swept, setSwept] = useState(false)
  // Min valid distance seen this session (mm), for the readout's MIN cell.
  const [minMm, setMinMm] = useState<number | null>(null)
  const seqRef = useRef(0)

  // The passive `SNK DIST` subscription (singleton stream). Fold each reading into
  // the latest value + the appropriate accumulator. No-echo readings still update
  // `latest` (so the UI can show "NO ECHO") but don't pollute MIN / the trail.
  const onReading = useCallback(
    (r: DistanceTelemetry) => {
      setLatest(r)
      const noEcho = isNoEcho(r.mm, maxMm)
      if (r.angle !== undefined) {
        setSwept(true)
        const seq = ++seqRef.current
        setTrail((t) => pushBlip(t, r.angle as number, r.mm, seq, maxMm))
      } else {
        setHistory((h) => pushHistory(h, noEcho ? 0 : r.mm))
      }
      if (!noEcho) {
        setMinMm((m) => (m === null || r.mm < m ? r.mm : m))
      }
    },
    [maxMm]
  )
  useTelemetryStream(onReading)

  // --- derived values for the readout ---------------------------------------
  const mm = latest?.mm ?? 0
  const noEcho = latest === null || isNoEcho(mm, maxMm)
  const prox = classifyProximity(mm, threshold, maxMm)
  const alert = prox === 'near'
  const accent = alert ? '#ff6b6b' : def.accent

  const rangeText = latest === null ? '—' : formatRange(mm, unit, maxMm)
  // Split "<number> <unit>" so the big on-screen readout can size the number and
  // unit independently (matches the mockup's prominent right-aligned figure).
  const [rangeNum, rangeUnit] = rangeText.includes(' ')
    ? [rangeText.slice(0, rangeText.indexOf(' ')), rangeText.slice(rangeText.indexOf(' ') + 1)]
    : [rangeText, '']
  const angleText =
    latest?.angle !== undefined ? `${Math.round(latest.angle)}°` : swept ? '—' : 'FIXED'
  const minText = minMm === null ? '—' : formatRange(minMm, unit, maxMm)

  // --- radar / gauge geometry (pure) ----------------------------------------
  const geom = useMemo(
    () => ({ width: SCREEN_W, height: SCREEN_H, maxMm, pad: RADAR_PAD }),
    [maxMm]
  )

  // The current blip / needle tip (apex when no echo → not drawn).
  const tip = useMemo(() => {
    if (noEcho) return null
    const angle = latest?.angle ?? 90 // fixed sensor points straight up
    return polarToPoint(angle, mm, geom)
  }, [noEcho, latest?.angle, mm, geom])

  const apex = useMemo(() => polarToPoint(90, 0, geom), [geom])

  // Range rings at ¼ / ½ / ¾ / full of max range.
  const rings = useMemo(() => {
    const r = Math.min(SCREEN_W / 2 - RADAR_PAD, SCREEN_H - RADAR_PAD)
    return [0.25, 0.5, 0.75, 1].map((f) => r * f)
  }, [])

  // The single-sensor history polyline.
  const histPoints = useMemo(
    () => historyPath(history, SCREEN_W, SCREEN_H, maxMm),
    [history, maxMm]
  )

  const newestSeq = seqRef.current

  // --- pin retarget: send `range pins <trig> <echo>` to the board live ---------
  // Both selectors share one send (the receiver takes the pair atomically); a
  // retarget that can't reach a live program surfaces the demo prompt.
  const retarget = useCallback(
    (t: number, e: number): void => {
      txRange(rangePinsPayload(t, e))
      setPrompt(connected && !present && !everPresent.current)
    },
    [txRange, connected, present]
  )

  const onTrigChange = useCallback(
    (next: number): void => {
      setTrig(next)
      retarget(next, echo)
    },
    [echo, retarget]
  )

  const onEchoChange = useCallback(
    (next: number): void => {
      setEcho(next)
      retarget(trig, next)
    },
    [trig, retarget]
  )

  // --- demo fallback (mirror BuzzerInstrument.runDemo) ------------------------
  // Open the range demo in a new tab and run it: interrupt any running program
  // (back to a REPL prompt), drop the demo in the editor, then paste-run it. The
  // demo's inst.start(range_trig=…, range_echo=…) brings the control service up
  // (→ READY → present) so the panel's selectors retarget the live sensor.
  const runDemo = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const src = rangeDemo(trig, echo) // wire the demo to the panel's pins
      await window.api.device.interrupt().catch(() => undefined)
      openBuffer(RANGE_DEMO_NAME, src)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.api.device.sendData(`\x05${src}\x04`)
      setPrompt(false)
    } catch {
      /* offline — the prompt stays dismissable; the radar still renders. */
    } finally {
      setBusy(false)
    }
  }, [openBuffer, trig, echo])

  // --- pin mismatch: warn when the open code targets different trig/echo pins --
  // The numeric RANGE_TRIG / RANGE_ECHO declared in the active editor buffer, or
  // null when the code declares none (no warning for that role). When either
  // differs from the panel's pin we surface a one-click sync.
  const codePins = useMemo(
    () => (activeFile ? findRangePinsInCode(activeFile.content) : { trig: null, echo: null }),
    [activeFile]
  )
  const trigMismatch = codePins.trig !== null && codePins.trig !== trig
  const echoMismatch = codePins.echo !== null && codePins.echo !== echo
  const pinsMismatch = trigMismatch || echoMismatch

  /** Rewrite the active buffer's RANGE_TRIG / RANGE_ECHO to the panel's pins. */
  const onUpdateCodePins = useCallback((): void => {
    if (!activeFile) return
    updateContent(activeFile.id, setRangePinsInCode(activeFile.content, trig, echo))
  }, [activeFile, trig, echo, updateContent])

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source="ToF · ULTRASONIC"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="range"
        style={
          {
            '--accent': accent,
            '--accent-border': def.border
          } as React.CSSProperties
        }
      >
        {/* No `SNK DIST` telemetry yet → the shared how-to panel in place of an
            empty gauge (#257 increment 2). The wiring footer + demo prompt below
            stay mounted, so the pin pickers and "Run range demo" remain reachable. */}
        {latest === null ? (
          <InstrumentRequirement
            title="No distance readings yet"
            lines={[
              'The radar draws anything your program measures with a rangefinder (HC-SR04, ToF). Feed it distance telemetry and the sweep begins — or use the HC-SR04 pin pickers below to retarget a running program.'
            ]}
            code={
              'import instruments as inst\nimport time\n\nwhile True:\n    mm = read_my_sensor()   # HC-SR04 / VL53L0X…\n    inst.distance(mm)       # feeds this radar\n    time.sleep(0.1)'
            }
            helpId={`inst-${def.id}`}
            accent={def.accent}
          />
        ) : (
        <PhosphorScreen className="range__screen">
          <svg
            className="range__svg"
            viewBox={`0 0 ${SCREEN_W} ${SCREEN_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <filter id="range-glow" x="-30%" y="-40%" width="160%" height="180%">
                <feGaussianBlur stdDeviation="1.8" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {swept ? (
              <>
                {/* --- SWEPT: polar radar dome --- */}
                {/* Range rings (concentric 180° arcs). */}
                <g fill="none" stroke="rgba(120,220,150,.16)" strokeWidth="1">
                  {rings.map((rr, i) => (
                    <path
                      key={`ring${i}`}
                      d={`M ${apex.x - rr} ${apex.y} A ${rr} ${rr} 0 0 1 ${apex.x + rr} ${apex.y}`}
                    />
                  ))}
                </g>
                {/* Bearing spokes at 0/45/90/135/180°. */}
                <g stroke="rgba(120,220,150,.14)" strokeWidth="1">
                  {[0, 45, 90, 135, 180].map((a) => {
                    const p = polarToPoint(a, maxMm, geom)
                    return <line key={`spoke${a}`} x1={apex.x} y1={apex.y} x2={p.x} y2={p.y} />
                  })}
                </g>

                {/* Fading persistence blips (older → dimmer). */}
                {trail.map((b) => {
                  const p = polarToPoint(b.angle, b.mm, geom)
                  const near = classifyProximity(b.mm, threshold, maxMm) === 'near'
                  return (
                    <circle
                      key={`blip${b.seq}`}
                      cx={p.x}
                      cy={p.y}
                      r={near ? 3.4 : 2.6}
                      fill={near ? '#ff6b6b' : 'var(--accent)'}
                      opacity={blipOpacity(b.seq, newestSeq)}
                      filter="url(#range-glow)"
                    />
                  )
                })}

                {/* The live sweep ray + current blip. */}
                {tip && (
                  <>
                    <line
                      x1={apex.x}
                      y1={apex.y}
                      x2={tip.x}
                      y2={tip.y}
                      stroke="var(--accent)"
                      strokeWidth="1.4"
                      opacity="0.7"
                      filter="url(#range-glow)"
                    />
                    <circle cx={tip.x} cy={tip.y} r="4.2" fill={accent} filter="url(#range-glow)" />
                  </>
                )}
              </>
            ) : (
              <>
                {/* --- SINGLE: gauge arc + needle + history graph --- */}
                {/* Gauge range rings. */}
                <g fill="none" stroke="rgba(120,220,150,.16)" strokeWidth="1">
                  {rings.map((rr, i) => (
                    <path
                      key={`gring${i}`}
                      d={`M ${apex.x - rr} ${apex.y} A ${rr} ${rr} 0 0 1 ${apex.x + rr} ${apex.y}`}
                    />
                  ))}
                </g>

                {/* Faint distance-over-time history trace behind the gauge. */}
                {histPoints && (
                  <polyline
                    points={histPoints}
                    fill="none"
                    stroke="rgba(130,230,160,.30)"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}

                {/* The gauge needle to the current distance (hidden on no-echo). */}
                {tip && (
                  <>
                    <line
                      x1={apex.x}
                      y1={apex.y}
                      x2={tip.x}
                      y2={tip.y}
                      stroke="var(--accent)"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      filter="url(#range-glow)"
                    />
                    <circle cx={tip.x} cy={tip.y} r="4.4" fill={accent} filter="url(#range-glow)" />
                  </>
                )}
                <circle cx={apex.x} cy={apex.y} r="3" fill="rgba(130,230,160,.5)" />
              </>
            )}
          </svg>

          {/* On-screen labels (HTML over the SVG). */}
          <span className="range__lbl range__lbl--mode">{swept ? 'RADAR' : 'GAUGE'}</span>
          <span
            className={`range__lbl range__lbl--state ${alert ? 'is-alert' : ''} ${noEcho ? 'is-idle' : ''}`}
          >
            <span className="range__state-dot" />
            {noEcho ? 'NO ECHO' : alert ? 'ALERT' : 'CLEAR'}
          </span>
          <span className="range__lbl range__lbl--max">
            MAX {formatRange(clampRange(maxMm, maxMm), unit, maxMm + 1)}
          </span>

          {/* The current distance as a big, right-aligned figure (per the mockup).
              For a fixed sensor this is the headline reading; it sits over the
              gauge and turns the alert colour when an obstacle is within range. */}
          <div className={`range__big ${alert ? 'is-alert' : ''} ${noEcho ? 'is-idle' : ''}`}>
            <span className="range__big-num">{rangeNum}</span>
            {rangeUnit && <span className="range__big-unit">{rangeUnit}</span>}
          </div>
        </PhosphorScreen>
        )}

        {/* Demo prompt — shown when a TRIG/ECHO retarget can't reach a live program. */}
        {prompt && (
          <div className="range__prompt" role="alert">
            {connected ? (
              <>
                <p className="range__prompt-msg">
                  No Snakie program is running to drive the rangefinder.
                </p>
                <div className="range__prompt-actions">
                  <button
                    type="button"
                    className="range__btn range__btn--play"
                    onClick={() => void runDemo()}
                    disabled={busy}
                  >
                    {busy ? 'STARTING…' : '▶ Run range demo'}
                  </button>
                  <button
                    type="button"
                    className="range__btn"
                    onClick={() => setPrompt(false)}
                    disabled={busy}
                  >
                    Dismiss
                  </button>
                </div>
                <p className="range__prompt-hint">
                  The radar reads any board printing <code>SNK DIST</code>; to retarget the
                  sensor&apos;s pins, open the demo (or run your own program calling{' '}
                  <code>
                    inst.start(range_trig={trig}, range_echo={echo})
                  </code>{' '}
                  + <code>inst.control.poll()</code>).
                </p>
              </>
            ) : (
              <>
                <p className="range__prompt-msg">Connect a board to drive the rangefinder.</p>
                <div className="range__prompt-actions">
                  <button type="button" className="range__btn" onClick={() => setPrompt(false)}>
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Sensor wiring: TRIG / ECHO pin selectors + a live program status pill. The
            selectors send `SNKCMD range pins <trig> <echo>` to retarget the board. */}
        <div className="range__wiring">
          <div className="range__wiring-head">
            <span className="range__wiring-title">HC-SR04</span>
            <span
              className={`range__live ${
                !connected
                  ? 'range__live--off'
                  : present
                    ? 'range__live--on'
                    : 'range__live--idle'
              }`}
              title={
                !connected
                  ? 'No board connected — the radar shows only telemetry it has received.'
                  : present
                    ? 'A Snakie program is running and servicing the rangefinder — the selectors retarget the board.'
                    : 'No Snakie program detected. Run the range demo (or a program that calls inst.start(range_trig=…, range_echo=…) + inst.control.poll()).'
              }
            >
              <span className="range__live-dot" aria-hidden="true" />
              {!connected ? 'no board' : present ? 'program live' : 'no program'}
            </span>
          </div>
          <div className="range__pins">
            <label className="range__field">
              <span className="range__field-lbl">TRIG</span>
              <select
                className="range__select"
                value={trig}
                onChange={(e) => onTrigChange(Number(e.target.value))}
                aria-label="HC-SR04 trigger pin"
              >
                {GP_PINS.map((p) => (
                  <option key={p} value={p}>
                    GP{p}
                  </option>
                ))}
              </select>
            </label>
            <label className="range__field">
              <span className="range__field-lbl">ECHO</span>
              <select
                className="range__select"
                value={echo}
                onChange={(e) => onEchoChange(Number(e.target.value))}
                aria-label="HC-SR04 echo pin"
              >
                {GP_PINS.map((p) => (
                  <option key={p} value={p}>
                    GP{p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* Pin-mismatch strip: the panel retargets the board live (onTrig/EchoChange),
              but the open code may still declare different RANGE_TRIG / RANGE_ECHO. Offer
              a one-click sync to rewrite the code to match the panel. */}
          {pinsMismatch && (
            <div className="range__pinwarn" role="status">
              <span className="range__pinwarn-msg">
                Panel pins (TRIG GP{trig} · ECHO GP{echo}) differ from your code
                {trigMismatch ? ` (TRIG GP${codePins.trig})` : ''}
                {echoMismatch ? ` (ECHO GP${codePins.echo})` : ''}
              </span>
              <button
                type="button"
                className="range__btn range__pinwarn-btn"
                onClick={onUpdateCodePins}
                title={`Rewrite RANGE_TRIG / RANGE_ECHO in your code to GP${trig} / GP${echo}`}
              >
                Update code
              </button>
            </div>
          )}
        </div>

        {/* Controls: max-range presets, units toggle, threshold stepper. */}
        <div className="range__controls">
          <label className="range__field">
            <span className="range__field-lbl">RANGE</span>
            <select
              className="range__select"
              value={maxMm}
              onChange={(e) => setMaxMm(Number(e.target.value))}
              aria-label="Maximum range"
            >
              {MAX_PRESETS.map((p) => (
                <option key={p.mm} value={p.mm}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="range__units" role="group" aria-label="Display units">
            {(['mm', 'cm'] as RangeUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                className={`range__unit ${unit === u ? 'is-active' : ''}`}
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>

          <label className="range__field">
            <span className="range__field-lbl">ALERT</span>
            <input
              className="range__input"
              type="number"
              min={0}
              step={10}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Proximity alert threshold (mm)"
            />
            <span className="range__field-unit">mm</span>
          </label>
        </div>

        {/* Readout strip: RANGE / ANGLE / MIN (or ALERT state). */}
        <div className="range__readout">
          <Cell label={alert ? 'ALERT' : 'RANGE'} value={rangeText} alert={alert} />
          <span className="range__div" aria-hidden="true" />
          <Cell label="ANGLE" value={angleText} pad />
          <span className="range__div" aria-hidden="true" />
          <Cell label="MIN" value={minText} pad />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** Re-export the descriptor so a host can `import { RANGE_DEF }` alongside the panel. */
export { RANGE_DEF } from './range-instrument-def'
/** Re-export so the buffer caps are discoverable next to the component. */
export { HISTORY_CAP, SWEEP_TRAIL }
