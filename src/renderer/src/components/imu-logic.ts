/**
 * IMU LOGIC (#111) — pure, DOM-free math + parsing for the IMU 3D orientation
 * viewer.
 * =============================================================================
 *
 * The IMU panel renders a small CSS-3D board that rotates in real time from a
 * device's orientation, reported either as Euler angles (roll/pitch/yaw) or as a
 * unit quaternion. ALL the maths and the telemetry parsing live here so they can
 * be unit-tested in plain node (mirrors `instrument-telemetry.ts`,
 * `instrument-host.ts`, `parse-pins.ts`): nothing here imports React or touches
 * the DOM, and nothing throws — a malformed line simply yields `null`.
 *
 * The panel itself (`ImuInstrument.tsx`) is SELF-CONTAINED: because the shared
 * telemetry parser (`instrument-telemetry.ts`) only knows SCOPE/METER/PLOT and
 * must not be edited, this module carries its own `SNK IMU` / `SNK IMUQ` line
 * grammar and its own `ImuTelemetry` / `ImuQuatTelemetry` reading types. The
 * board-side protocol (one `print()` per reading, ASCII, space-delimited):
 *
 *   SNK IMU  <ch> <roll> <pitch> <yaw>     → Euler degrees (right-hand, deg)
 *   SNK IMUQ <ch> <w> <x> <y> <z>          → unit quaternion (w,x,y,z)
 *
 * `<ch>` is a user channel label (the LAST reading on any channel wins — the
 * panel is a singleton showing one orientation at a time).
 *
 * Angle convention: roll = rotation about the board's X (nose) axis, pitch =
 * rotation about Y, yaw = rotation about Z, in DEGREES. The CSS transform applies
 * them in the order yaw → pitch → roll (Z·Y·X / intrinsic), which matches the
 * Tait–Bryan ZYX convention used by the quaternion→Euler conversion below, so a
 * quaternion and its converted Euler angles drive the board identically.
 */

/** A parsed Euler-angle IMU reading (degrees). */
export interface ImuTelemetry {
  kind: 'imu'
  /** User channel label (last channel wins in the singleton panel). */
  ch: string
  /** Roll about the X (nose) axis, degrees. */
  roll: number
  /** Pitch about the Y axis, degrees. */
  pitch: number
  /** Yaw about the Z axis, degrees. */
  yaw: number
}

/** A parsed quaternion IMU reading (w, x, y, z). */
export interface ImuQuatTelemetry {
  kind: 'imuq'
  ch: string
  w: number
  x: number
  y: number
  z: number
}

/** Either flavour of IMU reading produced by {@link parseImu}. */
export type ImuReading = ImuTelemetry | ImuQuatTelemetry

/** Roll / pitch / yaw in degrees — the panel's canonical orientation. */
export interface Euler {
  roll: number
  pitch: number
  yaw: number
}

/** The neutral / level orientation used when no data has arrived. */
export const NEUTRAL_EULER: Euler = { roll: 0, pitch: 0, yaw: 0 }

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/** The IMU sub-commands this panel understands (its OWN, parser-local grammar). */
const IMU_KIND = 'IMU'
const IMUQ_KIND = 'IMUQ'

/** The shared telemetry sentinel (duplicated locally to avoid editing the parser). */
export const IMU_SENTINEL = 'SNK'

/**
 * Parse one already-de-newlined serial line into an IMU reading, or `null` for a
 * non-IMU / malformed line. Recognises ONLY `SNK IMU …` and `SNK IMUQ …`; every
 * other line (including SCOPE/METER/PLOT telemetry) yields `null` so the caller
 * ignores it. Never throws. Tolerates leading whitespace and runs of spaces.
 *
 *   SNK IMU  <ch> <roll> <pitch> <yaw>   → { kind:'imu',  ch, roll, pitch, yaw }
 *   SNK IMUQ <ch> <w> <x> <y> <z>        → { kind:'imuq', ch, w, x, y, z }
 */
export function parseImu(line: string): ImuReading | null {
  if (!line) return null
  const trimmed = line.trim()
  if (trimmed !== IMU_SENTINEL && !trimmed.startsWith(`${IMU_SENTINEL} `)) return null
  const parts = trimmed.split(/\s+/)
  if (parts[0] !== IMU_SENTINEL) return null
  const kind = parts[1]

  if (kind === IMU_KIND) {
    // SNK IMU <ch> <roll> <pitch> <yaw>
    const ch = parts[2]
    const roll = Number(parts[3])
    const pitch = Number(parts[4])
    const yaw = Number(parts[5])
    if (!ch || !Number.isFinite(roll) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
      return null
    }
    return { kind: 'imu', ch, roll, pitch, yaw }
  }

  if (kind === IMUQ_KIND) {
    // SNK IMUQ <ch> <w> <x> <y> <z>
    const ch = parts[2]
    const w = Number(parts[3])
    const x = Number(parts[4])
    const y = Number(parts[5])
    const z = Number(parts[6])
    if (
      !ch ||
      !Number.isFinite(w) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      return null
    }
    return { kind: 'imuq', ch, w, x, y, z }
  }

  return null
}

/**
 * Convert a quaternion `(w, x, y, z)` to Tait–Bryan ZYX Euler angles in DEGREES
 * (roll about X, pitch about Y, yaw about Z). The quaternion is normalised first
 * (a zero quaternion → {@link NEUTRAL_EULER}), and pitch is clamped to ±90° at
 * the gimbal-lock poles so `asin` stays in range. Pure, never throws.
 */
