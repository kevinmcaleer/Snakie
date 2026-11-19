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
