import { useCallback, useEffect, useRef, useState } from 'react'
import './Plotter.css'
import { parseLine } from './Plotter.parse'

/**
 * Serial Plotter (issue #21) — Arduino-IDE-style live chart of numeric console
 * output.
 *
 * It subscribes to the same raw `device.onData` stream the REPL terminal uses
 * (the device layer broadcasts to every subscriber, so this does not disturb
 * the terminal) and parses each completed text line into one or more numeric
 * samples. Parsed samples feed a hand-rolled canvas line chart — no charting
 * dependency — with a rolling window, auto-scaling Y axis and a sample-index X
 * axis.
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

/** Distinct, theme-neutral series palette (readable on light & dark). */
const SERIES_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#a855f7', // purple
  '#eab308', // yellow
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899' // pink
]

const DEFAULT_WINDOW = 200
const MIN_WINDOW = 10
const MAX_WINDOW = 5000
/** Hard cap on series so a noisy stream can't grow memory without bound. */
const MAX_SERIES = 16

interface Series {
  name: string
  color: string
  /** Rolling buffer of values; index 0 is the oldest retained sample. */
  values: number[]
}

const decoder = new TextDecoder()

export function Plotter(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [paused, setPaused] = useState(false)
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW)
  // Legend mirror of the live series (name + colour) for React rendering. The
  // authoritative sample data lives in the ref so high-rate streams don't spam
  // re-renders.
  const [legend, setLegend] = useState<Array<{ name: string; color: string }>>([])

  const pausedRef = useRef(paused)
  const windowRef = useRef(windowSize)
  const seriesRef = useRef<Series[]>([])
  const seriesByName = useRef(new Map<string, Series>())
  const lineBuf = useRef('')
  const dirty = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  useEffect(() => {
    windowRef.current = windowSize
  }, [windowSize])

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
      dirty.current = true
    },
    [getSeries]
  )

  // Subscribe to the raw serial stream once.
  useEffect(() => {
    const unsubscribe = window.api.device.onData((chunk) => {
      if (pausedRef.current) return
      lineBuf.current += decoder.decode(chunk, { stream: true })
      // Normalise CRLF / CR then split out complete lines.
      const normalised = lineBuf.current.replace(/\r\n?/g, '\n')
      const parts = normalised.split('\n')
      lineBuf.current = parts.pop() ?? ''
      for (const line of parts) ingestLine(line)
    })
    return unsubscribe
  }, [ingestLine])

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

    const styles = getComputedStyle(canvas)
    const readVar = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback

    const draw = (): void => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width
      const h = canvas.height
      const dpr = window.devicePixelRatio || 1

      const bg = readVar('--bg-sunken', '#101216')
      const grid = readVar('--border', '#2c3038')
      const axis = readVar('--text-muted', '#9099a6')

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      const padL = 44 * dpr
      const padR = 8 * dpr
      const padT = 8 * dpr
      const padB = 18 * dpr
      const plotW = Math.max(1, w - padL - padR)
      const plotH = Math.max(1, h - padT - padB)

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

      // Plot frame.
      ctx.strokeStyle = grid
      ctx.lineWidth = 1 * dpr
      ctx.strokeRect(padL, padT, plotW, plotH)

      if (!Number.isFinite(min) || !Number.isFinite(max) || maxLen === 0) {
        ctx.fillStyle = axis
        ctx.font = `${12 * dpr}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('waiting for numeric data…', padL + plotW / 2, padT + plotH / 2)
        return
      }
      if (min === max) {
        // Flat data — give it a visible band.
        min -= 1
        max += 1
      }
      const range = max - min

      // Y grid lines + labels (5 divisions).
      ctx.fillStyle = axis
      ctx.font = `${10 * dpr}px ui-monospace, monospace`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const divisions = 4
      for (let i = 0; i <= divisions; i++) {
        const frac = i / divisions
        const y = padT + plotH - frac * plotH
        ctx.strokeStyle = grid
        ctx.globalAlpha = 0.4
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + plotW, y)
        ctx.stroke()
        ctx.globalAlpha = 1
        const value = min + frac * range
        ctx.fillText(value.toFixed(2), padL - 4 * dpr, y)
      }

      // X scale: map sample index [0, maxLen-1] across plot width.
      const xStep = maxLen > 1 ? plotW / (maxLen - 1) : 0
      const xOf = (i: number): number => padL + i * xStep
      const yOf = (v: number): number => padT + plotH - ((v - min) / range) * plotH

      for (const s of series) {
        if (s.values.length === 0) continue
        ctx.strokeStyle = s.color
        ctx.lineWidth = 1.5 * dpr
        ctx.lineJoin = 'round'
        ctx.beginPath()
        // Right-align series to the newest sample so shorter series still track
        // the live edge.
        const offset = maxLen - s.values.length
        for (let i = 0; i < s.values.length; i++) {
          const x = xOf(offset + i)
          const y = yOf(s.values[i])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
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
    setLegend([])
    dirty.current = true
  }, [])

  const handleWindowChange = useCallback((raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setWindowSize(Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(n))))
  }, [])

  return (
    <div className="plotter">
      <div className="plotter__controls">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={handleClear}>
          🗑 Clear
        </button>
        <label className="plotter__window">
          Window
          <input
            type="number"
            className="plotter__window-input"
            min={MIN_WINDOW}
            max={MAX_WINDOW}
            step={10}
            value={windowSize}
            onChange={(e) => handleWindowChange(e.target.value)}
          />
        </label>
      </div>
      <div className="plotter__legend">
        {legend.length === 0 ? (
          <span className="plotter__legend-empty">No series yet</span>
        ) : (
          legend.map((s) => (
            <span className="plotter__legend-item" key={s.name}>
              <span className="plotter__legend-swatch" style={{ background: s.color }} />
              {s.name}
            </span>
          ))
        )}
      </div>
      <div className="plotter__canvas-wrap">
        <canvas ref={canvasRef} className="plotter__canvas" />
        {paused && <span className="plotter__paused-badge">Paused</span>}
      </div>
    </div>
  )
}
