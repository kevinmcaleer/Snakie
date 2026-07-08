/**
 * KRF — Kev's Robot File (epic #309 / #310).
 * =============================================================================
 *
 * A standard folder layout + a versioned robot-model section of `robot.yml`
 * for robot projects:
 *
 *   my-robot/
 *   ├── robot.yml      # manifest (wiring + the robot MODEL below)
 *   ├── code/          # MicroPython source
 *   ├── urdf/          # .urdf + meshes/
 *   └── stl/           # 3D-printable files
 *
 * The robot MODEL ({@link RobotModel}) extends the existing wiring `robot.yml`
 * with a URDF path, the servo↔joint map + calibration, per-joint limits and
 * saved poses. This module holds the PURE, unit-tested helpers: validation
 * (corruption-safe + version-migrating), the servo→joint mapping maths, and the
 * "New Robot Project" scaffold plan. No DOM / fs — the main process does the I/O.
 */
import {
  blankRobot,
  type JointConfig,
  type NamedPose,
  type RobotDefinition,
  type RobotModel,
  type ServoJointBinding
} from './robot'

/** Current KRF schema version. */
export const KRF_VERSION = 1

/** Default servo input sweep (degrees) when a binding doesn't override it. */
export const DEFAULT_SERVO_MIN = 0
export const DEFAULT_SERVO_MAX = 180

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/**
 * Map a servo angle (degrees) onto its bound joint value via the calibration.
 * Clamps to the servo range, honours `invert`, and lerps onto the joint range.
 */
export function servoToJoint(b: ServoJointBinding, servoAngle: number): number {
  const sMin = b.servoMin ?? DEFAULT_SERVO_MIN
  const sMax = b.servoMax ?? DEFAULT_SERVO_MAX
  const span = sMax - sMin
  let t = span === 0 ? 0 : (servoAngle - sMin) / span
  t = Math.max(0, Math.min(1, t))
  if (b.invert) t = 1 - t
  return b.jointMin + t * (b.jointMax - b.jointMin)
}

/** Validate one servo↔joint binding; null if it can't be salvaged. */
function sanitiseBinding(raw: unknown): ServoJointBinding | null {
  const r = (raw ?? {}) as Record<string, unknown>
  if (!isStr(r.pin) || !isStr(r.joint)) return null
  if (!isFiniteNum(r.jointMin) || !isFiniteNum(r.jointMax)) return null
  const b: ServoJointBinding = { pin: r.pin, joint: r.joint, jointMin: r.jointMin, jointMax: r.jointMax }
  if (isFiniteNum(r.servoMin)) b.servoMin = r.servoMin
  if (isFiniteNum(r.servoMax)) b.servoMax = r.servoMax
  if (r.invert === true) b.invert = true
  return b
}

/** A numeric-valued record (joint name → number), dropping bad entries. */
function sanitiseNumberMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isFiniteNum(v)) out[k] = v
    }
  }
  return out
}

/**
 * Validate the robot-model section, corruption-safe: unknown/legacy shapes and
 * bad fields are dropped, never thrown. Returns `undefined` when there's no
 * meaningful model (so a wiring-only robot.yml stays wiring-only).
 */
export function sanitiseRobotModel(raw: unknown): RobotModel | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const model: RobotModel = { version: KRF_VERSION }

  if (isStr(r.urdf) && r.urdf.trim()) model.urdf = r.urdf.trim()

  if (Array.isArray(r.servoJointMap)) {
    const map = r.servoJointMap.map(sanitiseBinding).filter((b): b is ServoJointBinding => b !== null)
    if (map.length) model.servoJointMap = map
  }

  if (r.joints && typeof r.joints === 'object') {
    const joints: Record<string, JointConfig> = {}
    for (const [name, jc] of Object.entries(r.joints as Record<string, unknown>)) {
      const j = (jc ?? {}) as Record<string, unknown>
      const cfg: JointConfig = {}
      if (isFiniteNum(j.min)) cfg.min = j.min
      if (isFiniteNum(j.max)) cfg.max = j.max
      if (cfg.min !== undefined || cfg.max !== undefined) joints[name] = cfg
    }
    if (Object.keys(joints).length) model.joints = joints
  }

  const def = sanitiseNumberMap(r.defaultPose)
  if (Object.keys(def).length) model.defaultPose = def

  if (Array.isArray(r.poses)) {
    const poses = r.poses
      .map((p): NamedPose | null => {
        const pr = (p ?? {}) as Record<string, unknown>
        if (!isStr(pr.name)) return null
        return { name: pr.name, values: sanitiseNumberMap(pr.values) }
      })
      .filter((p): p is NamedPose => p !== null)
    if (poses.length) model.poses = poses
  }

  // Nothing but the version stamp → treat as "no model".
  const keys = Object.keys(model)
  return keys.length === 1 && keys[0] === 'version' ? undefined : model
}

/** Read + validate the robot model off a parsed robot.yml object. */
export function readRobotModel(robot: RobotDefinition | null | undefined): RobotModel | undefined {
  return sanitiseRobotModel(robot?.robot)
}

/** One file the scaffold should create (path relative to the project root). */
export interface ScaffoldFile {
  path: string
  content: string
}

/** The plan for a "New Robot Project" (KRF) — the manifest object + the other
 *  files. The caller serialises `robotYml` (YAML) and writes everything. Pure. */
export interface ScaffoldPlan {
  /** The `robot.yml` manifest to serialise + write at the project root. */
  robotYml: RobotDefinition
  /** The remaining files/dirs to create. */
  files: ScaffoldFile[]
}

/** Build the KRF scaffold plan for a new project named `name`. */
export function scaffoldKrf(name: string): ScaffoldPlan {
  const clean = name.trim() || 'My Robot'
  const robotYml: RobotDefinition = {
    ...blankRobot(),
    name: clean,
    robot: { version: KRF_VERSION, urdf: 'urdf/robot.urdf', servoJointMap: [], defaultPose: {} }
  }
  const main = [
    '# ' + clean,
    'import time',
    '',
    '# Your robot code. Bind servos to URDF joints in Robot View, then the',
    '# 3D model follows your servo writes — no board required.',
    '',
    'while True:',
    '    time.sleep(1)',
    ''
  ].join('\n')
  return {
    robotYml,
    files: [
      { path: 'code/main.py', content: main },
      { path: 'urdf/.gitkeep', content: '' },
      { path: 'stl/.gitkeep', content: '' }
    ]
  }
}
