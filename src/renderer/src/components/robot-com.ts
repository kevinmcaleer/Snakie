/**
 * ROBOT CENTRE OF MASS (#556, epic #535 §2) — the shared service the CoM +
 * support-polygon overlay (#558), the stability strip (#535 §3), the balance
 * parameters (§4) and the runtime export (§6) all build on.
 *
 * The robot's centre of mass is the mass-weighted average of its links' CoMs at
 * the CURRENT pose. Two pieces, deliberately separated so the maths tests
 * without a renderer (like `robot-explode.ts` / `robot-mass-geometry.ts`):
 *
 *  1. {@link centreOfMass} — pure: weighted average of `{massKg, comWorld}`.
 *  2. {@link robotWorldCoM} — thin three.js glue that transforms each link's
 *     LOCAL CoM (from its `<inertial>`) by the link's `matrixWorld` and feeds
 *     the pure function. Per-link world transforms are read straight from the
 *     `urdf-loader` scene graph — no FK walker (see #536 Bone Mode) — so this is
 *     cheap enough to recompute every frame as joints move.
 *
 * NOTE this lives outside `src/shared/ik/`: that module is planar/2-D and
 * mirrored 1:1 by `snakie_ik.py`; 3-D mass maths there would break its contract.
 *
 * UNITS: kilograms + metres throughout, matching the URDF `<inertial>` the mass
 * data comes from. Callers presenting grams/mm convert at their boundary.
 */
import { Matrix4, Vector3 } from 'three'
import { readInertial } from './robot-assembly'

export type Vec3 = [number, number, number]

/** A link's mass + the world position its mass acts at. */
export interface MassPoint {
  massKg: number
  comWorld: Vec3
}

/** The whole robot's mass + centre of mass (world frame). */
export interface CoMResult {
  massKg: number
  comWorld: Vec3
}

/**
 * Mass-weighted centre of a set of point masses, or null when the total mass is
 * zero (no CoM is defined — the caller shows "no mass set yet" rather than a
 * point at the origin). Non-positive or non-finite masses are skipped, so a
 * half-weighed robot still yields the CoM of the parts that DO have a mass.
 */
export function centreOfMass(points: readonly MassPoint[]): CoMResult | null {
  let total = 0
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    const m = p.massKg
    if (!Number.isFinite(m) || m <= 0) continue
    total += m
    x += m * p.comWorld[0]
    y += m * p.comWorld[1]
    z += m * p.comWorld[2]
  }
  if (total <= 0) return null
  return { massKg: total, comWorld: [x / total, y / total, z / total] }
}

/** A link's static mass data: its mass and the CoM in its OWN (local) frame. */
export interface LinkMass {
  massKg: number
  comLocalM: Vec3
}

/**
 * Read every named link's `<inertial>` mass + local CoM from the URDF text.
 *
 * Static (pose-independent), so a caller reads this once per edit and reuses it
 * across frames; only {@link robotWorldCoM}'s transform step runs per frame.
 * Links without a usable `<inertial>` are omitted.
 */
export function readLinkMasses(urdf: string, links: readonly string[]): Record<string, LinkMass> {
  const out: Record<string, LinkMass> = {}
  for (const link of links) {
    const inertial = readInertial(urdf, link)
    if (inertial && inertial.mass > 0) {
      out[link] = { massKg: inertial.mass, comLocalM: inertial.com }
    }
  }
  return out
}

/**
 * The robot's world-frame CoM at its current pose.
 *
 * `linkMatrix(link)` returns the link's `matrixWorld` (or null if absent) —
 * in the app, `(l) => robot.links[l]?.matrixWorld ?? null` after
 * `robot.updateMatrixWorld(true)`. Taking an accessor (not the robot) keeps this
 * unit-testable with plain three.js objects. Returns null when nothing is
 * weighed or no matrices resolve.
 */
export function robotWorldCoM(
  linkMatrix: (link: string) => Matrix4 | null | undefined,
  masses: Record<string, LinkMass>
): CoMResult | null {
  const points: MassPoint[] = []
  const v = new Vector3()
  for (const [link, m] of Object.entries(masses)) {
    const mat = linkMatrix(link)
    if (!mat) continue
    v.set(m.comLocalM[0], m.comLocalM[1], m.comLocalM[2]).applyMatrix4(mat)
    points.push({ massKg: m.massKg, comWorld: [v.x, v.y, v.z] })
  }
  return centreOfMass(points)
}

/**
 * Drop the CoM straight down onto the ground plane — the projection point the
 * support-polygon check (#558) compares against.
 *
 * Snakie's world is Y-up (the loaded robot is rotated so URDF Z-up becomes scene
 * Y-up, baked into `matrixWorld`), so "down" zeroes Y. The ground isn't always at
 * y = 0 — the grid sits at the robot's lowest point — so the overlay passes the
 * real ground height; it defaults to 0.
 */
export function groundProjection(com: Vec3, groundY = 0): Vec3 {
  return [com[0], groundY, com[2]]
}
