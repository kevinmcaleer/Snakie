/**
 * WIRE PINS (#1173) — user-placed waypoints a wire is routed through.
 * ==================================================================
 *
 * A noodle's shape used to be derived entirely from its two pads: drag its belly
 * and it stretched, but the moment you let go it sprang back to wherever the
 * curve wanted to be — which is regularly straight across the components you
 * were trying to keep it off. You could move a wire; you could not put one
 * somewhere.
 *
 * A PIN fixes that: a point in canvas coordinates that the wire is made to pass
 * through, dropped where the drag was released and saved in `robot.yml` with the
 * connection. Drop as many as the route needs; click one to take it out again.
 * A wire with no pins is untouched — same Bézier, same behaviour as before.
 *
 * This module is the pure geometry behind it (DOM-free, unit-tested like
 * `ortho-router` / `cable-route`): the path through a pinned list, which segment
 * a new pin belongs in, and which pin a click landed on.
 */

/** A point in canvas (viewBox) coordinates. */
export interface WirePt {
  x: number
  y: number
}

/** A wire endpoint: the pad it leaves from + its outward normal. */
export interface WireEnd extends WirePt {
  ox: number
  oy: number
}

/** Longest tangent a control point is pushed along (matches the unpinned noodle). */
const MAX_REACH = 160

function dist(a: WirePt, b: WirePt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function norm(x: number, y: number): WirePt {
  const m = Math.hypot(x, y)
  return m < 1e-6 ? { x: 0, y: 0 } : { x: x / m, y: y / m }
}

/**
 * The direction the curve travels THROUGH each vertex.
 *
 * The ends are fixed by the pads — a wire leaves a pad along its normal and
 * arrives at the far one against it, which is what gives a soldered joint its
 * clean exit. Every pin in between takes the Catmull-Rom tangent (the direction
 * from the previous vertex to the next), so the wire sweeps through the point
 * instead of cornering on it.
 */
function tangents(pts: WirePt[], a: WireEnd, b: WireEnd): WirePt[] {
  return pts.map((_p, i) => {
    if (i === 0) return norm(a.ox, a.oy)
    if (i === pts.length - 1) return norm(-b.ox, -b.oy)
    return norm(pts[i + 1].x - pts[i - 1].x, pts[i + 1].y - pts[i - 1].y)
  })
}

/**
 * How far a control point reaches along its tangent.
 *
 * `clearance` is what an unpinned noodle uses to bow off the pad, but a pin
 * dropped right next to a pad makes that segment short — reaching 40px along a
 * 20px hop would loop the wire back over itself. So the clearance only applies
 * while the segment can hold it; below that the reach is half the segment.
 */
function reach(len: number, clearance: number, end: boolean): number {
  if (!end) return Math.min(MAX_REACH, len / 3)
  return Math.min(MAX_REACH, Math.max(Math.min(clearance, len / 2), len * 0.4))
}

/** The polyline through the pins: the pads with the pinned points between them. */
export function pinnedPolyline(a: WireEnd, b: WireEnd, pins: readonly WirePt[]): WirePt[] {
  return [{ x: a.x, y: a.y }, ...pins.map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }]
}

/** The point half-way along a polyline — where a wire's badges/labels hang. */
export function polylineMidpoint(pts: WirePt[]): WirePt {
  const total = pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(pts[i - 1], p)), 0)
  if (total <= 0) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 }
  let run = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i])
    if (run + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - run) / seg
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    run += seg
  }
  const last = pts[pts.length - 1]
  return { x: last.x, y: last.y }
}

/**
 * The breadboard noodle through a wire's pins: one cubic per leg, joined with
 * shared tangents so the whole run reads as a single bent wire rather than a
 * chain of arcs.
 */
