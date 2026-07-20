/**
 * GROUND-CONTACT POINTS (#557, epic #535 §2) — the feet/wheels the support
 * polygon (#558) is hulled from.
 *
 * A robot's ground contacts are stored per link in `robot.yml`
 * (`RobotModel.contacts`), each a point in that LINK's own frame, in metres. As
 * the robot poses, a foot's world position changes, so the world contact set is
 * recomputed per frame by transforming each point by its link's `matrixWorld` —
 * exactly like the CoM service (#556).
 *
 * Pure maths + a thin three.js transform, split so the geometry tests without a
 * renderer. UNITS: metres (scene/URDF native); the editor UI converts mm↔m.
 */
import { Matrix4, Vector3 } from 'three'

export type Vec3 = [number, number, number]

/** A contact point resolved to the world frame, tagged with its owning link. */
export interface WorldContact {
  link: string
  world: Vec3
}

/**
 * Transform every link's local contact points into the world frame at the
 * current pose.
 *
 * `linkMatrix(link)` returns the link's `matrixWorld` (or null if absent) — in
 * the app, `(l) => robot.links[l]?.matrixWorld ?? null` after
 * `robot.updateMatrixWorld(true)`. An accessor (not the robot) keeps this
 * unit-testable with plain three.js objects.
 */
export function contactWorldPoints(
  linkMatrix: (link: string) => Matrix4 | null | undefined,
  contacts: Record<string, Vec3[]>
): WorldContact[] {
  const out: WorldContact[] = []
  const v = new Vector3()
  for (const [link, pts] of Object.entries(contacts)) {
    const mat = linkMatrix(link)
    if (!mat) continue
    for (const p of pts) {
      v.set(p[0], p[1], p[2]).applyMatrix4(mat)
      out.push({ link, world: [v.x, v.y, v.z] })
    }
  }
  return out
}

/** Total number of contact points across all links. */
export function contactCount(contacts: Record<string, Vec3[]> | undefined): number {
  if (!contacts) return 0
  let n = 0
  for (const pts of Object.values(contacts)) n += pts.length
  return n
}

/**
 * Add a contact point to a link, returning a NEW map (never mutates the input) —
 * the immutable-update shape the robot.yml persist path expects.
 */
export function addContact(
  contacts: Record<string, Vec3[]> | undefined,
  link: string,
  point: Vec3
): Record<string, Vec3[]> {
  const next = { ...(contacts ?? {}) }
  next[link] = [...(next[link] ?? []), point]
  return next
}

/** Remove the contact at `index` from a link; drops the link key when it empties. */
export function removeContact(
  contacts: Record<string, Vec3[]> | undefined,
  link: string,
  index: number
): Record<string, Vec3[]> {
  const next = { ...(contacts ?? {}) }
  const pts = (next[link] ?? []).filter((_, i) => i !== index)
  if (pts.length) next[link] = pts
  else delete next[link]
  return next
}

/** Replace one contact point's coordinates (in metres), returning a new map. */
export function setContact(
  contacts: Record<string, Vec3[]> | undefined,
  link: string,
  index: number,
  point: Vec3
): Record<string, Vec3[]> {
  const next = { ...(contacts ?? {}) }
  const pts = [...(next[link] ?? [])]
  if (index < 0 || index >= pts.length) return next
  pts[index] = point
  next[link] = pts
  return next
}
