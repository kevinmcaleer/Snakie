/**
 * WHAT A PIN'S PWM MEANS FOR A JOINT (#1321) — the robot frame's arithmetic.
 *
 * The code frame reports pins: "GP15 is PWM at duty 4915". A project's wiring
 * carries the bindings: "the servo on GP15 turns the `shoulder` joint, 0 to
 * 180 degrees onto -90 to 90". This joins the two. Pure, so it is unit-tested.
 */
import type { ServoJointBinding } from '../../../shared/robot'
import { servoToJoint } from '../../../shared/krf'

/** A hobby servo's pulse: 0.5 ms at 0 degrees to 2.5 ms at 180, sent 50 times a second. */
const PULSE_MIN_MS = 0.5
const PULSE_MAX_MS = 2.5
const SERVO_HZ = 50

/** The angle (0 to 180) a servo takes for a 16-bit PWM duty at `freq` Hz. */
export function dutyToServoAngle(duty: number, freq = SERVO_HZ): number {
  const period = 1000 / (freq > 0 ? freq : SERVO_HZ)
  const pulse = (Math.max(0, Math.min(65535, duty)) / 65535) * period
  const t = (pulse - PULSE_MIN_MS) / (PULSE_MAX_MS - PULSE_MIN_MS)
  return Math.max(0, Math.min(1, t)) * 180
}

/** `GP15`, `gp15`, `GPIO15` and `15` are one pin. */
export function pinNumber(pin: string): string {
  const m = /^(?:gp|gpio|io|d)?(\d+)$/i.exec(String(pin).trim())
  return m ? String(Number(m[1])) : String(pin).trim().toUpperCase()
}

export interface PinState {
  kind: 'p' | 'w'
  value: number
}

/**
 * Joint name → value (degrees, or mm for a sliding joint) for every bound pin
 * that is sending a servo pulse. A duty of 0 is a servo switched off, not a
 * servo at 0 degrees, so it moves nothing.
 */
export function jointsFromPins(
  states: Readonly<Record<string, PinState>>,
  bindings: readonly ServoJointBinding[] | undefined
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!bindings) return out
  const byPin = new Map<string, PinState>()
  for (const [pin, state] of Object.entries(states)) byPin.set(pinNumber(pin), state)
  for (const b of bindings) {
    const state = byPin.get(pinNumber(b.pin))
    if (!state || state.kind !== 'w' || state.value <= 0) continue
    out[b.joint] = servoToJoint(b, dutyToServoAngle(state.value))
  }
  return out
}

/** A project file as the kevsrobots API lists it. */
export interface ProjectFileEntry {
  id: number
  filename: string
}

/** The URDF among a project's files: the one the wiring names, else the first. */
export function pickUrdf(files: readonly ProjectFileEntry[], named?: string | null): ProjectFileEntry | null {
  const urdfs = files.filter((f) => /\.urdf$/i.test(f.filename))
  if (urdfs.length === 0) return null
  const want = named ? named.split('/').pop()?.toLowerCase() : null
  return (want && urdfs.find((f) => f.filename.toLowerCase() === want)) || urdfs[0]
}

/** A mesh path in a URDF (`package://arm/meshes/base.stl`) → the project file with that name. */
export function meshFile(path: string, files: readonly ProjectFileEntry[]): ProjectFileEntry | null {
  const name = decodeURIComponent(path.split(/[?#]/)[0]).split(/[\\/]/).pop()?.toLowerCase()
  if (!name) return null
  return files.find((f) => f.filename.toLowerCase() === name) ?? null
}
