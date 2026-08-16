/**
 * CABLE ROUTING (#745) — the path a cabled lead takes between two connectors.
 *
 * A lead used to be one cubic from pad to pad, with each control point pushed
 * along its pin's normal. That gives a clean EXIT but knows nothing about the
 * boards in between, so a QWIIC lead between two modules ran diagonally across
 * the face of the board it left — hiding the silk and reading nothing like a
 * cable.
 *
 * A real lead leaves its socket along the socket's axis and its slack falls
 * OUTSIDE the boards. So: keep the normal-pushed cubic when it's already clear,
 * and when it isn't, bend the path around the obstacles it would cross — over
 * the top or under the bottom, whichever detour is shorter.
 *
 * Deliberately NOT a PCB router: this is a flexible lead on a breadboard, so the
 * result stays a smooth curve with believable slack rather than right-angled
 * segments. Pure and DOM-free, so the geometry is unit-testable.
 */

/** A rectangular obstacle in canvas coordinates (a placed body). */
export interface RouteBox {
  x: number
  y: number
  w: number
  h: number
}

/** One end of a lead: where it attaches, and the unit vector it leaves along. */
export interface RouteEnd {
  x: number
  y: number
  /** Outward normal — the plug's boot direction for a cabled end. */
  ox: number
  oy: number
}

/** A cubic segment: start, two controls, end. */
export interface Cubic {
  p0: [number, number]
  p1: [number, number]
  p2: [number, number]
  p3: [number, number]
}

/** Minimum clearance a lead keeps off its pad before it may turn. */
export const ROUTE_CLEARANCE = 40
/** How far outside an obstacle the detour passes. */
export const ROUTE_MARGIN = 26

/** A point on a cubic at `t` (0..1). Pure. */
export function cubicAt(c: Cubic, t: number): { x: number; y: number } {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return {
    x: a * c.p0[0] + b * c.p1[0] + d * c.p2[0] + e * c.p3[0],
    y: a * c.p0[1] + b * c.p1[1] + d * c.p2[1] + e * c.p3[1]
  }
}

/** Is a point inside a box, allowing `pad` of slop? Pure. */
export function inBox(x: number, y: number, b: RouteBox, pad = 0): boolean {
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad
}

/**
 * Where a cubic crosses obstacles, ignoring the stretch nearest each end — a
 * lead necessarily starts ON the board it plugs into, so the first and last
 * fraction of the curve can't count as a collision. Returns the boxes hit.
 */
export function boxesCrossed(c: Cubic, obstacles: RouteBox[], skip = 0.12): RouteBox[] {
  const hit = new Set<RouteBox>()
  const STEPS = 24
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    if (t < skip || t > 1 - skip) continue
    const p = cubicAt(c, t)
    for (const b of obstacles) if (inBox(p.x, p.y, b)) hit.add(b)
  }
  return [...hit]
}

/** The straight-out cubic: each end pushed along its own normal. Pure. */
export function directCubic(a: RouteEnd, b: RouteEnd): Cubic {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.min(160, Math.max(ROUTE_CLEARANCE, Math.hypot(dx, dy) * 0.4))
  return {
    p0: [a.x, a.y],
    p1: [a.x + a.ox * d, a.y + a.oy * d],
    p2: [b.x + b.ox * d, b.y + b.oy * d],
    p3: [b.x, b.y]
  }
}

/** `M … C …` for one cubic. */
function cubicPath(c: Cubic): string {
  return `M ${c.p0[0]} ${c.p0[1]} C ${c.p1[0]} ${c.p1[1]}, ${c.p2[0]} ${c.p2[1]}, ${c.p3[0]} ${c.p3[1]}`
}

/**
 * Two cubics meeting at `waypoint` with a shared HORIZONTAL tangent, so the
 * join is smooth rather than a kink. Each end still leaves along its own normal.
 */
export function detourCubics(a: RouteEnd, b: RouteEnd, waypoint: { x: number; y: number }): [Cubic, Cubic] {
  const lead = ROUTE_CLEARANCE
  // Tangent through the waypoint points from a toward b, horizontally — the
  // detour runs along the outside of the boards, which is a horizontal sweep.
  const dir = Math.sign(b.x - a.x) || 1
  const reach = Math.max(60, Math.abs(b.x - a.x) * 0.3)
  const first: Cubic = {
    p0: [a.x, a.y],
    p1: [a.x + a.ox * lead, a.y + a.oy * lead],
    p2: [waypoint.x - dir * reach, waypoint.y],
    p3: [waypoint.x, waypoint.y]
  }
  const second: Cubic = {
    p0: [waypoint.x, waypoint.y],
    p1: [waypoint.x + dir * reach, waypoint.y],
    p2: [b.x + b.ox * lead, b.y + b.oy * lead],
    p3: [b.x, b.y]
  }
  return [first, second]
}

/**
 * The lead's path, and the point to hang its midpoint furniture on.
 *
 * Tries the direct cubic first — most leads are already clear, and leaving those
 * untouched keeps every existing board looking the way it did. Only a path that
 * genuinely crosses a body detours, and then it passes ABOVE or BELOW the union
 * of what it hit, whichever is the shorter way round.
 */
export function cableRoute(
  a: RouteEnd,
  b: RouteEnd,
  obstacles: RouteBox[] = []
): { d: string; mx: number; my: number } {
  const direct = directCubic(a, b)
  const hit = boxesCrossed(direct, obstacles)
  if (hit.length === 0) {
    const mid = cubicAt(direct, 0.5)
    return { d: cubicPath(direct), mx: mid.x, my: mid.y }
  }

  // The band the detour has to clear: everything the direct path crossed.
  const top = Math.min(...hit.map((h) => h.y))
  const bottom = Math.max(...hit.map((h) => h.y + h.h))
  const midX = (a.x + b.x) / 2
  const midY = (a.y + b.y) / 2

  // Under or over? Take the shorter climb from where the lead already is; a tie
  // goes downward, which is where slack naturally falls.
  const under = { x: midX, y: bottom + ROUTE_MARGIN }
  const over = { x: midX, y: top - ROUTE_MARGIN }
  const waypoint = Math.abs(under.y - midY) <= Math.abs(over.y - midY) ? under : over

  const [first, second] = detourCubics(a, b, waypoint)
  return { d: `${cubicPath(first)} ${cubicPath(second).replace(/^M [^C]*/, '')}`, mx: waypoint.x, my: waypoint.y }
}
