import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { buildTeleopPayload } from './snakie-control'
import {
  EMPTY_SNAPSHOT,
  clamp,
  defaultMapping,
  isZeroFrame,
  newOutputMapping,
  resolveTeleopFrame,
  type ButtonMapping,
  type GamepadSnapshot,
  type OutputMapping,
  type TeleopFrame
} from './gamepad-logic'
import './GamepadInstrument.css'

/**
 * GAMEPAD / TELEOP INSTRUMENT (#110) — drive a connected robot LIVE from a
 * physical gamepad (browser Gamepad API) or the on-screen sticks/sliders.
 * =============================================================================
 *
 * A self-contained dock-panel instrument body rendered through the shared
 * {@link InstrumentWindow} chrome + {@link PhosphorScreen}, exactly like the
 * scope/meter/plotter and the placeholder it replaces (#119): same
 * `{ def, onClose, docked }` prop shape, accent themed from the registry def via
 * the `--accent` / `--accent-border` CSS custom props, and a bottom 3-column
 * readout strip.
 *
 * ── How it drives the board ────────────────────────────────────────────────
 * Each animation frame it polls `navigator.getGamepads()` for a connected pad
 * (or reads the on-screen virtual sticks/sliders as a no-gamepad fallback),
 * shapes the inputs through the per-output MAPPINGS (deadzone/invert/scale/trim)
 * and the SAFETY model — all in the pure {@link resolveTeleopFrame} — and, while
 * DRIVING, streams the mapped `{name: value}` axes + pressed buttons to the
 * device, throttled to ~25 Hz, via:
 *
 *   await window.api.device.sendControl(
 *     'teleop', buildTeleopPayload(frame.axes, frame.buttons))
 *
 * which the on-device `control.axes("teleop")` / `control.pressed("teleop", b)`
 * helpers (`micropython/instruments.py`) parse. Live preview works with NO robot
 * connected — the screen shows the raw + mapped values regardless.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 *   • DEADMAN (hold-to-drive): outputs only stream while the deadman is held
 *     (pointer down on the big DRIVE pad, or the gamepad's deadman button). On
 *     release a single zero frame is sent and streaming stops.
 *   • E-STOP: a big latched button that forces every output to zero and BLOCKS
 *     all driving until explicitly reset. Sends a zero frame immediately.
 *   • DISCONNECT: if the bound gamepad disappears mid-drive, the frame resolves
 *     to all-zero (a real pad disconnect ⇒ stop), and the deadman can't be armed
 *     from a missing pad.
 * The gating math lives in `gamepad-logic.ts` and is unit-tested, so "no hold ⇒
 * nothing moves" and "E-STOP ⇒ everything zero" are guaranteed by tested code.
 */

/** ~25 Hz stream cap — one control line at most every 40 ms while driving. */
const STREAM_INTERVAL_MS = 40

export interface GamepadInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

/** Read the first connected gamepad as a flat, serialisable snapshot. */
function readGamepad(preferredIndex: number | null): {
  snap: GamepadSnapshot
  index: number | null
  id: string | null
} {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const pads = nav?.getGamepads?.() ?? []
  // Prefer the previously-bound pad if it is still present, else first non-null.
  let pad: Gamepad | null = null
  if (preferredIndex != null) pad = pads[preferredIndex] ?? null
  if (!pad) {
    for (const p of pads) {
      if (p) {
        pad = p
        break
      }
    }
  }
  if (!pad) return { snap: EMPTY_SNAPSHOT, index: null, id: null }
  return {
    snap: {
      connected: pad.connected,
      axes: Array.from(pad.axes, (a) => (typeof a === 'number' ? a : 0)),
      buttons: Array.from(pad.buttons, (b) => !!b?.pressed)
    },
    index: pad.index,
    id: pad.id
  }
}

