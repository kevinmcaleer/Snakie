/**
 * SNAKIE PRESENCE — is a Snakie program running on the board and servicing the
 * control channel?
 * =============================================================================
 *
 * The on-device `snakie` background service (issue: threaded scans) prints a
 * `SNK READY <caps...>` heartbeat — once on `start()`, then ~every 2 s from its
 * second-core loop — and answers a `SNKCMD ping` with one immediately. This hook
 * listens for that heartbeat (via the shared telemetry stream) and reports
 * Snakie PRESENT for {@link PRESENCE_WINDOW_MS} after the last one, plus the
 * capability tokens it advertised (e.g. `scan:wifi`).
 *
 * Panels use it to decide what a control action (a SCAN button, teleop, …)
 * should do: drive the running program when present, or offer to open + run a
 * demo when not.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTelemetryStream } from './instrument-telemetry-subscribe'

/** How long after the last `SNK READY` we still consider Snakie present (ms). */
export const PRESENCE_WINDOW_MS = 5000

/**
 * Pure: is a Snakie program present, given the last READY timestamp and `now`?
 * False until the first READY (`lastReadyAt` of 0). DOM-free + unit-testable.
 */
export function isPresent(
  lastReadyAt: number,
  now: number,
  windowMs: number = PRESENCE_WINDOW_MS
): boolean {
  return lastReadyAt > 0 && now - lastReadyAt < windowMs
}

export interface SnakiePresence {
  /** True while a Snakie background service has announced readiness recently. */
  present: boolean
  /** The capability tokens from the latest `SNK READY` (e.g. `scan:wifi`). */
  caps: string[]
}

/**
 * Track whether a Snakie program is live on the board. Sends a `SNKCMD ping` on
 * mount so a running service answers at once (no wait for the next heartbeat),
 * then keeps `present` fresh on a 1 s tick.
 */
export function useSnakiePresence(): SnakiePresence {
  const lastReady = useRef(0)
  const [caps, setCaps] = useState<string[]>([])
  const [present, setPresent] = useState(false)

  useTelemetryStream(
    useCallback((reading) => {
      if (reading.kind !== 'ready') return
      lastReady.current = Date.now()
      setCaps(reading.caps)
      setPresent(true)
    }, [])
  )

  useEffect(() => {
    // Prompt an immediate READY from any already-running service.
    window.api.device.sendControl('ping').catch(() => undefined)
    const id = window.setInterval(() => {
      setPresent(isPresent(lastReady.current, Date.now()))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return { present, caps }
}
