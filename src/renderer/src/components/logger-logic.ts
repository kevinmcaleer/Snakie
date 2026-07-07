/**
 * DATA LOGGER logic (#242) — pure, unit-tested session/CSV/paper helpers for
 * the dot-matrix-printer Data Logger instrument.
 * =============================================================================
 *
 * A recording SESSION captures every numeric field the `SNK` telemetry stream
 * produces (meter volts, plot series, distances, IMU angles, env t/p/h, …) as
 * flat `(t, key, value)` samples — `key` is `<kind>:<channel>[.<field>]`, e.g.
 * `meter:adc0`, `env:env.temp`, `plot:light`. Tearing the page off exports the
 * session as a WIDE CSV (one column per key) ready for a spreadsheet, and the
 * paper renders periodic printed value rows + a strip-chart per series.
 *
 * DOM-free and Date-free: callers supply timestamps (ms since the session
 * started), so everything here is deterministic and testable.
 */
import type { Telemetry } from './instrument-telemetry'

/** One captured numeric sample. */
export interface LogSample {
  /** ms since the session started. */
  t: number
  /** `<kind>:<channel>[.<field>]` series key. */
  key: string
  value: number
}

/** A recording session: flat samples in arrival order. */
export interface LogSession {
  samples: LogSample[]
}

export const emptySession = (): LogSession => ({ samples: [] })

/**
 * Flatten one parsed telemetry reading into `(key, value)` pairs. Non-numeric
 * kinds (binds, screen frames, scan results…) produce nothing. Booleans log as
 * 0/1 so a button press draws as a step trace.
 */
export function pairsForReading(r: Telemetry): Array<[string, number]> {
  switch (r.kind) {
    case 'scope':
      return [[`scope:${r.ch}`, r.value]]
    case 'pwm':
      return [[`pwm:${r.ch}.duty`, r.duty]]
    case 'meter':
      return [[`meter:${r.ch}`, r.value]]
    case 'plot':
      return r.series.map((s) => [`plot:${s.label}`, s.value])
    case 'imu':
      return [
        [`imu:${r.ch}.roll`, r.roll],
        [`imu:${r.ch}.pitch`, r.pitch],
        [`imu:${r.ch}.yaw`, r.yaw]
      ]
    case 'env':
      return [
        [`env:${r.ch}.temp`, r.temp],
        [`env:${r.ch}.pressure`, r.pressure],
        [`env:${r.ch}.humidity`, r.humidity]
      ]
    case 'dist': {
      const out: Array<[string, number]> = [[`dist:${r.ch}`, r.mm]]
      if (r.angle !== undefined) out.push([`dist:${r.ch}.angle`, r.angle])
      return out
    }
    case 'enc':
      return [[`enc:${r.ch}`, r.count]]
    case 'btn':
      return [[`btn:${r.name}`, r.pressed ? 1 : 0]]
    default:
      return []
  }
}

/** Fold a reading into the session (mutates + returns it — hot path). */
export function foldReading(session: LogSession, r: Telemetry, t: number): LogSession {
  for (const [key, value] of pairsForReading(r)) {
    if (Number.isFinite(value)) session.samples.push({ t, key, value })
  }
  return session
}

/** The distinct series keys, in first-seen order. */
export function seriesKeys(session: LogSession): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of session.samples) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s.key)
  }
  return out
}

/** All samples of one series, in order. */
export function seriesSamples(session: LogSession, key: string): LogSample[] {
  return session.samples.filter((s) => s.key === key)
}

/** Escape one CSV cell (quotes cells containing separators/quotes/newlines). */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * The tear-off: a WIDE CSV — `time_s` + one column per series key; one row per
 * distinct sample time (samples sharing a timestamp share a row; gaps stay
 * empty). Times print in seconds to 3 dp.
 */
export function csvFor(session: LogSession): string {
  const keys = seriesKeys(session)
  const header = ['time_s', ...keys].map(csvCell).join(',')
  if (session.samples.length === 0) return header + '\n'
  // Group by timestamp, preserving first-seen time order.
  const byT = new Map<number, Map<string, number>>()
  for (const s of session.samples) {
    let row = byT.get(s.t)
    if (!row) {
      row = new Map()
      byT.set(s.t, row)
    }
    row.set(s.key, s.value) // later sample at the same t wins (latest reading)
  }
  const lines = [header]
  for (const [t, row] of byT) {
    lines.push(
      [
        (t / 1000).toFixed(3),
        ...keys.map((k) => (row.has(k) ? String(row.get(k)) : ''))
      ].join(',')
    )
  }
  return lines.join('\n') + '\n'
}

/** A printed paper row: `12.5s  adc0=1.63  temp=22.1` (short key names). */
export interface PaperRow {
  t: number
  text: string
}

/** Trim `<kind>:` and keep `channel[.field]` for the printed rows. */
export function shortKey(key: string): string {
  const i = key.indexOf(':')
  return i >= 0 ? key.slice(i + 1) : key
}

/**
 * The periodic printed value rows for the paper: the LATEST value of every
 * series at each `intervalMs` boundary crossed by the recording. The final
 * partial interval prints too (so a short session still shows a row).
 */
export function paperRows(session: LogSession, intervalMs: number): PaperRow[] {
  if (session.samples.length === 0 || intervalMs <= 0) return []
  const keys = seriesKeys(session)
  const latest = new Map<string, number>()
  const rows: PaperRow[] = []
  let nextTick = intervalMs
  const push = (t: number): void => {
    const cells = keys
      .filter((k) => latest.has(k))
      .map((k) => `${shortKey(k)}=${formatValue(latest.get(k)!)}`)
    if (cells.length > 0) rows.push({ t, text: `${(t / 1000).toFixed(1)}s  ${cells.join('  ')}` })
  }
  for (const s of session.samples) {
    while (s.t >= nextTick) {
      push(nextTick)
      nextTick += intervalMs
    }
    latest.set(s.key, s.value)
  }
  const lastT = session.samples[session.samples.length - 1].t
  push(lastT)
  return rows
}

/** Compact number for the printed rows (≤ 4 significant-ish chars). */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)
}

/** Min/max extent of a sample list (empty → null). */
export function extentOf(samples: LogSample[]): { min: number; max: number } | null {
  if (samples.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const s of samples) {
    if (s.value < min) min = s.value
    if (s.value > max) max = s.value
  }
  return { min, max }
}

/**
 * SVG polyline points for one series across `[0, durationMs]` mapped into a
 * `w×h` box (y flipped; flat series draw a centre line). Empty series → ''.
 */
export function pointsFor(samples: LogSample[], durationMs: number, w: number, h: number): string {
  if (samples.length === 0 || durationMs <= 0) return ''
  const ext = extentOf(samples)!
  const span = ext.max - ext.min
  return samples
    .map((s) => {
      const x = (s.t / durationMs) * w
      const y = span === 0 ? h / 2 : h - ((s.value - ext.min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Suggested tear-off filename (caller supplies the wall-clock stamp). */
export function csvFilename(stamp: string): string {
  return `snakie-log-${stamp.replace(/[^0-9T-]/g, '').slice(0, 15)}.csv`
}
