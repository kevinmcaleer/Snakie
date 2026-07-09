/**
 * Robot definition file (#128) — the structured project spec that lists the
 * parts placed in a build and the pin-to-pin wiring between them. Stored as a
 * human-readable `robot.yml` in the project folder (see `src/shared/robot-yaml.ts`).
 *
 * It is the data the Board Viewer's **Wiring** mode reads/writes: the chosen
 * microcontroller, the parts dropped onto the canvas (each a placed instance of a
 * library part), and the wires connecting their pins. Dependency-free so the
 * renderer (the wiring canvas), the preload (the `robot.*` DTOs) and the main
 * process (disk IO) can all import it.
 */

/** A placed part instance on the wiring canvas. */
export interface RobotPart {
  /** Unique instance id within the project (e.g. `dist1`). The wire endpoints
   *  reference pins as `"<id>.<PinName>"`. */
  id: string
  /** The library the part comes from (its folder id). */
  lib: string
  /** The part id within that library. */
  part: string
  /** Optional human label shown on the canvas (defaults to the part name). */
  label?: string
  /** Canvas position in viewBox units (where the box's top-left sits). */
  x?: number
  y?: number
  /** Clockwise rotation on the breadboard, in degrees (0/90/180/270). */
  rotation?: number
}

/** The electrical net of a wire — drives its colour. */
export type RobotNet = 'vcc' | 'gnd' | 'signal'

/** One wire between two pins. Endpoints are `"<partId>.<Pin>"`, or
 *  `"board.<Pin>"` for the microcontroller. */
export interface RobotConnection {
  id: string
  from: string
  to: string
  /** Electrical net (vcc/gnd/signal); drives the default colour. */
  net?: RobotNet
  /** Explicit colour override (any CSS colour). Falls back to the net colour. */
  color?: string
}

/**
 * The robot-MODEL section of a KRF `robot.yml` (epic #309 / #310). All fields
 * are optional so a legacy wiring-only robot.yml still loads. Pure helpers to
 * read/validate this live in {@link ./krf}.
 */
export interface RobotModel {
  /** KRF schema version (bumped on breaking changes). */
  version?: number
  /** Path to the `.urdf` file, relative to the project root (e.g. `urdf/arm.urdf`). */
  urdf?: string
  /** The link the user designated as the base (root) of the kinematic tree — the
   *  anchor every other part hangs off. Distinguishes the intended base from other
   *  as-yet-unconnected imported parts (#354). */
  baseLink?: string
  /** Servo pin ↔ URDF joint bindings with angle calibration (Phase 3). */
  servoJointMap?: ServoJointBinding[]
  /** Per-joint limit / calibration overrides edited in-app (Phase 2). */
  joints?: Record<string, JointConfig>
  /** Per-joint absolute roll about its own normal axis, in DEGREES (#354). The URDF
   *  `<origin rpy>` already bakes this in; it's remembered here so the joint editor
   *  can show the current roll and edit it absolutely (deltas re-applied to the rpy),
   *  instead of the field resetting to 0 each time the dialog reopens. */
  jointRoll?: Record<string, number>
  /** The default pose applied on load: joint name → value (deg / mm). */
  defaultPose?: Record<string, number>
  /** Saved named poses (Phase 2). */
  poses?: NamedPose[]
  /** The choreographed motion timeline (Phase 4, #314). */
  timeline?: MotionTimeline
  /** Left↔right joint mirror pairs, for symmetric gaits (Phase 4). */
  mirror?: MirrorPair[]
}

/** A servo(pin) ↔ URDF joint binding with angle-range calibration (Phase 3). */
export interface ServoJointBinding {
  /** The board pin the servo signal is on (e.g. `GP0`, or a bare pin number). */
  pin: string
  /** The URDF joint this servo drives. */
  joint: string
  /** Servo input range in degrees (default 0…180). */
  servoMin?: number
  servoMax?: number
  /** Joint output range the servo maps onto (revolute = degrees, prismatic = mm). */
  jointMin: number
  jointMax: number
  /** Reverse the mapping (servo min → joint max). */
  invert?: boolean
}

