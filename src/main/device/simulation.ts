/**
 * SIMULATION CORE — pure signal/protocol helpers for the simulated device (#135).
 * =============================================================================
 *
 * Kept dependency-free (no Electron, no serialport, no Node APIs) so it is fast
 * to unit-test and so {@link SimulatedDevice} stays a thin wrapper around these
 * deterministic functions. Everything here is driven by an integer `tick` rather
 * than the wall clock, so a frame is fully reproducible in tests.
 *
 *  - {@link simulatedTelemetryFrame} produces the `SNK …` telemetry lines a real
 *    board would PRINT (board→IDE), matching the wire format the renderer parser
 *    expects (see `instrument-telemetry.ts` / `micropython/instruments.py`).
 *  - {@link simulateProbeResponse} answers the Board Viewer's `<<SNKV>>` live-pin
 *    probe (see `board-values.ts`) with plausible per-pin values.
 */

/** Telemetry sentinel — mirrors `TELEMETRY_SENTINEL` in instrument-telemetry.ts. */
const SNK = 'SNK'

/**
 * Live-value probe marker — mirrors `PROBE_MARK` in `board-values.ts`. The Board
 * Viewer execs a snippet whose `print()`s emit `<<SNKV>><index>:<value>` lines;
 * we recognise those indices and answer with simulated values.
 */
export const PROBE_MARK = '<<SNKV>>'

/** Round to `places` decimals and return a compact string (no trailing zeros). */
function fixed(value: number, places = 3): string {
  return Number(value.toFixed(places)).toString()
}

/**
 * The `SNK …` telemetry lines for one simulated frame at integer `tick`.
 *
 * A believable mix is emitted every frame so that whichever instruments the user
 * opens animate immediately: an oscilloscope trace, a multimeter voltage, a
 * two-series plot, a gently tumbling IMU, a ranging sensor and an encoder, plus
 * an occasional button event and a `READY` heartbeat. Each entry is ONE complete
 * line WITHOUT a trailing newline (the caller joins + terminates them).
 */
export function simulatedTelemetryFrame(tick: number): string[] {
  // ~0.12 s per tick → a slow, readable phase for the periodic signals.
  const phase = tick * 0.12
  const lines: string[] = []

  // Oscilloscope: a clean sine on ch1 plus a slower PWM-style 0..1 ramp.
  lines.push(`${SNK} SCOPE ch1 ${fixed(Math.sin(phase * 2), 4)}`)
  lines.push(`${SNK} SCOPE pwm ${fixed(0.5 + 0.5 * Math.sin(phase), 4)}`)

  // Multimeter: a voltage wobbling around the 3.3 V rail's midpoint.
  lines.push(`${SNK} METER adc0 ${fixed(1.65 + 0.4 * Math.sin(phase * 0.7))} V`)

  // Plotter: two named series.
  const temp = 22 + 2 * Math.sin(phase * 0.3)
  const light = Math.round(50 + 40 * Math.sin(phase * 0.5 + 1))
  lines.push(`${SNK} PLOT temp=${fixed(temp, 1)} light=${light}`)

  // IMU: a gentle tumble in roll / pitch / yaw (degrees).
  lines.push(
    `${SNK} IMU imu ${fixed(20 * Math.sin(phase))} ${fixed(15 * Math.sin(phase * 0.8 + 1))} ${fixed(
      (tick * 3) % 360
    )}`
  )

  // Distance: a sensor sweeping ~30–270 mm.
  lines.push(`${SNK} DIST dist ${Math.round(150 + 120 * Math.sin(phase * 0.6))}`)

  // Encoder: a monotonically rising count.
  lines.push(`${SNK} ENC enc ${tick}`)

  // Button "a": a brief press every ~5 s so the Button instrument blinks.
  lines.push(`${SNK} BTN a ${tick % 40 < 3 ? 1 : 0}`)

  // Heartbeat every ~2 s advertising the simulated capabilities.
  if (tick % 16 === 0) {
    lines.push(`${SNK} READY scope meter plot imu dist enc btn`)
  }

  return lines
}

/**
 * Answer the Board Viewer live-pin probe. The probe code prints one
 * `<<SNKV>><index>:<value>` line per wired pin; we extract those indices and
 * return a value for each so the Live View animates. Values span 0..65535 (a
 * believable `read_u16()` / `duty_u16()` range) and drift with `tick`. Returns
 * the stdout the renderer's `parseProbeOutput` expects (lines joined by `\n`).
 */
export function simulateProbeResponse(code: string, tick: number): string {
  const indices: number[] = []
  const re = new RegExp(`${PROBE_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+):`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const idx = Number.parseInt(m[1], 10)
    if (Number.isInteger(idx) && !indices.includes(idx)) indices.push(idx)
  }
  return indices
    .map((idx) => {
      const v = Math.round(32768 * (1 + Math.sin(tick * 0.4 + idx)))
      return `${PROBE_MARK}${idx}:${v}`
    })
    .join('\n')
}

/** Does this exec snippet look like a Board Viewer live-pin probe? */
export function isProbeCode(code: string): boolean {
  return code.includes(PROBE_MARK)
}
