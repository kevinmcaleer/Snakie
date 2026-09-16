import { useCallback, useEffect, useRef, useState } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { InstrumentRequirement } from './InstrumentRequirement'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import type { Telemetry, TurtleTelemetry } from './instrument-telemetry'
import type { InstrumentDef } from './instruments-registry'
import {
  DEFAULT_TURTLE_SPEED,
  formatCoord,
  headingToRadians,
  INITIAL_TURTLE_STATE,
  isTurtleState,
  playTurtleStep,
  turtleStepMs,
  worldToCanvas,
  type TurtleState
} from './turtle-logic'
import './TurtleInstrument.css'

/**
 * TURTLE — a Logo-style turtle graphics instrument (issue #1003).
 * =============================================================================
 *
 * Draws whatever `micropython/turtle.py` reports over the passive `SNK TURT
 * ...` telemetry channel (see {@link ./instrument-telemetry}'s `TurtleTelemetry`
 * and {@link ./turtle-logic}'s `reduceTurtle`). Non-invasive like every other
 * instrument here: it reads the broadcast serial stream, so a running
 * `forward()`/`right()` loop draws live without interrupting the REPL.
 *
 * The turtle's own coordinates are WORLD units (origin canvas-centre, y-up,
 * compass heading); {@link worldToCanvas} maps them onto the actual canvas
 * (origin top-left, y-down) at render time — the same hand-rolled canvas
 * pattern as {@link ./Plotter} (no charting/drawing dependency).
 */

const CLEAR_TITLE = 'Clear the turtle canvas (does not move the turtle)'
const SPEED_TITLE = 'How fast the drawing is animated — 0 draws it instantly'

/**
 * How often the playback clock looks for work when there is none (ms).
 *
 * The idle case, so it has to be cheap rather than fast: a sixteenth of a
 * second is imperceptible at the start of a drawing and costs nothing while a
 * learner sits reading their code.
 */
const IDLE_POLL_MS = 60

