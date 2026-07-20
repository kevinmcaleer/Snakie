/**
 * SUPPORT POLYGON + STABILITY (#558, epic #535 §2) — the pure geometry behind
 * the CoM overlay: hull the ground-contact points into a support polygon, and
 * decide whether the centre-of-mass projection keeps the robot upright.
 *
 * Static stability, no physics: a robot is statically stable exactly while its
 * CoM's vertical projection stays inside the convex hull of its ground contacts
 * (the "support polygon"). Near the edge it's marginal; outside, it tips.
 *
 * All 2-D on the ground plane. Snakie's world is Y-up, so a world point drops to
 * the ground by taking its X and Z — points here are `[x, z]`. Pure (arrays in,
 * verdict out) so it unit-tests without a renderer, like `robot-explode.ts`.
 */

/** A ground-plane point `[x, z]`, metres. */
export type Pt2 = [number, number]

/** Cross product of OA×OB — >0 left turn, <0 right, 0 collinear. */
const cross = (o: Pt2, a: Pt2, b: Pt2): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Convex hull (Andrew's monotone chain), returned counter-clockwise. Fewer than
 * three distinct points yields the input (a point or a segment — no polygon).
 */
export function convexHull2D(points: readonly Pt2[]): Pt2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const uniq = sorted.filter(
    (p, i) => i === 0 || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1]
  )
  if (uniq.length <= 2) return uniq

  const lower: Pt2[] = []
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Pt2[] = []
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Whether `p` is inside (or on) a CONVEX, CCW hull. False for a degenerate hull. */
export function pointInHull(p: Pt2, hull: readonly Pt2[]): boolean {
  if (hull.length < 3) return false
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    // A CCW hull keeps its interior to the LEFT of every edge; a strictly-right
    // point is outside. A tiny epsilon keeps on-edge points inside.
    if (cross(a, b, p) < -1e-9) return false
  }
  return true
}

/** Distance from `p` to segment `a–b`. */
function distToSegment(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

/** Shortest distance from `p` to the hull's boundary (any edge). 0 for <2 pts. */
export function distanceToHullEdge(p: Pt2, hull: readonly Pt2[]): number {
  if (hull.length < 2) return 0
  let min = Infinity
  for (let i = 0; i < hull.length; i++) {
    const d = distToSegment(p, hull[i], hull[(i + 1) % hull.length])
    if (d < min) min = d
  }
  return min
}

/** Polygon area (shoelace), always non-negative. */
export function polygonArea(hull: readonly Pt2[]): number {
  if (hull.length < 3) return 0
  let a = 0
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]
    const q = hull[(i + 1) % hull.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a) / 2
}

/** Stability verdict for the CoM projection against a support polygon. */
export type StabilityState = 'stable' | 'marginal' | 'unstable' | 'none'

export interface Stability {
  state: StabilityState
  /** Signed clearance to the boundary, MM: + inside, − outside. 0 when `none`. */
  marginMm: number
}

/**
 * Classify the CoM ground-projection against the support polygon.
 *
 * `stable` — comfortably inside. `marginal` — inside but within `marginFrac` of
 * the polygon's characteristic size (√area) from an edge, the tipping-soon warn.
 * `unstable` — outside, it tips. `none` — no polygon (fewer than three contacts).
 */
export function comStability(
  comXZ: Pt2,
  hull: readonly Pt2[],
  marginFrac = 0.1
): Stability {
  if (hull.length < 3) return { state: 'none', marginMm: 0 }
  const inside = pointInHull(comXZ, hull)
  const dist = distanceToHullEdge(comXZ, hull)
  const marginMm = Math.round(dist * 1000 * (inside ? 1 : -1))
  if (!inside) return { state: 'unstable', marginMm }
  const charSize = Math.sqrt(polygonArea(hull))
  const state: StabilityState = dist < marginFrac * charSize ? 'marginal' : 'stable'
  return { state, marginMm }
}

/**
 * Build the support polygon from world-frame contact points.
 *
 * Only contacts within `groundTolM` of the lowest contact count — a lifted foot
 * (well above the others) leaves the polygon, which is what makes a creep gait's
 * stability change as it steps. Projects the survivors to the ground plane (drop
 * Y) and hulls them.
 */
export function supportPolygon(
  worldContacts: readonly [number, number, number][],
  groundTolM = 0.002
): Pt2[] {
  if (worldContacts.length === 0) return []
  const minY = Math.min(...worldContacts.map((c) => c[1]))
  const grounded = worldContacts.filter((c) => c[1] <= minY + groundTolM)
  return convexHull2D(grounded.map((c): Pt2 => [c[0], c[2]]))
}