export function pinnedNoodle(
  a: WireEnd,
  b: WireEnd,
  pins: readonly WirePt[],
  clearance: number
): { d: string; mx: number; my: number } {
  const pts = pinnedPolyline(a, b, pins)
  const tan = tangents(pts, a, b)
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const len = dist(pts[i], pts[i + 1])
    const r1 = reach(len, clearance, i === 0)
    const r2 = reach(len, clearance, i + 1 === pts.length - 1)
    const c1x = pts[i].x + tan[i].x * r1
    const c1y = pts[i].y + tan[i].y * r1
    const c2x = pts[i + 1].x - tan[i + 1].x * r2
    const c2y = pts[i + 1].y - tan[i + 1].y * r2
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${pts[i + 1].x} ${pts[i + 1].y}`
  }
  const mid = polylineMidpoint(pts)
  return { d, mx: mid.x, my: mid.y }
}

/**
 * The SCHEMATIC route through a wire's pins: a rectilinear polyline that still
 * leaves each pin perpendicular to its symbol (the drawing convention the
 * auto-router keeps), then steps to each pinned point in turn.
 *
 * Pinned wires skip the A* router entirely — the pins ARE the route the user
 * asked for, and re-routing around obstacles would move them.
 */
export function pinnedOrtho(a: WireEnd, b: WireEnd, pins: readonly WirePt[], stub: number): WirePt[] {
  const out: WirePt[] = [{ x: a.x, y: a.y }]
  const push = (p: WirePt): void => {
    const last = out[out.length - 1]
    if (Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push({ x: p.x, y: p.y })
  }
  push({ x: a.x + a.ox * stub, y: a.y + a.oy * stub })
  // Keep going the way the stub left the pad, then alternate: each leg is one
  // step on the current axis and one on the other, so the run staircases toward
  // each pin instead of doubling back over the pad it just left.
  let horiz = Math.abs(a.ox) > Math.abs(a.oy)
  const targets = [...pins, { x: b.x + b.ox * stub, y: b.y + b.oy * stub }]
  for (const t of targets) {
    const from = out[out.length - 1]
    if (horiz) {
      push({ x: t.x, y: from.y })
      push({ x: t.x, y: t.y })
    } else {
      push({ x: from.x, y: t.y })
      push({ x: t.x, y: t.y })
    }
    horiz = !horiz
  }
  push({ x: b.x, y: b.y })
  return out
}

/** Squared distance from `p` to the segment `a`–`b`. */
function segDist2(p: WirePt, a: WirePt, b: WirePt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return (p.x - a.x - vx * t) ** 2 + (p.y - a.y - vy * t) ** 2
}

/**
 * Where a NEW pin belongs in the list — the index to splice it at.
 *
 * The run's nearest leg decides, so a pin dropped part-way along a wire that
 * already doubles back lands in the right place in the order, and the wire keeps
 * the shape you dragged rather than jumping through its pins out of sequence.
 */
export function pinInsertIndex(a: WireEnd, b: WireEnd, pins: readonly WirePt[], p: WirePt): number {
  const pts = pinnedPolyline(a, b, pins)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d2 = segDist2(p, pts[i], pts[i + 1])
    if (d2 < bestD) {
      bestD = d2
      best = i
    }
  }
  return best
}

/** The pin a press at `p` landed on (within `tol`), or -1. Nearest wins. */
export function pinHitIndex(pins: readonly WirePt[], p: WirePt, tol: number): number {
  let best = -1
  let bestD = tol
  pins.forEach((pin, i) => {
    const d = dist(pin, p)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** What releasing a wire/pin drag does. */
export type PinDrop = 'add' | 'move' | 'remove' | 'none'

/**
 * The whole interaction, in one place: press a wire and drag ⇒ it is PINNED
 * where you let go; press an existing pin and drag ⇒ that pin moves; click an
 * existing pin without dragging ⇒ it is un-pinned; click the wire without
 * dragging ⇒ nothing (the press already selected it).
 */
export function pinDropAction(moved: boolean, pinIndex?: number): PinDrop {
  if (moved) return pinIndex != null ? 'move' : 'add'
  return pinIndex != null ? 'remove' : 'none'
}
