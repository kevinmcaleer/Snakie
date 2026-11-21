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

  // Barometer/BME280: temperature (°C), pressure (hPa) drifting CHANGE→FAIR and
  // relative humidity (%RH) — so the Barometer's dial, thermometer and hygrometer
  // all animate on the simulated device (#216).
  const pressure = 1009 + 8 * Math.sin(phase * 0.15)
  const humidity = Math.round(52 + 12 * Math.sin(phase * 0.22 + 0.5))
  lines.push(`${SNK} ENV env ${fixed(temp, 1)} ${fixed(pressure, 1)} ${humidity}`)

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
    lines.push(`${SNK} READY scope meter plot env imu dist enc btn`)
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

/**
 * THE PROGRAM'S OWN TELEMETRY WINS OVER THE DEMO (kevsrobots Snakie Instruments
 * course). The simulated board streams demo telemetry all the time so an
 * instrument animates with nothing running — but a learner's program that plots
 * `sine` and `cosine` then shared the Plotter with the demo's `temp` and `light`,
 * whose 0–90 range squashed the program's ±1 waves flat. So once a program
 * streams a kind itself (or its source calls the helper that would), the demo
 * stops sending that kind until the program ends.
 *
 * Kinds are grouped so a program's line hides the demo line the same instrument
 * draws: `PWM` (from `read_pwm`) is drawn on the scope, `IMUQ` on the IMU view.
 */
const KIND_GROUP: Record<string, string> = { PWM: 'SCOPE', IMUQ: 'IMU' }
const groupOf = (kind: string): string => KIND_GROUP[kind] ?? kind

/** `instruments` helpers → the telemetry kind each one prints. */
const HELPER_KINDS: Record<string, string> = {
  scope: 'SCOPE',
  read_pwm: 'SCOPE',
  meter: 'METER',
  read_adc: 'METER',
  plot: 'PLOT',
  imu: 'IMU',
  imu_quat: 'IMU',
  env: 'ENV',
  distance: 'DIST',
  encoder: 'ENC',
  button: 'BTN'
}

/** The telemetry kind of one `SNK <KIND> …` line, or null. */
export function telemetryKind(line: string): string | null {
  const m = /^\s*SNK ([A-Z]+)\b/.exec(line)
  return m ? m[1] : null
}

/**
 * The `instruments` helpers a program's source calls — `inst.plot(…)`,
 * `instruments.meter(…)`, or a name pulled in with `from instruments import
 * plot`. Best-effort and cheap (no parser): it reads imports and call sites.
 */
export function instrumentsHelperCalls(code: string): Set<string> {
  const calls = new Set<string>()
  const prefixes: string[] = []
  // A name brought in with `from instruments import …` → the helper it is.
  const bare = new Map<string, string>()
  for (const m of code.matchAll(/^\s*import\s+([^\n#]+)/gm)) {
    for (const part of m[1].split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/)
      if (name === 'instruments') prefixes.push(alias ?? name)
    }
  }
  for (const m of code.matchAll(/^\s*from\s+instruments\s+import\s+([^\n#]+)/gm)) {
    for (const part of m[1].replace(/[()]/g, '').split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/)
      if (name) bare.set(alias ?? name, name)
    }
  }
  const star = [...bare.keys()].includes('*')
  for (const m of code.matchAll(/(?:\b(\w+)\.)?\b(\w+)\s*\(/g)) {
    const [, owner, fn] = m
    if (owner) {
      if (prefixes.includes(owner)) calls.add(fn)
    } else {
      const helper = bare.get(fn) ?? (star && HELPER_KINDS[fn] ? fn : undefined)
      if (helper) calls.add(helper)
    }
  }
  return calls
}

/**
 * The kinds a program's SOURCE will stream, from its `instruments` calls. Read
 * before the run starts, so the demo is quiet from the first frame rather than
 * after the program's first line.
 */
export function programTelemetryKinds(code: string): Set<string> {
  const kinds = new Set<string>()
  for (const helper of instrumentsHelperCalls(code)) {
    const kind = HELPER_KINDS[helper]
    if (kind) kinds.add(kind)
  }
  return kinds
}

/**
 * Tracks which kinds the running program owns and filters the demo frame. One
 * per simulated device; `begin` at a run's start, `note` on the program's
 * output, `end` when it stops (or the interpreter restarts).
 */
export class DemoTelemetryGate {
  private owned = new Set<string>()
  /** Carry for a line split across output chunks. */
  private partial = ''

  /** A program is starting: claim the kinds its source will stream. */
  begin(code: string): void {
    this.owned = new Set([...programTelemetryKinds(code)].map(groupOf))
    this.partial = ''
  }

  /** Program output: claim any kind it actually streams. */
  note(text: string): void {
    const lines = (this.partial + text).split(/\r?\n/)
    this.partial = (lines.pop() ?? '').slice(-200)
    for (const line of lines) {
      const kind = telemetryKind(line)
      if (kind) this.owned.add(groupOf(kind))
    }
  }

  /** The program stopped: the demo may send everything again. */
  end(): void {
    this.owned.clear()
    this.partial = ''
  }

  /** The demo frame with the program's kinds taken out. */
  filter(frame: string[]): string[] {
    if (this.owned.size === 0) return frame
    return frame.filter((line) => {
      const kind = telemetryKind(line)
      return !kind || kind === 'READY' || !this.owned.has(groupOf(kind))
    })
  }
}