export function TurtleInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<TurtleState>(INITIAL_TURTLE_STATE)
  const dirty = useRef(false)
  const rafRef = useRef<number | null>(null)
  const [started, setStarted] = useState(false)
  // Mirror of the state pieces the readout strip needs (kept separate from the
  // high-rate `stateRef` so a fast-drawing program doesn't thrash React —
  // updated on the same low-frequency cadence as the canvas repaint).
  const [readout, setReadout] = useState({ x: 0, y: 0, heading: 0, pen: true, segments: 0 })

  // ── WATCHING IT DRAW (#1046) ──────────────────────────────────────────────
  //
  // Readings used to be folded into the state the instant they arrived, and a
  // board emits a square's four sides faster than an eye can follow — so the
  // picture appeared all at once, finished, with nothing to watch. They queue
  // here instead, and the effect below drains them at the pace `speed()` asked
  // for. `turtle-logic.ts` holds the pure half; this holds the clock.
  const pendingRef = useRef<TurtleTelemetry[]>([])
  const [speed, setSpeed] = useState(DEFAULT_TURTLE_SPEED)
  const speedRef = useRef(speed)
  speedRef.current = speed
  /**
   * The learner moved the slider, so the program stops overriding it.
   *
   * Without this, a program that calls `speed()` in a loop would drag the
   * slider back out from under their hand every pass.
   */
  const ownSpeedRef = useRef(false)

  const onReading = useCallback(
    (reading: Telemetry) => {
      if (reading.kind !== 'turtle') return
      if (!started) setStarted(true)
      // Queued rather than applied, INCLUDING the speed: a program that says
      // `speed(1); forward(50); speed(10); forward(50)` means the first move
      // slowly and the second fast, and applying the speed on arrival would
      // play both at whatever it ended on.
      pendingRef.current.push(reading)
    },
    [started]
  )
  useTelemetryStream(onReading)

  // The playback clock. One movement per tick, waiting `turtleStepMs(speed)`
  // between them; instantaneous readings ride along with the next movement so
  // a `penup()`/`pendown()` pair never looks like a hang.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const tick = (): void => {
      if (stopped) return
      const queued = pendingRef.current
      if (queued.length === 0) {
        // Nothing to play. Look again soon — this is the idle case, and it has
        // to be cheap rather than fast.
        timer = setTimeout(tick, IDLE_POLL_MS)
        return
      }
      pendingRef.current = []
      const frame = playTurtleStep(stateRef.current, queued, speedRef.current)
      stateRef.current = frame.state
      dirty.current = true
      // Put the remainder back IN FRONT of anything that arrived while we were
      // working, or a fast-drawing program would play out of order.
      if (frame.rest.length > 0) pendingRef.current = [...frame.rest, ...pendingRef.current]
      // A `speed` reading in that frame is the program talking, so it moves the
      // slider — unless the learner has taken the slider over.
      if (frame.speed !== speedRef.current && !ownSpeedRef.current) setSpeed(frame.speed)
      timer = setTimeout(tick, frame.waitMs > 0 ? frame.waitMs : IDLE_POLL_MS)
    }
    tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Restore the last-drawn picture on mount (issue: undocking/redocking used to
  // remount a fresh component with an empty canvas, losing everything drawn so
  // far even though the picture was still "there"). `turtleStateGet` reads a
  // buffer shared between the docked instrument and its detached popup (the
  // main process on desktop, the editor window's closure on web — see
  // `src/main/index.ts` / `web/install-web-api.ts`), so whichever one mounts
  // next picks up exactly where the other left off. A malformed/absent buffer
  // (first-ever open, an older Snakie version) is just ignored — the "no
  // drawing yet" panel stays up until the next real reading, as before.
  useEffect(() => {
    let cancelled = false
    void window.api.instruments
      .turtleStateGet()
      .then((persisted) => {
        if (cancelled || !isTurtleState(persisted)) return
        stateRef.current = persisted
        setStarted(true)
        dirty.current = true
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const handleClear = useCallback(() => {
    stateRef.current = { ...stateRef.current, segments: [] }
    dirty.current = true
    void window.api.instruments.turtleStateSet(stateRef.current).catch(() => undefined)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      dirty.current = true
    }

    const draw = (): void => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width
      const h = canvas.height
      const dpr = window.devicePixelRatio || 1
      const s = stateRef.current

      ctx.clearRect(0, 0, w, h)

      // Faint centre crosshair — the origin, so a beginner sees where (0, 0) is.
      ctx.strokeStyle = 'rgba(120,220,150,.14)'
      ctx.lineWidth = 1 * dpr
      const origin = worldToCanvas(0, 0, w, h)
      ctx.beginPath()
      ctx.moveTo(origin.x - 10 * dpr, origin.y)
      ctx.lineTo(origin.x + 10 * dpr, origin.y)
      ctx.moveTo(origin.x, origin.y - 10 * dpr)
      ctx.lineTo(origin.x, origin.y + 10 * dpr)
      ctx.stroke()

      // Drawn segments, each in the pen colour it was drawn with.
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const seg of s.segments) {
        const p1 = worldToCanvas(seg.x1, seg.y1, w, h)
        const p2 = worldToCanvas(seg.x2, seg.y2, w, h)
        ctx.strokeStyle = seg.colour
        ctx.lineWidth = Math.max(1, seg.width) * dpr
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }

      // The turtle sprite itself: a small triangle pointing along `heading`
      // (0 = up), hidden when the program called `hideturtle()`.
      if (s.visible) {
        const p = worldToCanvas(s.x, s.y, w, h)
        const size = 9 * dpr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(headingToRadians(s.heading))
        ctx.beginPath()
        ctx.moveTo(0, -size)
        ctx.lineTo(size * 0.62, size * 0.8)
        ctx.lineTo(0, size * 0.42)
        ctx.lineTo(-size * 0.62, size * 0.8)
        ctx.closePath()
        ctx.fillStyle = s.pen ? '#6fce7f' : 'rgba(111,206,127,.5)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,.35)'
        ctx.lineWidth = 1 * dpr
        ctx.stroke()
        ctx.restore()
      }

      setReadout({
        x: s.x,
        y: s.y,
        heading: s.heading,
        pen: s.pen,
        segments: s.segments.length
      })

      // Write-through on every repaint (bounded to the rAF cadence, not the raw
      // telemetry rate) so the docked instrument and its detached popup — or a
      // freshly re-docked instrument — always pick up the latest picture, even
      // once the program has stopped printing and nothing else would trigger it.
      void window.api.instruments.turtleStateSet(s).catch(() => undefined)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const tick = (): void => {
      if (dirty.current) {
        dirty.current = false
        draw()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      ro.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // `started` gates whether the `<canvas>` is even mounted (it sits behind the
    // "no drawing yet" InstrumentRequirement until the first reading arrives), so
    // this must re-run once that flips — otherwise `canvasRef.current` is null on
    // the initial (empty-deps) run, the effect no-ops forever, and the canvas
    // never gets its resize/draw/rAF loop wired up even after it mounts.
  }, [started])

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source="serial · live"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="turtle"
        style={{ '--accent': def.accent, '--accent-border': def.border } as React.CSSProperties}
      >
        {!started ? (
          <InstrumentRequirement
            title="No turtle drawing yet"
            lines={[
              'The canvas draws anything your program moves with the turtle module — plain MicroPython function calls, no separate Logo language.',
              'Getting "no module named turtle"? The library isn\'t on your board yet — connect it and Snakie offers a one-click install at the top of the window.'
            ]}
            code={'from turtle import forward, right\n\nfor _ in range(4):\n    forward(50)\n    right(90)'}
            helpId={`inst-${def.id}`}
            accent={def.accent}
          />
        ) : (
          <>
            <PhosphorScreen className="turtle__screen">
              <canvas ref={canvasRef} className="turtle__canvas" />
            </PhosphorScreen>
            <div className="turtle__readout">
              <span className="turtle__cell">
                <span className="turtle__cell-lbl">X</span>
                <span className="turtle__cell-val">{formatCoord(readout.x)}</span>
              </span>
              <span className="turtle__cell">
                <span className="turtle__cell-lbl">Y</span>
                <span className="turtle__cell-val">{formatCoord(readout.y)}</span>
              </span>
              <span className="turtle__cell">
                <span className="turtle__cell-lbl">HEADING</span>
                <span className="turtle__cell-val">{formatCoord(readout.heading)}°</span>
              </span>
              <span className="turtle__cell">
                <span className="turtle__cell-lbl">PEN</span>
                <span className="turtle__cell-val">{readout.pen ? 'DOWN' : 'UP'}</span>
              </span>
            </div>
            <div className="turtle__footer">
              <span className="turtle__status">{readout.segments} segments</span>
              {/* The pace, as a thing you can reach for. A learner watching a
                  drawing go past too fast should not have to edit their
                  program and run it again to slow it down — and a teacher
                  demonstrating wants it slower than anyone writing it does. */}
              <label className="turtle__speed" title={SPEED_TITLE}>
                <span className="turtle__speed-lbl">SPEED</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={speed}
                  onChange={(e) => {
                    ownSpeedRef.current = true
                    setSpeed(Number(e.target.value))
                  }}
                  className="turtle__speed-range"
                  aria-label={SPEED_TITLE}
                />
                <span className="turtle__speed-val">
                  {speed === 0 ? 'INSTANT' : `${(turtleStepMs(speed) / 1000).toFixed(1)}s`}
                </span>
              </label>
              <button
                type="button"
                className="turtle__clear"
                onClick={handleClear}
                title={CLEAR_TITLE}
                aria-label={CLEAR_TITLE}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                CLEAR
              </button>
            </div>
          </>
        )}
      </div>
    </InstrumentWindow>
  )
}