export function GamepadInstrument({
  def,
  onClose,
  docked = true
}: GamepadInstrumentProps): JSX.Element {
  // --- Mappings (the mapping editor's state) --------------------------------
  const initial = defaultMapping()
  const [axisMappings, setAxisMappings] = useState<OutputMapping[]>(initial.axisMappings)
  const [buttonMappings, setButtonMappings] = useState<ButtonMapping[]>(initial.buttonMappings)
  const [showEditor, setShowEditor] = useState(false)

  // --- Live state shown on the screen (updated each frame) ------------------
  const [snap, setSnap] = useState<GamepadSnapshot>(EMPTY_SNAPSHOT)
  const [padId, setPadId] = useState<string | null>(null)
  const [frame, setFrame] = useState<TeleopFrame>({ axes: {}, buttons: {} })
  const [streamHz, setStreamHz] = useState(0)

  // --- Safety state ---------------------------------------------------------
  const [estop, setEstop] = useState(false)
  // Deadman from the on-screen DRIVE pad (pointer held) OR the gamepad button.
  const [padDeadman, setPadDeadman] = useState(false)

  // --- Virtual (no-gamepad) input fallback ----------------------------------
  // A 2-axis stick (vx,vy) + two extra sliders, used when no physical pad is
  // bound. Kept as a snapshot the same resolver consumes.
  const [virtual, setVirtual] = useState<{ axes: number[]; buttons: boolean[] }>({
    axes: [0, 0, 0, 0],
    buttons: [false, false, false, false]
  })

  // Refs so the rAF loop reads the latest state without re-binding each frame.
  const boundIndexRef = useRef<number | null>(null)
  const lastSentRef = useRef(0)
  const lastFrameSentRef = useRef<string | null>(null)
  const sentTimesRef = useRef<number[]>([])
  // Mirror the changing state into refs for the animation loop.
  const stateRef = useRef({
    axisMappings,
    buttonMappings,
    estop,
    padDeadman,
    virtual,
    usePhysical: false
  })
  stateRef.current = {
    axisMappings,
    buttonMappings,
    estop,
    padDeadman,
    virtual,
    usePhysical: padId != null
  }

  /** Send one resolved frame to the board (throttled, idle-deduplicated). */
  const stream = useCallback((f: TeleopFrame, now: number): void => {
    const zero = isZeroFrame(f)
    const key = buildTeleopPayload(f.axes, f.buttons)
    // Always let the FIRST stop through immediately; throttle the rest.
    const since = now - lastSentRef.current
    const sameAsLast = key === lastFrameSentRef.current
    if (sameAsLast && zero) return // already stopped — don't spam zeros
    if (!zero && since < STREAM_INTERVAL_MS) return // throttle live traffic
    lastSentRef.current = now
    lastFrameSentRef.current = key
    sentTimesRef.current.push(now)
    if (sentTimesRef.current.length > 30) sentTimesRef.current.shift()
    void window.api?.device?.sendControl?.('teleop', key)
  }, [])

  // The polling + streaming loop (requestAnimationFrame).
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const s = stateRef.current
      const phys = readGamepad(boundIndexRef.current)
      boundIndexRef.current = phys.index
      // Choose the live snapshot: a physical pad if present, else the virtual one.
      const live: GamepadSnapshot = phys.snap.connected
        ? phys.snap
        : { connected: true, axes: s.virtual.axes, buttons: s.virtual.buttons }
      setSnap(phys.snap)
      setPadId(phys.id)

      // Deadman is held when the on-screen pad is held OR a gamepad deadman
      // button (button 6 / left trigger by convention) is down.
      const padHold = phys.snap.connected ? !!phys.snap.buttons[6] : false
      const deadmanHeld = s.padDeadman || padHold

      const resolved = resolveTeleopFrame({
        snap: live,
        axisMappings: s.axisMappings,
        buttonMappings: s.buttonMappings,
        deadmanHeld,
        estop: s.estop
      })
      setFrame(resolved)

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      stream(resolved, now)

      // Live stream-rate estimate from recent send timestamps.
      const times = sentTimesRef.current
      if (times.length >= 2) {
        const span = (times[times.length - 1] - times[0]) / 1000
        setStreamHz(span > 0 ? Math.round((times.length - 1) / span) : 0)
      } else {
        setStreamHz(0)
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stream])

  // On unmount / E-STOP, push a final zero so the board can't be left driving.
  useEffect(() => {
    if (!estop) return
    void window.api?.device?.sendControl?.(
      'teleop',
      buildTeleopPayload(
        Object.fromEntries(axisMappings.map((m) => [m.name, 0])),
        Object.fromEntries(buttonMappings.map((m) => [m.name, false]))
      )
    )
  }, [estop, axisMappings, buttonMappings])

  useEffect(() => {
    return () => {
      // Best-effort stop on close: zero everything.
      void window.api?.device?.sendControl?.('teleop', 'axes=')
    }
  }, [])

  const driving = !estop && (padDeadman || (snap.connected && !!snap.buttons[6]))

  // --- Mapping editor handlers ----------------------------------------------
  const updateAxis = useCallback((i: number, patch: Partial<OutputMapping>): void => {
    setAxisMappings((prev) => prev.map((m, k) => (k === i ? { ...m, ...patch } : m)))
  }, [])
  const removeAxis = useCallback((i: number): void => {
    setAxisMappings((prev) => prev.filter((_, k) => k !== i))
  }, [])
  const addAxis = useCallback((): void => {
    setAxisMappings((prev) => [...prev, newOutputMapping(`out${prev.length + 1}`, prev.length)])
  }, [])

  const updateButton = useCallback((i: number, patch: Partial<ButtonMapping>): void => {
    setButtonMappings((prev) => prev.map((m, k) => (k === i ? { ...m, ...patch } : m)))
  }, [])
  const removeButton = useCallback((i: number): void => {
    setButtonMappings((prev) => prev.filter((_, k) => k !== i))
  }, [])
  const addButton = useCallback((): void => {
    setButtonMappings((prev) => [...prev, { name: `btn${prev.length + 1}`, index: prev.length }])
  }, [])

  const source = padId ? `PAD · ${padId.slice(0, 16)}` : 'TELEOP · virtual'

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source={source}
      docked={docked}
      onClose={onClose}
    >
      <div
        className="gp"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border
          } as CSSProperties
        }
      >
        <PhosphorScreen className="gp__screen">
          <div className="gp__screen-inner">
            {/* Connection / driving status row */}
            <div className="gp__status">
              <span className={`gp__dot ${snap.connected ? 'gp__dot--on' : ''}`} aria-hidden="true" />
              <span className="gp__status-text">
                {padId ? 'gamepad' : 'on-screen'} · {driving ? 'DRIVING' : estop ? 'E-STOP' : 'held off'}
              </span>
            </div>

            {/* The two virtual sticks/sliders fallback + the live mapped values */}
            <div className="gp__live">
              <VirtualStick
                disabled={estop}
                vx={virtual.axes[0]}
                vy={virtual.axes[1]}
                onChange={(vx, vy) =>
                  setVirtual((p) => ({ ...p, axes: [vx, vy, p.axes[2], p.axes[3]] }))
                }
              />
              <div className="gp__outputs" aria-label="Mapped outputs">
                {axisMappings.length === 0 && <span className="gp__empty">no outputs mapped</span>}
                {axisMappings.map((m) => (
                  <OutputBar key={m.name} name={m.name} value={frame.axes[m.name] ?? 0} />
                ))}
                {buttonMappings.length > 0 && (
                  <div className="gp__btns">
                    {buttonMappings.map((m) => (
                      <span
                        key={m.name}
                        className={`gp__btn ${frame.buttons[m.name] ? 'gp__btn--on' : ''}`}
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </PhosphorScreen>

        {/* --- Safety + drive controls --- */}
        <div className="gp__safety">
          <button
            type="button"
            className={`gp__deadman ${padDeadman ? 'gp__deadman--held' : ''}`}
            disabled={estop}
            onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setPadDeadman(true)
            }}
            onPointerUp={() => setPadDeadman(false)}
            onPointerCancel={() => setPadDeadman(false)}
            onPointerLeave={() => setPadDeadman(false)}
            title="Hold to drive — outputs stream only while held"
            aria-pressed={padDeadman}
          >
            <span className="gp__deadman-lbl">HOLD TO DRIVE</span>
          </button>
          <button
            type="button"
            className={`gp__estop ${estop ? 'gp__estop--latched' : ''}`}
            onClick={() => setEstop((v) => !v)}
            title={estop ? 'E-STOP latched — click to reset' : 'Emergency stop — zero all outputs'}
            aria-pressed={estop}
          >
            {estop ? 'RESET' : 'E-STOP'}
          </button>
        </div>

        {/* --- Mapping editor toggle + body --- */}
        <button
          type="button"
          className="gp__editor-toggle"
          onClick={() => setShowEditor((v) => !v)}
          aria-expanded={showEditor}
        >
          {showEditor ? '▾ hide mapping' : '▸ edit mapping'}
        </button>
        {showEditor && (
          <div className="gp__editor" role="group" aria-label="Mapping editor">
            <div className="gp__editor-head">
              <span>OUTPUT</span>
              <span>SRC</span>
              <span>DZ</span>
              <span>SCALE</span>
              <span>TRIM</span>
              <span>INV</span>
              <span />
            </div>
            {axisMappings.map((m, i) => (
              <div className="gp__editor-row" key={i}>
                <input
                  className="gp__in gp__in--name"
                  value={m.name}
                  aria-label={`Output ${i + 1} name`}
                  onChange={(e) => updateAxis(i, { name: e.target.value })}
                />
                <span className="gp__src">
                  <select
                    className="gp__in gp__in--kind"
                    value={m.kind}
                    aria-label={`Output ${i + 1} source kind`}
                    onChange={(e) => updateAxis(i, { kind: e.target.value as OutputMapping['kind'] })}
                  >
                    <option value="axis">ax</option>
                    <option value="button">btn</option>
                  </select>
                  <input
                    className="gp__in gp__in--idx"
                    type="number"
                    min={0}
                    value={m.index}
                    aria-label={`Output ${i + 1} index`}
                    onChange={(e) => updateAxis(i, { index: Number(e.target.value) || 0 })}
                  />
                </span>
                <input
                  className="gp__in gp__in--num"
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={m.deadzone}
                  aria-label={`Output ${i + 1} deadzone`}
                  onChange={(e) => updateAxis(i, { deadzone: clamp(Number(e.target.value) || 0, 0, 1) })}
                />
                <input
                  className="gp__in gp__in--num"
                  type="number"
                  step={0.05}
                  value={m.scale}
                  aria-label={`Output ${i + 1} scale`}
                  onChange={(e) => updateAxis(i, { scale: Number(e.target.value) || 0 })}
                />
                <input
                  className="gp__in gp__in--num"
                  type="number"
                  step={0.05}
                  value={m.trim}
                  aria-label={`Output ${i + 1} trim`}
                  onChange={(e) => updateAxis(i, { trim: Number(e.target.value) || 0 })}
                />
                <input
                  type="checkbox"
                  className="gp__in gp__in--chk"
                  checked={m.invert}
                  aria-label={`Output ${i + 1} invert`}
                  onChange={(e) => updateAxis(i, { invert: e.target.checked })}
                />
                <button
                  type="button"
                  className="gp__del"
                  onClick={() => removeAxis(i)}
                  aria-label={`Remove output ${m.name}`}
                  title="Remove output"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="gp__add" onClick={addAxis}>
              + add output
            </button>

            <div className="gp__editor-sub">BUTTONS</div>
            {buttonMappings.map((m, i) => (
              <div className="gp__editor-brow" key={i}>
                <input
                  className="gp__in gp__in--name"
                  value={m.name}
                  aria-label={`Button ${i + 1} name`}
                  onChange={(e) => updateButton(i, { name: e.target.value })}
                />
                <input
                  className="gp__in gp__in--idx"
                  type="number"
                  min={0}
                  value={m.index}
                  aria-label={`Button ${i + 1} index`}
                  onChange={(e) => updateButton(i, { index: Number(e.target.value) || 0 })}
                />
                <button
                  type="button"
                  className="gp__del"
                  onClick={() => removeButton(i)}
                  aria-label={`Remove button ${m.name}`}
                  title="Remove button"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="gp__add" onClick={addButton}>
              + add button
            </button>
          </div>
        )}

        {/* --- Bottom 3-column readout strip --- */}
        <div className="gp__readout">
          <Cell label="OUTPUTS" value={String(axisMappings.length)} />
          <span className="gp__div" aria-hidden="true" />
          <Cell label="STATE" value={estop ? 'E-STOP' : driving ? 'driving' : 'standby'} />
          <span className="gp__div" aria-hidden="true" />
          <Cell label="RATE" value={`${driving ? streamHz : 0} Hz`} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One mapped-output magnitude bar (centre-origin, ±1). */
function OutputBar({ name, value }: { name: string; value: number }): JSX.Element {
  const pct = clamp(value) * 50 // half-width either side of centre
  return (
    <div className="gp__out">
      <span className="gp__out-name">{name}</span>
      <span className="gp__out-track" aria-hidden="true">
        <span
          className="gp__out-fill"
          style={{
            left: pct >= 0 ? '50%' : `${50 + pct}%`,
            width: `${Math.abs(pct)}%`
          }}
        />
      </span>
      <span className="gp__out-val">{value.toFixed(2)}</span>
    </div>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="gp__cell">
      <span className="gp__cell-lbl">{label}</span>
      <span className="gp__cell-val">{value}</span>
    </div>
  )
}

/**
 * The on-screen virtual stick (no-gamepad fallback): a draggable knob inside a
 * round gate, reporting (vx, vy) in [-1, 1]. Spring-returns to centre on release
 * so it can't be left "stuck" driving. Disabled while E-STOP is latched.
 */
function VirtualStick({
  vx,
  vy,
  disabled,
  onChange
}: {
  vx: number
  vy: number
  disabled: boolean
  onChange: (vx: number, vy: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const setFromEvent = useCallback(
    (clientX: number, clientY: number): void => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const nx = clamp(((clientX - cx) / (r.width / 2)) * 1)
      const ny = clamp(((clientY - cy) / (r.height / 2)) * 1)
      onChange(nx, ny)
    },
    [onChange]
  )

  return (
    <div
      ref={ref}
      className={`gp__stick ${disabled ? 'gp__stick--off' : ''}`}
      role="slider"
      aria-label="Virtual joystick"
      aria-valuetext={`x ${vx.toFixed(2)}, y ${vy.toFixed(2)}`}
      onPointerDown={(e) => {
        if (disabled) return
        draggingRef.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setFromEvent(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setFromEvent(e.clientX, e.clientY)
      }}
      onPointerUp={(e) => {
        draggingRef.current = false
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        onChange(0, 0)
      }}
      onPointerCancel={() => {
        draggingRef.current = false
        onChange(0, 0)
      }}
    >
      <span className="gp__stick-cross" aria-hidden="true" />
      <span
        className="gp__stick-knob"
        style={{ left: `${50 + vx * 40}%`, top: `${50 + vy * 40}%` }}
        aria-hidden="true"
      />
    </div>
  )
}
