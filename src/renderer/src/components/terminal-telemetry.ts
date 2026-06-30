/**
 * TERMINAL TELEMETRY FILTER — pure, DOM-free stream filter that strips
 * instruments-telemetry lines from the console (issue #107).
 * =============================================================================
 *
 * The on-device instruments library prints machine-readable `SNK …` telemetry
 * lines (parsed by {@link ./instrument-telemetry} and routed to the
 * scope/meter/plotter), and the IDE writes `SNKCMD …` control lines (issue
 * #115) the board may echo back. Both are machine data, not console output, so
 * the Terminal pipes the raw serial stream through {@link makeTelemetryFilter}
 * before writing it to xterm: complete telemetry AND control lines are dropped,
 * everything else passes through unchanged.
 *
 * The filter is **streaming + stateful**: serial data arrives in arbitrary
 * chunks (a telemetry line can be split across two `onData` callbacks), so it
 * buffers an incomplete trailing line between calls and only decides a line's
 * fate once a line terminator (`\n`) completes it. The incomplete tail is held
 * back UNLESS it cannot possibly become a telemetry line (it isn't a prefix of
 * the `SNK ` sentinel) — that exception is what lets a newline-less REPL prompt
 * like `>>> ` flush immediately instead of being held forever.
 *
 * Kept React/DOM-free and never throws, mirroring the other instrument helpers,
 * so it is unit-testable in plain node.
 */

import { isTelemetry, TELEMETRY_SENTINEL } from './instrument-telemetry'
import { CONTROL_SENTINEL, isControl } from './snakie-control'

/**
 * The full sentinel headers (token + trailing space) we may still be assembling.
 * `SNK ` is telemetry; `SNKCMD ` is a control echo (issue #115). Both begin with
 * `SNK`, so a partial fragment like `SNK` could still grow into EITHER.
 */
const SENTINEL_PREFIXES = [`${TELEMETRY_SENTINEL} `, `${CONTROL_SENTINEL} `]

/** Should a complete (de-newlined) line be hidden from the console? */
function isHidden(line: string): boolean {
  return isTelemetry(line) || isControl(line)
}

/**
 * Could the (newline-less) trailing fragment `tail` still grow into a hidden
 * (telemetry or control) line? True while it is a prefix of `"SNK "` or
 * `"SNKCMD "` (keep buffering), OR already past one of those headers but not yet
 * newline-terminated (wait for the rest). Once it diverges (e.g. a `>>> ` prompt
 * or `SNKx`) it can never match, so we release it immediately. Leading
 * whitespace is ignored to match {@link isTelemetry}/{@link isControl}.
 */
function couldBecomeTelemetry(tail: string): boolean {
  const t = tail.trimStart()
  // Pure whitespace is never a telemetry line on its own — flush it immediately.
  // Holding it would let a lone echoed space (e.g. typed at the simulated REPL,
  // #135) be concatenated onto the NEXT `SNK …` telemetry line and dropped with
  // it. Telemetry the device prints starts at column 0, so nothing is lost.
  if (t === '') return false
  // `t` is a prefix of a header (e.g. "S", "SN", "SNK", "SNK ", "SNKC", "SNKCMD ").
  if (SENTINEL_PREFIXES.some((p) => p.startsWith(t))) return true
  // Already a full `SNK `/`SNKCMD ` header but no newline yet → wait for the rest.
  return SENTINEL_PREFIXES.some((p) => t.startsWith(p))
}

/**
 * A stateful filter over the decoded serial text stream. Call {@link push} with
 * each decoded chunk; it returns the text that should be WRITTEN to the console
 * (telemetry lines removed), buffering any undecidable trailing fragment for the
 * next call.
 */
export interface TelemetryFilter {
  /** Feed one decoded chunk; returns the console-visible text (may be empty). */
  push(chunk: string): string
}

/**
 * Build a fresh {@link TelemetryFilter}. Newlines are preserved on the lines
 * that pass through (we keep each `\n`), so xterm's `convertEol` still renders
 * them correctly; only whole telemetry lines (and their terminator) are removed.
 */
export function makeTelemetryFilter(): TelemetryFilter {
  let buffer = ''
  return {
    push(chunk: string): string {
      buffer += chunk
      let out = ''
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        // Include the newline in the unit we test/emit so terminators are kept.
        const lineWithNl = buffer.slice(0, nl + 1)
        // Strip a trailing \r (CRLF) only to classify; emit the original bytes.
        const line = lineWithNl.replace(/\r?\n$/, '')
        if (!isHidden(line)) out += lineWithNl
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
      // The remaining `buffer` has no newline. Flush it now unless it might still
      // become a telemetry line (then hold it for the next chunk).
      if (buffer !== '' && !couldBecomeTelemetry(buffer)) {
        out += buffer
        buffer = ''
      }
      return out
    }
  }
}
