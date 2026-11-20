/**
 * ANIMATE MODE — pure helpers for posing a robot by hand.
 * =============================================================================
 * The Build workspace has two modes: **Assemble** (shape the model) and
 * **Animate** (pose it and build motion). These are the parts of Animate that
 * need no three.js or React, so they can be unit-tested:
 *
 *  - live mirroring: a joint you turn drives its left↔right partner,
 *  - grouping joints by limb for the Joints panel,
 *  - the angle a ring drag asks for, and
 *  - naming a pose saved with one press.
 */
import type { MirrorPair } from '../../../shared/robot'
import { mirrorName } from '../../../shared/robot-timeline'

export type BuildMode = 'assemble' | 'animate'

const MODE_KEY = 'snakie:buildMode'
const MIRROR_KEY = 'snakie:animateMirror'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** The remembered mode, or `fallback` when nothing (or junk) is stored. */
export function loadBuildMode(store: Store | undefined, fallback: BuildMode): BuildMode {
  try {
    const v = store?.getItem(MODE_KEY)
    return v === 'assemble' || v === 'animate' ? v : fallback
  } catch {
    return fallback
  }
}

export function saveBuildMode(store: Store | undefined, mode: BuildMode): void {
  try {
    store?.setItem(MODE_KEY, mode)
  } catch {
    /* a preference not persisting is non-fatal */
  }
}

export function loadLiveMirror(store: Store | undefined): boolean {
  try {
    return store?.getItem(MIRROR_KEY) === '1'
  } catch {
    return false
  }
}

export function saveLiveMirror(store: Store | undefined, on: boolean): void {
  try {
    store?.setItem(MIRROR_KEY, on ? '1' : '0')
  } catch {
    /* non-fatal */
  }
}

/** A joint's travel, in the same units as the values being mirrored. */
export interface Travel {
  lower: number
  upper: number
}

/**
 * LIVE MIRROR — the values the partner joints take when `changed` joints move.
 *
 * Each mirror pair copies the changed side onto the other. An `invert` pair is
 * an opposite-facing partner, so its value is reflected about the middle of the
 * TARGET joint's travel — the same rule the timeline's Mirror uses, so a pose
 * mirrored live and a clip mirrored afterwards agree. Results are clamped into
 * the target's travel. When both sides of a pair changed in one go (a drag that
 * spans both legs) neither is overwritten.
 */
export function mirrorPatch(
  values: Record<string, number>,
  changed: Iterable<string>,
  pairs: MirrorPair[],
  travel: Record<string, Travel>
): Record<string, number> {
  const moved = new Set(changed)
  const out: Record<string, number> = {}
  for (const p of pairs) {
    const aMoved = moved.has(p.a)
    const bMoved = moved.has(p.b)
    if (aMoved === bMoved) continue // neither, or both: nothing to copy
    const src = aMoved ? p.a : p.b
    const dst = aMoved ? p.b : p.a
    const v = values[src]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const t = travel[dst]
    let next = v
    if (p.invert) next = (t ? t.lower + t.upper : 0) - v
    if (t) next = Math.min(t.upper, Math.max(t.lower, next))
    out[dst] = next
  }
  return out
}

/** Which side of the robot a joint belongs to, by its name. */
export type Side = 'left' | 'right' | 'centre'

export interface JointGroup {
  side: Side
  label: string
  joints: string[]
}

const LEFT_FIRST = /left|(^|[_-])l(?=[_-]|\d|$)|L$/

/** `left` / `right` from the name (the same conventions Mirror pairs use). */
export function jointSide(name: string): Side {
  const partner = mirrorName(name)
  if (!partner) return 'centre'
  if (/left/i.test(name)) return 'left'
  if (/right/i.test(name)) return 'right'
  return LEFT_FIRST.test(name) ? 'left' : 'right'
}

/**
 * The Joints panel's sections: Body (no side), then Left and Right. A joint
 * with no partner on the robot still sits on its named side. Empty sections are
 * dropped, and joint order within a section follows the model.
 */
