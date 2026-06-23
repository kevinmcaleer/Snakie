/**
 * GAMEPAD / TELEOP LOGIC (#110) — the pure, DOM-free core for the Gamepad
 * instrument body.
 * =============================================================================
 *
 * Drives a robot LIVE from a browser-Gamepad (or on-screen sticks/sliders): a
 * raw axis/button reading is shaped by a per-output MAPPING (deadzone / invert /
 * scale / trim, clamped) and the shaped values are assembled into the named
 * `{output: value}` axes record + pressed-button record that
 * `buildTeleopPayload(axes, buttons)` (`src/shared/control.ts`) serialises into
 * the `SNKCMD teleop axes=… btn:…` line the device `control.axes("teleop")` /
 * `control.pressed("teleop", btn)` helpers parse.
 *
 * Kept React/DOM/Gamepad-API-free (it takes plain numbers + a snapshot record,
 * not a live `Gamepad`) so every rule below is unit-testable in a plain node
 * environment — mirrors `instruments-registry.ts`, `parse-pins.ts`,
 * `instrument-host.ts`. The component reads `navigator.getGamepads()` and feeds
 * the snapshot in; nothing here touches the browser.
 *
 * SAFETY is encoded here too (the panel cannot be safe if the math isn't): the
 * deadman gate zeroes ALL outputs unless held, and E-STOP forces every mapped
 * output (axis + button) to its safe zero. Both are pure functions the tests
 * pin, so "no hold ⇒ nothing moves" and "E-STOP ⇒ everything zeroed" are
 * guaranteed by the same code the UI runs.
 */

/** Which kind of physical input an output is bound to. */
export type SourceKind = 'axis' | 'button'

/**
 * One output mapping: a named robot output (`drive`, `turn`, `servo1`, …) bound
 * to a gamepad axis OR button index, shaped by deadzone/invert/scale/trim and
 * clamped to ±`scale` (then to the global ±1 envelope).
 */
export interface OutputMapping {
  /** The robot output name — becomes the axes-record key the device reads. */
  name: string
  /** Bind to a gamepad `axis` or `button`. */
  kind: SourceKind
  /** The gamepad axis/button index this output reads. */
  index: number
  /** Dead band around centre (0..1 of the raw range) zeroed to remove drift. */
  deadzone: number
  /** Flip the sense of the input (so e.g. "up" can map to "forward"). */
  invert: boolean
  /** Output magnitude scale — the shaped value is multiplied by this. */
  scale: number
  /** A centre offset added AFTER scaling (mechanical trim), then re-clamped. */
  trim: number
}

/** A button mapping: a named button output bound to a gamepad button index. */
export interface ButtonMapping {
  /** The button output name — becomes the `btn:<name>=1` key the device reads. */
  name: string
  /** The gamepad button index this output reads. */
  index: number
}

/** A flat, serialisable snapshot of a connected gamepad (what we poll each frame). */
export interface GamepadSnapshot {
  /** Whether a gamepad is connected this frame (drives disconnect → stop). */
  connected: boolean
  /** Raw axis values, each in roughly [-1, 1] (browser Gamepad API order). */
  axes: number[]
  /** Raw button pressed states (browser Gamepad API order). */
  buttons: boolean[]
}

/** A default-centred, disconnected snapshot — the safe "no input" baseline. */
export const EMPTY_SNAPSHOT: GamepadSnapshot = { connected: false, axes: [], buttons: [] }

/** Clamp `v` into the inclusive `[lo, hi]` range (NaN ⇒ `lo`). */
export function clamp(v: number, lo = -1, hi = 1): number {
  if (Number.isNaN(v)) return lo
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

/**
 * Apply a deadzone of half-width `dz` (0..1) around centre to a raw axis in
 * [-1, 1], RESCALING the surviving range back to full travel so the output
 * still reaches ±1 at the stick's edge (a plain cut would cap the max). Inside
 * the band → exactly 0 (kills idle drift). `dz <= 0` is a pass-through; `dz >= 1`
 * zeroes everything.
 */
export function applyDeadzone(raw: number, dz: number): number {
  const r = clamp(raw)
  if (dz <= 0) return r
  if (dz >= 1) return 0
  const mag = Math.abs(r)
  if (mag <= dz) return 0
  // Rescale [dz, 1] → [0, 1] so travel past the band uses the full output range.
  const scaled = (mag - dz) / (1 - dz)
  return r < 0 ? -scaled : scaled
}

/**
 * Shape a raw axis value through one {@link OutputMapping}: deadzone → invert →
 * scale → trim, clamped to the ±1 output envelope. This is the single rule the
 * mapping editor's per-output knobs (deadzone/invert/scale/trim) drive, and the
 * function the tests pin. Pure; never throws.
 */
export function applyMapping(raw: number, m: OutputMapping): number {
  let v = applyDeadzone(raw, m.deadzone)
  if (m.invert) v = -v
  v = v * m.scale
  v = v + m.trim
  return clamp(v)
}

/**
 * Round an output value to a compact, deterministic wire string (≤3 dp, no
 * trailing zeros, no `-0`) so the streamed `SNKCMD` line stays short and stable
 * frame-to-frame. Pure helper used when assembling the axes record.
 */
export function roundOutput(v: number, dp = 3): number {
  const f = 10 ** dp
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

/**
 * Assemble the named axes record from a gamepad snapshot + the axis mappings.
 *
 * For each {@link OutputMapping}, reads its bound source (an axis value, or a
 * button as 0/1) from the snapshot, shapes it via {@link applyMapping}, rounds
 * it and stores it under the output NAME. A missing index reads as 0 (so an
 * unplugged/short gamepad yields a safe centred output, never `undefined`).
 * Pure; the device's `control.axes("teleop")` consumes exactly these names.
 */
export function buildAxesRecord(
  snap: GamepadSnapshot,
  mappings: OutputMapping[]
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of mappings) {
    const rawSource =
      m.kind === 'button' ? (snap.buttons[m.index] ? 1 : 0) : (snap.axes[m.index] ?? 0)
    out[m.name] = roundOutput(applyMapping(rawSource, m))
  }
  return out
}

/**
 * Assemble the pressed-button record from a snapshot + the button mappings.
 *
 * `{ name: true }` only for buttons whose bound index is pressed this frame
 * (absence ⇒ not pressed, matching `buildTeleopPayload`, which only lists
 * pressed buttons). A missing index reads as not-pressed. Pure.
 */
export function buildButtonRecord(
  snap: GamepadSnapshot,
  mappings: ButtonMapping[]
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const m of mappings) {
    out[m.name] = snap.buttons[m.index] === true
  }
  return out
}

