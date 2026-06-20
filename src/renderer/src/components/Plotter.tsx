import { useCallback, useEffect, useRef, useState } from 'react'
import './Plotter.css'
import { parseLine } from './Plotter.parse'
import { estimateHz, sampleReadout } from './Plotter.readout'
import { PhosphorScreen } from './InstrumentWindow'

/**
 * Serial Plotter (issue #21; reskinned for #103) — a skeuomorphic **strip-chart
 * recorder** that graphs numeric console output over time.
 *
 * It subscribes to the same raw `device.onData` stream the REPL terminal uses
 * (the device layer broadcasts to every subscriber, so this does not disturb
 * the terminal) and parses each completed text line into one or more numeric
 * samples. Parsed samples feed a hand-rolled canvas line chart — no charting
 * dependency — with a rolling window, auto-scaling Y axis and a sample-index X
 * axis. Issue #103 keeps that parse + data pipeline unchanged and reskins the
 * *rendering* to the design handoff's blue-phosphor CRT (the shared
 * {@link PhosphorScreen} in its `--blue` variant): a faint blue graticule, two
 * (then a cycling palette of) scrolling traces with a blur-glow, a live-edge
 * cursor at the right, an in-screen legend and a `<N> samples · <rate> Hz`
 * readout. Per the spec the only control is a metal CLEAR key.
 *
 * Supported line formats (whitespace is trimmed first):
 *  - single number:                "12.5"
 *  - comma / space / tab separated: "1, 2, 3"  ·  "1 2 3"  ·  "1\t2\t3"
 *  - labelled pairs:                "temp:21.4, humidity:48"  ·  "x=1 y=2"
 * Lines with no parsable number are ignored. In an unlabelled multi-column
 * line, columns map to auto-named series ("series 1", "series 2", …). Labelled
 * tokens always map to the series named by their label, so the two styles can
 * be mixed across lines without colliding.
 */

/**
 * Blue-phosphor trace palette. The first two match the handoff exactly
 * (`#5fb8f0` temp, `#f0b94a` light); further series cycle phosphor-friendly
 * hues that read on the dark CRT screen.
 */
const SERIES_COLORS = [
  '#5fb8f0', // sky blue (primary)
  '#f0b94a', // amber (secondary)
  '#7ee787', // phosphor green
  '#ff7b9c', // pink
  '#b794f6', // violet
  '#5fe0d0', // teal
  '#ffa94d', // orange
  '#e0e0e0' // white
]

const DEFAULT_WINDOW = 200
/** Hard cap on series so a noisy stream can't grow memory without bound. */
const MAX_SERIES = 16
/** How many recent sample timestamps to keep for the live Hz estimate. */
const RATE_WINDOW = 40

interface Series {
  name: string
  color: string
  /** Rolling buffer of values; index 0 is the oldest retained sample. */
  values: number[]
}

const decoder = new TextDecoder()

