/**
 * skeleton.json — the auto-generated device-side skeleton (#537, epic #533 §2).
 * =============================================================================
 *
 * The project URDF stays the SINGLE SOURCE OF TRUTH; this module derives a
 * compact `skeleton.json` from it on every save/export — never hand-edited.
 * JSON (not YAML) because MicroPython parses JSON natively, so a Pico needs no
 * extra parser. The on-device runtime (`snakie_ik.py`, §4) reads it to get
 * bones, joint limits and servo bindings.
 *
 * Per joint: unique name, type (revolute / continuous / prismatic / fixed),
 * parent/child link, origin (native URDF metres/radians, for full kinematics),
 * bone length in mm (distance between joint origins — a joint's `<origin xyz>`
 * is expressed in the parent link's frame, whose origin IS the parent joint's
 * frame, so |xyz| is exactly the parent-joint → this-joint bone), axis, min/max
 * limits from the URDF `<limit>` (degrees for revolute/continuous, mm travel
 * for prismatic — Snakie's display units), and the servo binding (pin +
 * calibration) where the project's `servoJointMap` maps one.
 *
 * The document embeds `urdf_hash` (a whitespace-insensitive FNV-1a hash of the
 * source URDF) + `schema_version`, so Snakie can tell a stale device copy at
 * connect time. EXTENSIBILITY: `links` is a per-link section — today each link
 * is an empty object; epic #535 adds `mass_g` / `com_xyz` per link and bumps
 * {@link SKELETON_SCHEMA_VERSION}.
 *
 * Dependency-free (regex parse, no DOMParser) so it runs in the renderer, the
 * main process AND node unit tests — the same pattern as `urdf-export.ts`.
 */
import type { ServoJointBinding } from './robot'
import { DEFAULT_SERVO_MAX, DEFAULT_SERVO_MIN } from './krf'
import { robotNameOf } from './urdf-export'

/** Current skeleton.json schema version — bump on breaking shape changes
 *  (epic #535 will bump it when per-link `mass_g` / `com_xyz` land). */
export const SKELETON_SCHEMA_VERSION = 1

/** The device path skeleton.json is pushed to on the board. */
export const SKELETON_DEVICE_PATH = '/skeleton.json'

/** Joint types the skeleton carries (the URDF subset the builder authors). */
export type SkeletonJointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic'
const JOINT_TYPES: readonly string[] = ['fixed', 'revolute', 'continuous', 'prismatic']

/** The servo binding a joint carries when the project maps one (pin +
 *  calibration, mirroring {@link ServoJointBinding} in snake_case JSON). */
export interface SkeletonServo {
  /** Normalised board GPIO (e.g. `"16"` for `GP16`) — what the on-device
   *  `servos_command` / PWM layer keys on. */
  pin: string
  /** Servo input sweep in degrees (defaults 0…180). */
  servo_min: number
  servo_max: number
  /** Joint range the sweep maps onto (deg for revolute, mm for prismatic). */
  joint_min: number
  joint_max: number
  /** Present (true) when the mapping is reversed. */
  invert?: boolean
}

/** One joint of the skeleton. */
export interface SkeletonJoint {
  name: string
  type: SkeletonJointType
  parent: string
  child: string
  /** `<origin xyz>` in the parent link frame — native URDF metres. */
  origin_xyz: [number, number, number]
  /** `<origin rpy>` — native URDF radians. */
  origin_rpy: [number, number, number]
  /** Distance between the parent joint's origin and this joint's origin, mm. */
  bone_length_mm: number
  /** Rotation/slide axis, or omitted for a fixed joint (no `<axis>`). */
  axis?: [number, number, number]
  /** URDF `<limit>` in display units — deg (revolute/continuous) or mm travel
   *  (prismatic). Omitted when the URDF declares none. */
  limits?: { min: number; max: number }
  /** Servo binding where the project maps one. */
  servo?: SkeletonServo
  /** A `<mimic>` coupling (`value = multiplier·master + offset`), if any. */
  mimic?: { joint: string; multiplier: number; offset: number }
}

