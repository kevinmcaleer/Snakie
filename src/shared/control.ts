/**
 * SNAKIE CONTROL — the IDE→board control protocol (issue #115), the "write"
 * direction that complements the `SNK …` telemetry (board→IDE, issue #107).
 * =============================================================================
 *
 * Shared, dependency-free wire-format core so all three layers can use it:
 *  - the MAIN process (`MicroPythonDevice.sendControl`) builds + writes the line,
 *  - the PRELOAD exposes `device.sendControl`,
 *  - the RENDERER builds payloads + hides control echoes from the Terminal.
 *
 * Telemetry (`SNK …`) flows board→IDE: a program PRINTS readings and the IDE
 * parses the serial stream. The CONTROL channel is the reverse: the IDE WRITES a
 * command line and the on-device `control` helper polls stdin non-blockingly and
 * applies the LATEST value per target.
 *
 * The protocol (one line per command, ASCII, space-delimited):
 *
 *   SNKCMD <target> <payload>\n
 *
 * `<target>` is a single token naming what to drive (e.g. `teleop`, `led`,
 * `buzzer`, `screen`, a scan trigger like `scan:i2c`); `<payload>` is the rest
 * of the line — free-form for the target's helper to interpret (e.g.
 * `axes=lx:0.5,ly:-0.2 btn:a=1` for teleop, `tone 440 200` for the buzzer).
 *
 * The `SNKCMD` sentinel MIRRORS the `SNK` telemetry sentinel so the Terminal can
 * hide the echo of a control line from the console exactly as it hides telemetry.
 * Nothing here throws.
 */

/** The leading token that marks a line as an IDE→board control command. */
export const CONTROL_SENTINEL = 'SNKCMD'

/**
 * Sanitise a fragment so it cannot inject extra protocol lines: embedded CR/LF
 * (which would frame a second `SNKCMD`/telemetry line) are collapsed to spaces.
 */
function sanitise(fragment: string): string {
  return fragment.replace(/[\r\n]+/g, ' ')
}

/**
 * Build the wire line for a control command: `SNKCMD <target> <payload>\n`.
 *
 * The returned string ALWAYS ends in a single `\n` so the device-side poll sees
 * a complete line. `target` is reduced to a single whitespace-free token (so it
 * stays a clean routing key — interior whitespace is joined with `-`); `payload`
 * keeps its internal spaces (it is the free-form remainder) but never a newline.
 * An empty `payload` yields the bare `SNKCMD <target>\n` (a trigger with no
 * arguments, e.g. a scan kick). Never throws.
 */
export function buildControlLine(target: string, payload = ''): string {
  const t = sanitise(target).trim().split(/\s+/).filter(Boolean).join('-')
  const p = sanitise(payload).trim()
  const body = p === '' ? t : `${t} ${p}`
  return `${CONTROL_SENTINEL} ${body}\n`
}

/**
 * Is `line` an IDE→board control line (a `SNKCMD …`)? True when its first
 * whitespace token is the control sentinel, so the Terminal can hide the echo.
 * Tolerates leading whitespace; an embedded `SNKCMD` later in the line does NOT
 * count. Mirrors `isTelemetry`.
 */
export function isControl(line: string): boolean {
  if (!line) return false
  const trimmed = line.trimStart()
  return trimmed === CONTROL_SENTINEL || trimmed.startsWith(`${CONTROL_SENTINEL} `)
}

/**
 * Build a teleop control payload from named axes + pressed buttons. Produces a
 * deterministic `axes=<name>:<value>,… btn:<name>=1 …` payload that the device
 * `control.axes(target)` / `control.pressed(target, btn)` helpers parse. Axis
 * values are emitted verbatim (the caller rounds/clamps as it sees fit); only
 * buttons that are pressed are listed (absence ⇒ not pressed).
 */
export function buildTeleopPayload(
  axes: Record<string, number>,
  buttons: Record<string, boolean> = {}
): string {
  const toks: string[] = []
  const axisToks = Object.entries(axes).map(([name, value]) => `${name}:${value}`)
  if (axisToks.length > 0) toks.push(`axes=${axisToks.join(',')}`)
  for (const [name, pressed] of Object.entries(buttons)) {
    if (pressed) toks.push(`btn:${name}=1`)
  }
  return toks.join(' ')
}

/**
 * Build a multi-servo control payload (#416): `"<pin>:<deg> <pin>:<deg> …"`, so
 * one slider can drive several servos in a single `SNKCMD servos …` line (the
 * single-servo `servo` target can't). Degrees are rounded to whole numbers;
 * non-finite angles are skipped. The device-side `servos_command` parses it.
 */
export function buildServosPayload(byPin: Record<string, number>): string {
  const toks: string[] = []
  for (const [pin, deg] of Object.entries(byPin)) {
    if (Number.isFinite(deg)) toks.push(`${pin}:${Math.round(deg)}`)
  }
  return toks.join(' ')
}
