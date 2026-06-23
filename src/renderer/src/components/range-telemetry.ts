/**
 * RANGE TELEMETRY — a self-contained `SNK DIST` parser + always-on subscription
 * hook for the distance-sensor RADAR instrument (issue #112).
 * =============================================================================
 *
 * The radar is a SELF-CONTAINED dock panel, so — rather than extend the shared
 * `instrument-telemetry` union (a shared file this panel must not touch) — it
 * carries its OWN tiny telemetry kind + parser here and subscribes directly to the
 * broadcast serial stream (`window.api.device.onData`), exactly like the
 * Oscilloscope/Multimeter's passive feed does for `SNK SCOPE`/`SNK METER`.
 *
 * The protocol line (one per `print()`, ASCII, space-delimited), consistent with
 * the existing `SNK <KIND> …` grammar:
 *
 *   SNK DIST <ch> <mm> [<angle>]
 *
 *   - `<ch>`    — a user channel label (e.g. `tof`, `sonar0`); used only to scope
 *                 the reading, kept for parity with the other instruments.
 *   - `<mm>`    — distance in millimetres (float; 0 / huge ⇒ no echo).
 *   - `<angle>` — OPTIONAL sweep bearing in degrees. ABSENT ⇒ a single fixed
 *                 sensor (gauge + history). PRESENT ⇒ a swept sensor (polar radar).
 *
 * Pure + DOM-free for the parser (unit-testable in plain node); the hook is the
 * thin React wrapper around the same `device.onData` line buffering the host uses.
 * Nothing here throws — a malformed/non-`SNK DIST` line yields `null`.
 */

import { useEffect, useRef, useState } from 'react'

/** The leading sentinel that marks a telemetry line (shared `SNK <KIND>` grammar). */
const SENTINEL = 'SNK'

/** A parsed distance reading. `angle` present ⇒ swept; absent ⇒ single sensor. */
export interface DistanceTelemetry {
  kind: 'dist'
  /** The user channel label. */
  ch: string
  /** Distance in millimetres (0 / very large ⇒ no echo — see range-logic). */
  mm: number
  /** Sweep bearing in degrees (0..180), or undefined for a single fixed sensor. */
  angle?: number
}

/**
 * Parse one already-de-newlined line as a `SNK DIST` reading, or `null` for a
 * non-`DIST` / malformed line (so a caller can fall through to other handling).
 * Never throws.
 *
 *   SNK DIST <ch> <mm> [<angle>]  →  { kind:'dist', ch, mm, angle? }
 */
export function parseDistance(line: string): DistanceTelemetry | null {
  if (!line) return null
  const trimmed = line.trim()
  if (trimmed !== SENTINEL && !trimmed.startsWith(`${SENTINEL} `)) return null
  const parts = trimmed.split(/\s+/)
  if (parts[1] !== 'DIST') return null

  const ch = parts[2]
  const mm = Number(parts[3])
  if (!ch || !Number.isFinite(mm)) return null

  // The angle token is optional; only attach it when it parses to a finite number.
  let angle: number | undefined
  if (parts[4] !== undefined) {
    const a = Number(parts[4])
    if (Number.isFinite(a)) angle = a
  }
  return angle === undefined ? { kind: 'dist', ch, mm } : { kind: 'dist', ch, mm, angle }
}

/** How often the subscription publishes the latest reading to React (ms). */
const FLUSH_MS = 80

const decoder = new TextDecoder()

/**
 * Subscribe to the broadcast serial stream and invoke `onReading` for every
 * `SNK DIST` line the board prints — the passive, always-on, REPL-free source
 * that drives the radar even inside a running `while True:` loop (no program
 * interruption). Buffers partial chunks into whole lines (mirrors the host's
 * {@link useTelemetryFeed}); the callback is held in a ref so a changing closure
 * doesn't re-subscribe. A SINGLETON-style stream: one subscription per mounted
 * radar panel.
 */
export function useTelemetryStream(onReading: (r: DistanceTelemetry) => void): void {
  const cbRef = useRef(onReading)
  cbRef.current = onReading

  useEffect(() => {
    let buf = ''
    const unsubscribe = window.api.device.onData((chunk) => {
      buf += decoder.decode(chunk, { stream: true })
      const normalised = buf.replace(/\r\n?/g, '\n')
      const lines = normalised.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const r = parseDistance(line)
        if (r) cbRef.current(r)
      }
    })
    return unsubscribe
  }, [])
}

/**
 * A small convenience hook: subscribe via {@link useTelemetryStream} and surface
 * the LATEST distance reading as React state, throttled to {@link FLUSH_MS} so a
 * fast stream doesn't thrash the radar's render. Returns the latest reading (or
 * `null` before anything has arrived). The radar uses this to drive the gauge /
 * sweep; it folds the same reading into its own history/trail.
 */
export function useLatestDistance(): DistanceTelemetry | null {
  const [latest, setLatest] = useState<DistanceTelemetry | null>(null)
  const pending = useRef<DistanceTelemetry | null>(null)
  const dirty = useRef(false)

  useTelemetryStream((r) => {
    pending.current = r
    dirty.current = true
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      if (dirty.current) {
        dirty.current = false
        setLatest(pending.current)
      }
    }, FLUSH_MS)
    return () => window.clearInterval(id)
  }, [])

  return latest
}
