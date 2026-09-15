import { useCallback, useEffect, useRef, useState } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { InstrumentRequirement } from './InstrumentRequirement'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import type { Telemetry } from './instrument-telemetry'
import type { InstrumentDef } from './instruments-registry'
import {
  formatCoord,
  headingToRadians,
  INITIAL_TURTLE_STATE,
  reduceTurtle,
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

  const onReading = useCallback(
    (reading: Telemetry) => {
      if (reading.kind !== 'turtle') return
      if (!started) setStarted(true)
      stateRef.current = reduceTurtle(stateRef.current, reading)
      dirty.current = true
    },
    [started]
  )
  useTelemetryStream(onReading)

  const handleClear = useCallback(() => {
    stateRef.current = { ...stateRef.current, segments: [] }
    dirty.current = true
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
  }, [])

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