export function quaternionToEuler(w: number, x: number, y: number, z: number): Euler {
  const n = Math.sqrt(w * w + x * x + y * y + z * z)
  if (!Number.isFinite(n) || n === 0) return { ...NEUTRAL_EULER }
  const qw = w / n
  const qx = x / n
  const qy = y / n
  const qz = z / n

  // Roll (X-axis rotation).
  const sinrCosp = 2 * (qw * qx + qy * qz)
  const cosrCosp = 1 - 2 * (qx * qx + qy * qy)
  const roll = Math.atan2(sinrCosp, cosrCosp)

  // Pitch (Y-axis rotation), clamped at the poles.
  const sinp = 2 * (qw * qy - qz * qx)
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp)

  // Yaw (Z-axis rotation).
  const sinyCosp = 2 * (qw * qz + qx * qy)
  const cosyCosp = 1 - 2 * (qy * qy + qz * qz)
  const yaw = Math.atan2(sinyCosp, cosyCosp)

  return { roll: roll * DEG, pitch: pitch * DEG, yaw: yaw * DEG }
}

/** Lift any {@link ImuReading} to Euler degrees (Euler passes straight through). */
export function readingToEuler(r: ImuReading): Euler {
  if (r.kind === 'imu') return { roll: r.roll, pitch: r.pitch, yaw: r.yaw }
  return quaternionToEuler(r.w, r.x, r.y, r.z)
}

/**
 * Wrap an angle in degrees to the half-open range (−180, 180]. Used so the
 * readout and calibration subtraction never show a jumpy ±360° wrap. Pure.
 */
export function wrapDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  // ((deg + 180) mod 360) − 180, with mod made always-positive, then map −180→180.
  let v = ((((deg + 180) % 360) + 360) % 360) - 180
  if (v === -180) v = 180
  return v
}

/**
 * Apply a calibration offset: subtract the captured `offset` orientation from the
 * `current` one, per axis, wrapping each result to (−180, 180]. Capturing the
 * current orientation as the offset therefore "levels" the board (zeroes it).
 * Pure; both inputs untouched.
 */
export function applyCalibration(current: Euler, offset: Euler): Euler {
  return {
    roll: wrapDeg(current.roll - offset.roll),
    pitch: wrapDeg(current.pitch - offset.pitch),
    yaw: wrapDeg(current.yaw - offset.yaw)
  }
}

/**
 * Build the CSS `transform` value that rotates the 3D board into `e`.
 *
 * Applied in the order `rotateZ(yaw) rotateX(pitch) rotateY(roll)` — CSS applies
 * transforms left-to-right as nested frames, so this realises the intrinsic
 * ZYX (yaw→pitch→roll) Tait–Bryan convention that {@link quaternionToEuler}
 * produces. Angles are rounded to 3 dp to keep the style string stable across
 * tiny float jitter. Pure string builder; safe with the neutral orientation.
 */
export function eulerToCssTransform(e: Euler): string {
  const r = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '0.000')
  return `rotateZ(${r(e.yaw)}deg) rotateX(${r(e.pitch)}deg) rotateY(${r(e.roll)}deg)`
}

/**
 * The 3×3 rotation matrix (row-major, 9 numbers) for `e`, composed as Rz·Ry·Rx
 * (same ZYX convention as the CSS transform + the quaternion conversion). Handy
 * for projecting body axes or for tests that assert orientation independent of
 * the CSS string. Pure.
 */
export function eulerToMatrix(e: Euler): number[] {
  const cr = Math.cos(e.roll * RAD)
  const sr = Math.sin(e.roll * RAD)
  const cp = Math.cos(e.pitch * RAD)
  const sp = Math.sin(e.pitch * RAD)
  const cy = Math.cos(e.yaw * RAD)
  const sy = Math.sin(e.yaw * RAD)

  // Rz(yaw) · Ry(pitch) · Rx(roll).
  return [
    cy * cp,
    cy * sp * sr - sy * cr,
    cy * sp * cr + sy * sr,
    sy * cp,
    sy * sp * sr + cy * cr,
    sy * sp * cr - cy * sr,
    -sp,
    cp * sr,
    cp * cr
  ]
}

/**
 * Format one angle for the RPY readout: a signed, fixed-1-dp degree string with a
 * trailing degree sign (e.g. `+12.3°`, `−4.0°`, `  0.0°`). Pure; non-finite → 0.
 */
export function formatAngle(deg: number): string {
  const v = Number.isFinite(deg) ? deg : 0
  const sign = v > 0 ? '+' : v < 0 ? '−' : ' '
  return `${sign}${Math.abs(v).toFixed(1)}°`
}

// --- Compass (#215) ---------------------------------------------------------

/**
 * Compass HEADING (0..360°, clockwise from North) from the IMU's yaw. Yaw is a
 * right-hand rotation about Z (counter-clockwise positive, (−180, 180]); a
 * compass heading runs the other way — so heading = (−yaw) normalised to
 * [0, 360). Pure; non-finite → 0.
 */
export function headingFromYaw(yawDeg: number): number {
  if (!Number.isFinite(yawDeg)) return 0
  return ((-yawDeg % 360) + 360) % 360
}

/** The 16-wind compass rose, clockwise from North (22.5° per point). */
export const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
] as const

/** The 16-wind cardinal name nearest a heading (0..360, wraps). Pure. */
export function cardinalFor(heading: number): string {
  const h = ((heading % 360) + 360) % 360
  return CARDINALS[Math.round(h / 22.5) % 16]
}

/** Format a heading for the compass readout: zero-padded whole degrees (`237°`). */
export function formatHeading(heading: number): string {
  const h = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0
  return `${String(Math.round(h) % 360).padStart(3, '0')}°`
}