/** Per-link section — EMPTY today, reserved so epic #535 can add `mass_g` /
 *  `com_xyz` per link without restructuring the document. */
export interface SkeletonLink {
  mass_g?: number
  com_xyz?: [number, number, number]
}

/** The full skeleton.json document. */
export interface SkeletonDoc {
  schema_version: number
  /** Whitespace-insensitive hash of the source URDF ({@link urdfHash}). */
  urdf_hash: string
  /** The robot's `<robot name>`. */
  robot: string
  joints: SkeletonJoint[]
  /** Every link, keyed by name (see {@link SkeletonLink}). */
  links: Record<string, SkeletonLink>
}

/**
 * Whitespace-insensitive FNV-1a (32-bit) hash of a URDF, as `fnv1a-xxxxxxxx`.
 * Inter-tag whitespace is collapsed first, so pretty-printing the URDF (the
 * clean `urdf/` export writes a reformatted copy of the live file) does NOT
 * change the hash — only real structural edits flag the device copy stale.
 */
export function urdfHash(urdf: string): string {
  const canon = urdf.replace(/>\s+</g, '><').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i)
    // 32-bit FNV prime multiply via shifts (keeps every step in uint32 range).
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}`
}

/** Normalise a board pin to its bare GPIO number string (`GP16` → `16`) —
 *  mirrors the renderer's `normPin` without importing renderer code. */
function normalisePin(pin: string): string {
  return String(pin).trim().replace(/^gp/i, '')
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Parse `"x y z"` into a finite 3-vector (missing/bad components → 0). */
function parseVec3(s: string): [number, number, number] {
  const parts = s.trim().split(/\s+/).map(Number)
  const at = (i: number): number => (Number.isFinite(parts[i]) ? parts[i] : 0)
  return [at(0), at(1), at(2)]
}

/** Every `<link name="…">` in document order (deduped). */
function linkNames(urdf: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /<link\b[^>]*\bname\s*=\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

/** Parse one `<joint>` (attrs + body) into a {@link SkeletonJoint} sans servo. */
function parseJoint(attrs: string, body: string): SkeletonJoint | null {
  const name = /\bname\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? ''
  const parent = /<parent\b[^>]*\blink\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? ''
  const child = /<child\b[^>]*\blink\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? ''
  if (!name || !child) return null
  const typeRaw = /\btype\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? 'fixed'
  const type = (JOINT_TYPES.includes(typeRaw) ? typeRaw : 'fixed') as SkeletonJointType
  const xyzM = /<origin\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(body)
  const rpyM = /<origin\b[^>]*\brpy\s*=\s*"([^"]+)"/i.exec(body)
  const xyz = xyzM ? parseVec3(xyzM[1]) : ([0, 0, 0] as [number, number, number])
  const joint: SkeletonJoint = {
    name,
    type,
    parent,
    child,
    origin_xyz: xyz,
    origin_rpy: rpyM ? parseVec3(rpyM[1]) : [0, 0, 0],
    bone_length_mm: round2(Math.hypot(xyz[0], xyz[1], xyz[2]) * 1000)
  }
  const axisM = /<axis\b[^>]*\bxyz\s*=\s*"([^"]+)"/i.exec(body)
  if (axisM) joint.axis = parseVec3(axisM[1])
  const limM = /<limit\b([^>]*?)\/?>/i.exec(body)
  if (limM && type !== 'fixed') {
    const lower = /\blower\s*=\s*"([^"]+)"/.exec(limM[1])?.[1]
    const upper = /\bupper\s*=\s*"([^"]+)"/.exec(limM[1])?.[1]
    if (lower != null && upper != null && Number.isFinite(Number(lower)) && Number.isFinite(Number(upper))) {
      // rad → deg for a rotating joint, m → mm travel for a sliding one.
      const scale = type === 'prismatic' ? 1000 : 180 / Math.PI
      joint.limits = { min: round2(Number(lower) * scale), max: round2(Number(upper) * scale) }
    }
  }
  const mimM = /<mimic\b([^>]*?)\/?>/i.exec(body)
  if (mimM) {
    joint.mimic = {
      joint: /\bjoint\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '',
      multiplier: Number(/\bmultiplier\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '1'),
      offset: Number(/\boffset\s*=\s*"([^"]+)"/.exec(mimM[1])?.[1] ?? '0')
    }
  }
  return joint
}

/**
 * Generate the skeleton document from a URDF + the project's servo↔joint map.
 * Pure and deterministic: joints in document order (a duplicate joint name —
 * invalid URDF — keeps the first occurrence only, so a device runtime keyed by
 * name never gets silently shadowed entries), links in document order.
 */
export function generateSkeleton(urdf: string, servoJointMap?: ServoJointBinding[]): SkeletonDoc {
  const joints: SkeletonJoint[] = []
  const seen = new Set<string>()
  const re = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(urdf))) {
    const j = parseJoint(m[1], m[2])
    if (!j || seen.has(j.name)) continue
    seen.add(j.name)
    const b = (servoJointMap ?? []).find((x) => x.joint === j.name)
    if (b) {
      j.servo = {
        pin: normalisePin(b.pin),
        servo_min: b.servoMin ?? DEFAULT_SERVO_MIN,
        servo_max: b.servoMax ?? DEFAULT_SERVO_MAX,
        joint_min: b.jointMin,
        joint_max: b.jointMax
      }
      if (b.invert) j.servo.invert = true
    }
    joints.push(j)
  }
  const links: Record<string, SkeletonLink> = {}
  for (const name of linkNames(urdf)) links[name] = {}
  // Links referenced by joints but missing a `<link>` tag still get an entry.
  for (const j of joints) {
    if (j.parent && !(j.parent in links)) links[j.parent] = {}
    if (!(j.child in links)) links[j.child] = {}
  }
  return {
    schema_version: SKELETON_SCHEMA_VERSION,
    urdf_hash: urdfHash(urdf),
    robot: robotNameOf(urdf),
    joints,
    links
  }
}

/** Serialise a skeleton doc — pretty-printed (it's small; readability wins,
 *  and MicroPython's `json.load` doesn't care). */
export function skeletonJson(doc: SkeletonDoc): string {
  return JSON.stringify(doc, null, 2) + '\n'
}

/**
 * Where skeleton.json lives for a given URDF path: the PROJECT ROOT — the
 * parent of a KRF `urdf/` folder (`proj/urdf/arm.urdf` → `proj/skeleton.json`),
 * else right beside the file. Sits next to robot.yml so it syncs with the code.
 */
export function skeletonPathFor(urdfPath: string): string {
  const norm = urdfPath.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  let dir = slash >= 0 ? norm.slice(0, slash) : ''
  if (/^urdf$/i.test(dir)) dir = ''
  else dir = dir.replace(/\/urdf$/i, '')
  return `${dir ? dir + '/' : ''}skeleton.json`
}

/** The `urdf_hash` embedded in a skeleton.json string, or null (missing /
 *  unparseable / not a string). */
export function readSkeletonHash(json: string | null | undefined): string | null {
  if (!json) return null
  try {
    const doc = JSON.parse(json) as { urdf_hash?: unknown }
    return typeof doc.urdf_hash === 'string' && doc.urdf_hash ? doc.urdf_hash : null
  } catch {
    return null
  }
}

/**
 * Whether a device-side skeleton.json is STALE against the current source URDF
 * — missing/unreadable device copies count as stale (there's nothing current on
 * the board). Drives the connect-time "skeleton out of date — sync?" warning.
 */
export function skeletonStale(deviceJson: string | null | undefined, urdf: string): boolean {
  return readSkeletonHash(deviceJson) !== urdfHash(urdf)
}
