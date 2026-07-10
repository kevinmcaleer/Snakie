/**
 * SERVO ↔ JOINT BINDING (#) — pure helpers that connect a breadboard servo to a
 * URDF joint. The bridge is `RobotModel.servoJointMap` (pin ↔ joint) in `robot.yml`,
 * shared by the Board View (this is where a servo gets wired to a GPIO) and the
 * Robot View (where the joint lives + the live `SNK SERVO` telemetry drives it).
 *
 * Dependency-light (only `normPin`) so both views + tests can import it.
 */
import type { PartDefinition } from '../../../shared/part'
import type { RobotConnection, ServoJointBinding } from '../../../shared/robot'
import { normPin } from './robot-pose'

/** Whether a placed part is a servo (something that drives a joint). Matches the
 *  word "servo" anywhere in the part's family / tags / id / name — covers the
 *  standard `SG90` (family `Motor`, tags `[servo, pwm, …]`) and hand-authored parts. */
export function isServoPart(def: PartDefinition | undefined | null): boolean {
  if (!def) return false
  const hay = `${def.family ?? ''} ${(def.tags ?? []).join(' ')} ${def.id ?? ''} ${def.name ?? ''}`.toLowerCase()
  return /\bservo\b/.test(hay)
}

/** Split a wire endpoint (`"partId.PinName#12"` or `"board.GP16#3"`) into its
 *  subject key + pin name; the trailing `#index` is dropped. */
export function endpointParts(ep: string): { key: string; pin: string } {
  const hash = ep.lastIndexOf('#')
  const head = hash >= 0 ? ep.slice(0, hash) : ep
  const dot = head.indexOf('.')
  return dot >= 0 ? { key: head.slice(0, dot), pin: head.slice(dot + 1) } : { key: head, pin: '' }
}

/**
 * The board GPIO (normalised, e.g. `"16"`) a placed servo's signal is wired to, or
 * `null`. Finds a wire between the part and a NUMERIC board pin — a GPIO; power pins
 * like `3V3` / `GND` / `VBUS` normalise to non-numeric and are skipped, so the one
 * that matches is the servo's signal.
 */
export function servoBoardGpio(partId: string, connections: RobotConnection[]): string | null {
  for (const c of connections) {
    const a = endpointParts(c.from)
    const b = endpointParts(c.to)
    const board = a.key === partId ? b : b.key === partId ? a : null
    if (!board || board.key !== 'board') continue
    const gp = normPin(board.pin)
    if (/^\d+$/.test(gp)) return gp
  }
  return null
}

/** The joint a GPIO currently drives in the servo map, or `null`. */
export function boundJoint(map: ServoJointBinding[] | undefined, gpio: string): string | null {
  const b = (map ?? []).find((x) => normPin(x.pin) === normPin(gpio))
  return b ? b.joint : null
}

/**
 * Return an updated servo map that binds `gpio` → `joint` (replacing any existing
 * binding on that pin). An empty `joint` UNBINDS the pin. New bindings get a neutral
 * 0…180 servo + joint range; the Robot View's servo editor tunes it against the
 * joint's real limits.
 */
export function bindServoJoint(
  map: ServoJointBinding[] | undefined,
  gpio: string,
  joint: string
): ServoJointBinding[] {
  const rest = (map ?? []).filter((x) => normPin(x.pin) !== normPin(gpio))
  if (!joint) return rest
  const prev = (map ?? []).find((x) => normPin(x.pin) === normPin(gpio))
  return [
    ...rest,
    prev && prev.joint === joint
      ? prev
      : { pin: gpio, joint, servoMin: 0, servoMax: 180, jointMin: 0, jointMax: 180 }
  ]
}