export function groupJoints(names: string[]): JointGroup[] {
  const by: Record<Side, string[]> = { centre: [], left: [], right: [] }
  for (const n of names) by[jointSide(n)].push(n)
  const groups: JointGroup[] = [
    { side: 'centre', label: 'Body', joints: by.centre },
    { side: 'left', label: 'Left side', joints: by.left },
    { side: 'right', label: 'Right side', joints: by.right }
  ]
  const kept = groups.filter((g) => g.joints.length > 0)
  // A robot with no left/right naming at all is just "Joints".
  if (kept.length === 1 && kept[0].side === 'centre') kept[0].label = 'Joints'
  return kept
}

/** A joint name as a person would say it: `hip_left` → `Hip left`. */
export function friendlyJointName(name: string): string {
  const s = name
    .replace(/_joint$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  if (!s) return name
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The signed swing from pointer angle `from` to `to` (radians), taken the short
 * way round, so a drag that crosses the ±π seam doesn't jump a full turn.
 */
export function shortArc(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** The next free `Pose N` name, for a pose saved with one press. */
export function nextPoseName(existing: Iterable<string>): string {
  const taken = new Set(existing)
  let n = taken.size + 1
  while (taken.has(`Pose ${n}`)) n++
  return `Pose ${n}`
}

/** True when two postures differ by more than rounding noise. */
export function posturesDiffer(a: Record<string, number>, b: Record<string, number>, eps = 1e-5): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > eps) return true
  }
  return false
}

// ── Pose shelf ───────────────────────────────────────────────────────────────

/** A saved pose as the shelf sees it (display units: degrees / millimetres). */
export interface ShelfPose {
  name: string
  values: Record<string, number>
}

/**
 * MIRROR A POSE — the same pose with left and right swapped, so "Step left"
 * gives "Step right". Each mirror pair trades values (an `invert` pair reflects
 * about the middle of the receiving joint's travel, as live Mirror does); joints
 * with no partner keep their value. A partial pose stays partial: a side the
 * pose never stored is not invented.
 */
export function mirrorPoseValues(
  values: Record<string, number>,
  pairs: MirrorPair[],
  travel: Record<string, Travel>
): Record<string, number> {
  const out: Record<string, number> = { ...values }
  const carry = (from: string, to: string, invert?: boolean): void => {
    const v = values[from]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      delete out[to]
      return
    }
    const t = travel[to]
    let next = invert ? (t ? t.lower + t.upper : 0) - v : v
    if (t) next = Math.min(t.upper, Math.max(t.lower, next))
    out[to] = Number(next.toFixed(2))
  }
  for (const p of pairs) {
    carry(p.a, p.b, p.invert)
    carry(p.b, p.a, p.invert)
  }
  return out
}

const swapSideWord = (name: string): string =>
  name.replace(/\b(left|right)\b/gi, (w) => {
    const other = w.toLowerCase() === 'left' ? 'right' : 'left'
    if (w === w.toUpperCase()) return other.toUpperCase()
    return w[0] === w[0].toUpperCase() ? other[0].toUpperCase() + other.slice(1) : other
  })

/**
 * A name for a mirrored pose: "Step left" → "Step right"; a name with no side
 * in it gets " mirrored". Never collides with an existing pose.
 */
export function mirroredPoseName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const swapped = swapSideWord(name)
  const base = swapped !== name ? swapped : `${name} mirrored`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** Identifies a pose's CONTENT, so a thumbnail is redrawn only when it changes. */
export function poseKey(pose: ShelfPose): string {
  const parts = Object.keys(pose.values)
    .sort()
    .map((k) => `${k}:${pose.values[k]}`)
  return `${pose.name}|${parts.join(',')}`
}

/**
 * The source rectangle to crop out of a `canvasW`×`canvasH` render so the robot
 * (its on-screen bounding box, in canvas pixels) fills a thumbnail of the given
 * aspect with a little air around it. The rectangle keeps the aspect exactly and
 * may run past the canvas edge — the caller paints the background first.
 */
export function thumbnailCrop(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  aspect: number,
  pad = 0.14
): { x: number; y: number; w: number; h: number } {
  const bw = Math.max(1, box.maxX - box.minX)
  const bh = Math.max(1, box.maxY - box.minY)
  let w = bw * (1 + pad * 2)
  let h = bh * (1 + pad * 2)
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}