export function Plotter(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Legend mirror of the live series (name + colour) for React rendering. The
  // authoritative sample data lives in the ref so high-rate streams don't spam
  // re-renders.
  const [legend, setLegend] = useState<Array<{ name: string; color: string }>>([])
  // The `<N> samples · <rate> Hz` readout text, refreshed on a low-frequency
  // timer (not per-sample) so it doesn't thrash React.
  const [readout, setReadout] = useState('0 samples')

  const windowRef = useRef(DEFAULT_WINDOW)
  const seriesRef = useRef<Series[]>([])
  const seriesByName = useRef(new Map<string, Series>())
  const lineBuf = useRef('')
  const dirty = useRef(false)
  const rafRef = useRef<number | null>(null)
  /** Timestamps (ms) of recent samples, for the live Hz estimate. */
  const sampleTimes = useRef<number[]>([])
  /** Total samples seen on the widest series (for the readout count). */
  const sampleCount = useRef(0)

  /** Find or lazily create a series for a parsed token. */
  const getSeries = useCallback((key: string, displayName: string): Series | null => {
    const existing = seriesByName.current.get(key)
    if (existing) return existing
    if (seriesByName.current.size >= MAX_SERIES) return null
    const series: Series = {
      name: displayName,
      color: SERIES_COLORS[seriesByName.current.size % SERIES_COLORS.length],
      values: []
    }
    seriesByName.current.set(key, series)
    seriesRef.current.push(series)
    setLegend(seriesRef.current.map((s) => ({ name: s.name, color: s.color })))
    return series
  }, [])

  const ingestLine = useCallback(
    (rawLine: string) => {
      const parsed = parseLine(rawLine.trim())
      if (parsed.length === 0) return
      let autoIndex = 0
      for (const { label, value } of parsed) {
        // Unlabelled tokens map to positional auto-series; labelled tokens map
        // to a named series keyed by their label.
        const key = label ? `l:${label}` : `auto:${autoIndex++}`
        const name = label ?? `series ${autoIndex}`
        const series = getSeries(key, name)
        if (series) series.values.push(value)
      }
      // Pad any series that didn't get a value this line with a repeat of their
      // last sample (or 0 for a brand-new series) so all series advance together
      // on the X (sample) axis.
      const maxLen = Math.max(...seriesRef.current.map((s) => s.values.length))
      for (const series of seriesRef.current) {
        while (series.values.length < maxLen) {
          series.values.push(series.values[series.values.length - 1] ?? 0)
        }
      }
      // Trim to the rolling window.
      const limit = windowRef.current
      for (const series of seriesRef.current) {
        if (series.values.length > limit) {
          series.values.splice(0, series.values.length - limit)
        }
      }
      // Track cadence for the live Hz readout (one tick per ingested line).
      sampleCount.current += 1
      const now = performance.now()
      sampleTimes.current.push(now)
      if (sampleTimes.current.length > RATE_WINDOW) {
        sampleTimes.current.splice(0, sampleTimes.current.length - RATE_WINDOW)
      }
      dirty.current = true
    },
    [getSeries]
  )

  // Subscribe to the raw serial stream once.
  useEffect(() => {
    const unsubscribe = window.api.device.onData((chunk) => {
      lineBuf.current += decoder.decode(chunk, { stream: true })
      // Normalise CRLF / CR then split out complete lines.
      const normalised = lineBuf.current.replace(/\r\n?/g, '\n')
      const parts = normalised.split('\n')
      lineBuf.current = parts.pop() ?? ''
      for (const line of parts) ingestLine(line)
    })
    return unsubscribe
  }, [ingestLine])

  // Low-frequency readout refresh (samples · Hz). Derived from the buffer, not
  // per-sample, so a fast stream doesn't re-render React every tick.
  useEffect(() => {
    const id = window.setInterval(() => {
      const widest = seriesRef.current.reduce((m, s) => Math.max(m, s.values.length), 0)
      const hz = estimateHz(sampleTimes.current)
      setReadout(sampleReadout(widest, hz))
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  // Render loop — repaints on a rAF whenever data changed or layout resized.
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

      ctx.clearRect(0, 0, w, h)

      // Small inset so traces/cursor don't clip the rounded screen corners. The
      // screen background (blue-phosphor radial) comes from the PhosphorScreen
      // CRT treatment behind the canvas; the canvas itself is transparent.
      const pad = 1 * dpr
      const plotX = pad
      const plotY = pad
      const plotW = Math.max(1, w - pad * 2)
      const plotH = Math.max(1, h - pad * 2)

      // Faint blue graticule (6 vertical · 4 horizontal divisions), matching the
      // handoff's `rgba(120,180,230,.12)` grid.
      ctx.strokeStyle = 'rgba(120,180,230,0.12)'
      ctx.lineWidth = 1 * dpr
      const vDiv = 7
      for (let i = 1; i < vDiv; i++) {
        const x = plotX + (plotW * i) / vDiv
        ctx.beginPath()
        ctx.moveTo(x, plotY)
        ctx.lineTo(x, plotY + plotH)
        ctx.stroke()
      }
      const hDiv = 5
      for (let i = 1; i < hDiv; i++) {
        const y = plotY + (plotH * i) / hDiv
        ctx.beginPath()
        ctx.moveTo(plotX, y)
        ctx.lineTo(plotX + plotW, y)
        ctx.stroke()
      }

      const series = seriesRef.current
      // Determine Y range across all series (auto-scale).
      let min = Infinity
      let max = -Infinity
      let maxLen = 0
      for (const s of series) {
        if (s.values.length > maxLen) maxLen = s.values.length
        for (const v of s.values) {
          if (v < min) min = v
          if (v > max) max = v
        }
      }

      if (!Number.isFinite(min) || !Number.isFinite(max) || maxLen === 0) {
        ctx.fillStyle = 'rgba(111,149,176,0.85)'
        ctx.font = `${12 * dpr}px 'JetBrains Mono', ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('waiting for numeric data…', plotX + plotW / 2, plotY + plotH / 2)
        return
      }
      if (min === max) {
        // Flat data — give it a visible band.
        min -= 1
        max += 1
      }
      // Leave a little vertical headroom so peaks don't kiss the bezel.
      const range = max - min
      const padFrac = 0.08
      const lo = min - range * padFrac
      const span = range * (1 + padFrac * 2)

      // X scale: map sample index [0, maxLen-1] across plot width, newest at the
      // right (strip-chart scrolls right-to-left).
      const xStep = maxLen > 1 ? plotW / (maxLen - 1) : 0
      const xOf = (i: number): number => plotX + i * xStep
      const yOf = (v: number): number => plotY + plotH - ((v - lo) / span) * plotH

      for (const s of series) {
        if (s.values.length === 0) continue
        // Blur-glow pass: a fat, soft, translucent stroke under the crisp line.
        const offset = maxLen - s.values.length
        const stroke = (): void => {
          ctx.beginPath()
          for (let i = 0; i < s.values.length; i++) {
            const x = xOf(offset + i)
            const y = yOf(s.values[i])
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = s.color
        ctx.globalAlpha = 0.35
        ctx.lineWidth = 5 * dpr
        ctx.shadowColor = s.color
        ctx.shadowBlur = 6 * dpr
        stroke()
        // Crisp top pass.
        ctx.globalAlpha = 1
        ctx.lineWidth = 2 * dpr
        ctx.shadowBlur = 3 * dpr
        stroke()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      // Live-edge cursor at the right (the "pen" of the strip-chart recorder).
      ctx.strokeStyle = 'rgba(95,184,240,0.5)'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.moveTo(plotX + plotW - 0.75 * dpr, plotY)
      ctx.lineTo(plotX + plotW - 0.75 * dpr, plotY + plotH)
      ctx.stroke()
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

  const handleClear = useCallback(() => {
    seriesRef.current = []
    seriesByName.current = new Map()
    lineBuf.current = ''
    sampleTimes.current = []
    sampleCount.current = 0
    setLegend([])
    setReadout('0 samples')
    dirty.current = true
  }, [])

  return (
    <div className="plotter">
      <PhosphorScreen className="instr__screen--blue plotter__screen">
        <canvas ref={canvasRef} className="plotter__canvas" />
        <div className="plotter__legend" aria-label="Plotted series">
          {legend.length === 0 ? (
            <span className="plotter__legend-empty">no data</span>
          ) : (
            legend.map((s) => (
              <span
                className="plotter__legend-item"
                key={s.name}
                style={{ color: s.color, textShadow: `0 0 6px ${s.color}88` }}
              >
                ■ {s.name}
              </span>
            ))
          )}
        </div>
        <div className="plotter__readout">{readout}</div>
      </PhosphorScreen>
      <div className="plotter__footer">
        <span className="plotter__status">auto-scroll · live</span>
        <button
          type="button"
          className="plotter__clear"
          onClick={handleClear}
          title="Clear the plot buffer"
          aria-label="Clear the plot buffer"
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
    </div>
  )
}