/** Per-joint limit overrides (edited in the pose tool, written back here). */
export interface JointConfig {
  min?: number
  max?: number
}

/** A saved pose: joint name → value (degrees for revolute, mm for prismatic). */
export interface NamedPose {
  name: string
  values: Record<string, number>
}

/** Interpolation between motion keyframes (Phase 4). */
export type MotionEasing = 'linear' | 'easeInOut'

/** One keyframe on a joint's track: time `t` (seconds) → `value` (deg / mm). */
export interface MotionKey {
  t: number
  value: number
}

/** A per-joint keyframe track (`joint` is a movable, non-mimic joint). */
export interface MotionTrack {
  joint: string
  /** Keyframes, sorted ascending by `t`. */
  keys: MotionKey[]
}

/** A choreographed motion clip — the timeline (Phase 4, #314). Values are in
 *  DISPLAY units (deg / mm) like {@link NamedPose}. */
export interface MotionTimeline {
  /** Loop length in seconds. */
  duration: number
  /** Interpolation between keys. */
  easing: MotionEasing
  /** Preview loop + exported `while True`. */
  loop: boolean
  /** Preview / export sample rate (default 20). */
  fps?: number
  /** One track per animated joint. */
  tracks: MotionTrack[]
}

/** A left↔right mirror pairing (`a` copies onto `b`), for symmetric gaits. */
export interface MirrorPair {
  a: string
  b: string
  /** Reflect the value about the joint's neutral (opposite-axis partner). */
  invert?: boolean
}

/** A full robot/project definition. */
export interface RobotDefinition {
  /** Project name. */
  name?: string
  /** Free-text project / robot description. */
  description?: string
  /** The microcontroller board id (a built-in or user board, e.g. `pico2w`). */
  board?: string
  /** Optional canvas position for the microcontroller box. */
  boardX?: number
  boardY?: number
  /** The placed parts. */
  parts: RobotPart[]
  /** The pin-to-pin wires. */
  connections: RobotConnection[]
  /** The KRF robot-model section (URDF, servo↔joint map, poses) — optional so a
   *  legacy wiring-only robot.yml is unaffected (epic #309). */
  robot?: RobotModel
}

/** A fresh, empty robot definition. */
export function blankRobot(): RobotDefinition {
  return { parts: [], connections: [] }
}

/** Power/ground wire colours (signal wires get an explicit/assigned colour). */
export const VCC_COLOR = '#c0392b'
export const GND_COLOR_LIGHT = '#16191d'
export const GND_COLOR_DARK = '#e9edf1'

/** A palette of distinct signal-wire colours, assigned round-robin on connect. */
export const SIGNAL_COLORS = [
  '#4ea1ff',
  '#46e06a',
  '#d6a531',
  '#b06af0',
  '#ef6f9b',
  '#3ec8c8',
  '#e8843c',
  '#8a9bff'
]

/** Pick a signal colour for the Nth signal wire (round-robins the palette). */
export function signalColor(n: number): string {
  return SIGNAL_COLORS[((n % SIGNAL_COLORS.length) + SIGNAL_COLORS.length) % SIGNAL_COLORS.length]
}

/**
 * The render colour for a connection: an explicit `color` wins; otherwise
 * `vcc` is red, `gnd` is black (or white in dark mode), and `signal` falls back
 * to a neutral grey when it has no stored colour.
 */
export function connectionColor(conn: RobotConnection, isDark: boolean): string {
  if (conn.color) return conn.color
  if (conn.net === 'vcc') return VCC_COLOR
  if (conn.net === 'gnd') return isDark ? GND_COLOR_DARK : GND_COLOR_LIGHT
  return '#8a8f96'
}

/** Stable id for a connection between two endpoints (order-independent-ish). */
export function connectionId(from: string, to: string): string {
  return `${from}__${to}`
}