/** The fully-shaped teleop frame: named axes + pressed buttons, ready to stream. */
export interface TeleopFrame {
  axes: Record<string, number>
  buttons: Record<string, boolean>
}

/**
 * The safe zero for a set of mappings: every axis output → 0, every button → not
 * pressed. The single source of truth for what "stopped" means, shared by the
 * deadman gate, E-STOP and disconnect so they all agree. Pure.
 */
export function zeroFrame(
  axisMappings: OutputMapping[],
  buttonMappings: ButtonMapping[]
): TeleopFrame {
  const axes: Record<string, number> = {}
  for (const m of axisMappings) axes[m.name] = 0
  const buttons: Record<string, boolean> = {}
  for (const m of buttonMappings) buttons[m.name] = false
  return { axes, buttons }
}

/** The inputs to the per-frame safety + mapping resolver. */
export interface ResolveInput {
  /** This frame's gamepad snapshot (or {@link EMPTY_SNAPSHOT} for sticks-only). */
  snap: GamepadSnapshot
  /** The axis output mappings (deadzone/invert/scale/trim). */
  axisMappings: OutputMapping[]
  /** The button output mappings. */
  buttonMappings: ButtonMapping[]
  /** Whether the deadman is HELD (hold-to-drive). No hold ⇒ all zero. */
  deadmanHeld: boolean
  /** Whether E-STOP is latched. When set, forces every output to zero. */
  estop: boolean
}

/**
 * Resolve one frame to the values that should be STREAMED to the board, applying
 * the full safety model in priority order:
 *
 *   1. **E-STOP** latched              → {@link zeroFrame} (everything zeroed).
 *   2. **gamepad disconnected**        → {@link zeroFrame} (disconnect ⇒ stop).
 *   3. **deadman NOT held**            → {@link zeroFrame} (hold-to-drive).
 *   4. otherwise                       → the live mapped frame.
 *
 * So the ONLY way non-zero values leave this function is a connected gamepad,
 * no E-STOP, AND the deadman held — exactly the panel's safety contract. Pure
 * and total; the component streams the result via
 * `sendControl('teleop', buildTeleopPayload(frame.axes, frame.buttons))`.
 */
export function resolveTeleopFrame(input: ResolveInput): TeleopFrame {
  const { snap, axisMappings, buttonMappings, deadmanHeld, estop } = input
  if (estop || !snap.connected || !deadmanHeld) {
    return zeroFrame(axisMappings, buttonMappings)
  }
  return {
    axes: buildAxesRecord(snap, axisMappings),
    buttons: buildButtonRecord(snap, buttonMappings)
  }
}

/**
 * Is a frame entirely zero (no axis moving, no button pressed)? Lets the
 * component skip streaming a redundant all-zero line once it has already sent
 * the stop (throttling idle traffic) while still being safe — the first stop
 * always goes out. Pure.
 */
export function isZeroFrame(frame: TeleopFrame): boolean {
  for (const v of Object.values(frame.axes)) if (v !== 0) return false
  for (const v of Object.values(frame.buttons)) if (v) return false
  return true
}

/** Sensible factory for a new axis output mapping (no shaping, full scale). */
export function newOutputMapping(name: string, index: number, kind: SourceKind = 'axis'): OutputMapping {
  return { name, kind, index, deadzone: 0.08, invert: false, scale: 1, trim: 0 }
}

/**
 * The default differential-drive mapping most robots start from: a left-stick
 * `drive` (Y axis, inverted so pushing up = forward) + `turn` (X axis), and a
 * `fire` button on index 0. Lets the panel + tests share one realistic starting
 * mapping. Pure factory.
 */
export function defaultMapping(): {
  axisMappings: OutputMapping[]
  buttonMappings: ButtonMapping[]
} {
  return {
    axisMappings: [
      { name: 'drive', kind: 'axis', index: 1, deadzone: 0.08, invert: true, scale: 1, trim: 0 },
      { name: 'turn', kind: 'axis', index: 0, deadzone: 0.08, invert: false, scale: 1, trim: 0 }
    ],
    buttonMappings: [{ name: 'fire', index: 0 }]
  }
}
