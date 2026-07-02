/**
 * SERVO instrument logic — pure, DOM-free, unit-tested (mirrors led-logic).
 *
 * The control payloads MUST match the `servo_command` grammar in
 * `micropython/instruments.py`. Angles are degrees (0..180 by default); the PWM
 * math is the standard hobby-servo mapping (50 Hz frame, ~0.5–2.5 ms pulse).
 */
export const SERVO_TARGET = 'servo'

/** Full mechanical range of a typical hobby servo. */
export const SERVO_MIN_DEG = 0
export const SERVO_MAX_DEG = 180

/** 50 Hz frame; pulse 0.5 ms (0°) → 2.5 ms (180°) over a 20 ms period. */
const PERIOD_US = 20000
const PULSE_MIN_US = 500
const PULSE_MAX_US = 2500

function clamp(n: number, lo: number, hi: number): number {
  return !Number.isFinite(n) ? lo : n < lo ? lo : n > hi ? hi : n
}

/** `angle <deg>` — command the servo to an angle (rounded, clamped 0..180). */
export function anglePayload(deg: number): string {
  return `angle ${Math.round(clamp(deg, SERVO_MIN_DEG, SERVO_MAX_DEG))}`
}

/** `pin <n>` — (re)attach the servo to a GPIO (the orange signal wire). */
export function pinPayload(gpio: number): string {
  return `pin ${Math.trunc(clamp(gpio, 0, 40))}`
}

/** `detach` — release the servo (stop holding torque, quells buzz at the stop). */
export function detachPayload(): string {
  return 'detach'
}

/** Angle (deg) → PWM duty fraction (0..1) at 50 Hz — the on-screen wave. */
export function angleToDuty(deg: number): number {
  const us = PULSE_MIN_US + (clamp(deg, SERVO_MIN_DEG, SERVO_MAX_DEG) / 180) * (PULSE_MAX_US - PULSE_MIN_US)
  return us / PERIOD_US
}

/** PWM duty fraction (0..1) → angle (deg) — the live read-back from the pin. */
export function dutyToAngle(duty: number): number {
  const us = clamp(duty, 0, 1) * PERIOD_US
  return clamp(((us - PULSE_MIN_US) / (PULSE_MAX_US - PULSE_MIN_US)) * 180, SERVO_MIN_DEG, SERVO_MAX_DEG)
}

/** The angle at sweep progress `t` (0..1) bouncing between `a` and `b` (ping-pong). */
export function sweepAngle(a: number, b: number, t: number): number {
  const tri = 1 - Math.abs(((clamp(t, 0, 1) * 2) % 2) - 1) // 0→1→0 triangle
  return a + (b - a) * tri
}

/**
 * The servo GPIO declared in the active file, so the panel's PIN follows the code
 * — `inst.start(servo_pin=0)` or `Servo(16)` / `Servo(pin=16)`. Undefined when
 * none is found (the panel keeps its current pin).
 */
export function parseServoPin(source: string): number | undefined {
  if (!source) return undefined
  const m = source.match(/\bservo_pin\s*=\s*(\d+)/) ?? source.match(/\bServo\(\s*(?:pin\s*=\s*)?(\d+)/)
  return m ? Number(m[1]) : undefined
}
