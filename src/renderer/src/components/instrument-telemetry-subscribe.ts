/**
 * INSTRUMENT TELEMETRY SUBSCRIPTION — a tiny, self-contained React hook that
 * delivers every parsed `SNK …` reading from the broadcast serial stream.
 * =============================================================================
 *
 * The Oscilloscope / Multimeter / Plotter read telemetry through the rolling
 * {@link ./instrument-telemetry-feed} (which folds SCOPE/METER/PLOT into a
 * per-channel snapshot). The NEW robotics instruments (#110–#121) each want a
 * DIFFERENT shape — a 3-D IMU attitude, a radar sweep, an encoder count, a
 * scanner result set — so rather than grow one mega-feed, each panel keeps its
 * OWN small reducer and consumes the raw reading stream through this hook.
 *
 * Like the feed, this is REPL-free and NON-INVASIVE: it subscribes to the same
 * broadcast `device.onData` serial stream the Plotter/Terminal use, buffers
 * partial lines across chunks, parses each completed line with
 * {@link parseTelemetry}, and hands every typed reading to `onReading`. It never
 * touches the raw REPL, so a `while True:` loop printing telemetry on the board
 * drives the panels live without being interrupted. Multiple panels may each
 * call this independently — `device.onData` broadcasts to every subscriber.
 *
 * The callback is held in a ref so the subscription mounts ONCE (re-renders that
 * change the handler don't re-subscribe); the latest `onReading` is always used.
 */

import { useEffect, useRef } from 'react'
import { parseTelemetry, type Telemetry } from './instrument-telemetry'

/**
 * Split a carried-over buffer + a freshly-decoded chunk into the COMPLETE lines
 * it now contains plus the trailing remainder (an unfinished line) to carry to
 * the next chunk. Pure + DOM-free so it is unit-testable: handles `\n`, `\r\n`
 * and bare `\r` newlines, and never drops a partial final line.
 */
export function splitTelemetryLines(
  buffer: string,
  chunkText: string
): { lines: string[]; rest: string } {
  const normalised = (buffer + chunkText).replace(/\r\n?/g, '\n')
  const parts = normalised.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

/**
 * Subscribe to the device serial stream and call `onReading` with every parsed
 * telemetry reading (any `kind`). Non-telemetry / malformed lines are skipped
 * (`parseTelemetry` returns `null`). The subscription is torn down on unmount.
 *
 * Each invocation owns its OWN streaming `TextDecoder` + line buffer, so panels
 * that mount/unmount independently never corrupt each other's multibyte split.
 */
export function useTelemetryStream(onReading: (reading: Telemetry) => void): void {
  const cb = useRef(onReading)
  cb.current = onReading

  useEffect(() => {
    const decoder = new TextDecoder()
    let buffer = ''
    const unsubscribe = window.api.device.onData((chunk) => {
      const { lines, rest } = splitTelemetryLines(
        buffer,
        decoder.decode(chunk, { stream: true })
      )
      buffer = rest
      for (const line of lines) {
        const reading = parseTelemetry(line)
        if (reading) cb.current(reading)
      }
    })
    return unsubscribe
  }, [])
}
