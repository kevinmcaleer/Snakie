/**
 * MOTOR instrument logic — pure, DOM-free, unit-tested (mirrors servo-logic).
 *
 * The control payloads MUST match the `motor_command` grammar in
 * `micropython/instruments.py`.
 *
 * The wire unit is a **signed power in [-1, 1]**, not a raw PWM count. That is
 * deliberate: it is the same unit `teleop.arcade_mix` already emits, and it keeps
 * the panel independent of what is actually on the other end — a TB6612 over I²C
 * scales it to ±255, a bare PWM H-bridge to a duty cycle, and neither needs the
 * IDE to know which it is.
 */

/** The control-channel target this panel writes to (`SNKCMD motor …`). */
export const MOTOR_TARGET = 'motor'

/** The two channels the panel drives, as the drivers name them. */
export type MotorChannel = 'a' | 'b'

/** Power is normalised: full reverse to full forward. */
export const POWER_MIN = -1
export const POWER_MAX = 1

/** Decimal places on the wire — matches teleop's axis rounding. */
const WIRE_DP = 3

export function clamp(n: number, lo: number, hi: number): number {
  return !Number.isFinite(n) ? lo : n < lo ? lo : n > hi ? hi : n
}

/** Round a power to the wire precision, normalising `-0` to `0`. Pure. */
export function roundPower(v: number): number {
  const p = 10 ** WIRE_DP
  const r = Math.round(clamp(v, POWER_MIN, POWER_MAX) * p) / p
  return r === 0 ? 0 : r
}

/** `run <a> <b>` — set BOTH channels in one line (the common case). */
export function runPayload(a: number, b: number): string {
  return `run ${roundPower(a)} ${roundPower(b)}`
}

/** `a <power>` / `b <power>` — set a single channel. */
export function channelPayload(ch: MotorChannel, power: number): string {
  return `${ch} ${roundPower(power)}`
}

/** `stop` — release both channels so the motors coast. */
export function stopPayload(): string {
  return 'stop'
}

/** `brake` — actively brake both channels (windings shorted). */
export function brakePayload(): string {
  return 'brake'
}

/** `standby <0|1>` — disable (1) or enable (0) the driver outputs. */
export function standbyPayload(on: boolean): string {
  return `standby ${on ? 1 : 0}`
}

/**
 * Apply a steering `trim` to a master power, giving `[a, b]`.
 *
 * Trim is the calibration this panel exists for: two nominally identical motors
 * never run at the same rate, so a rover drifts. Positive trim favours A, negative
 * favours B. The FASTER side is held and the other reduced, rather than boosting
 * past the commanded power — at full throttle there is no headroom to boost into,
 * so a symmetric mix would silently clip and make the trim do nothing exactly
 * where it matters most.
 */
export function applyTrim(power: number, trim: number): [number, number] {
  const p = clamp(power, POWER_MIN, POWER_MAX)
  const t = clamp(trim, -1, 1)
  const cut = 1 - Math.abs(t)
  return t >= 0 ? [p, roundPower(p * cut)] : [roundPower(p * cut), p]
}

/**
 * Mix a throttle + steering pair into `[a, b]` wheel powers (arcade mixing).
 * The same maths as the device-side `teleop.arcade_mix`, restated here so the
 * panel can show what a stick WOULD do without a board attached.
 */
export function arcadeMix(throttle: number, steering: number): [number, number] {
  const th = clamp(throttle, -1, 1)
  const st = clamp(steering, -1, 1)
  return [clamp(th + st, -1, 1), clamp(th - st, -1, 1)]
}

/** Format a power as a signed percentage for the readout (e.g. `-42%`). */
export function formatPower(power: number): string {
  const pct = Math.round(clamp(power, POWER_MIN, POWER_MAX) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

/**
 * The I²C address of a Grove motor driver declared in the active file, so the
 * panel can show which board it is talking to — `GroveMotorDriver(i2c, addr=0x70)`
 * or `board.motors()`. Undefined when none is found.
 */
export function parseMotorAddr(source: string): number | undefined {
  if (!source) return undefined
  const m = source.match(/GroveMotorDriver\([^)]*addr\s*=\s*(0x[0-9a-fA-F]+|\d+)/)
  return m ? Number(m[1]) : undefined
}
