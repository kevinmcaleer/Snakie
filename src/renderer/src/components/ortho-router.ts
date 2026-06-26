/**
 * ORTHOGONAL CONNECTOR ROUTER (#140) — schematic wire auto-routing.
 * ================================================================
 *
 * Routes each wire as a rectilinear (Manhattan) polyline that leaves each pin
 * perpendicular to its component edge, steps around the other components, and
 * is nudged off shared channels so parallel wires don't overlap. This is the
 * well-trodden EDA approach — a sparse **Hanan grid** (rulers through every
 * obstacle edge + pin) searched with **A\*** under a cost of
 * `length + bendPenalty·turns + sharePenalty·channel-reuse` — the same shape as
 * libavoid's orthogonal router (Wybrow/Marriott/Stuckey) and classic Lee maze
 * routing, but small and dependency-free so it runs synchronously in the renderer
 * and emits an SVG path string.
 *
 * Pure + DOM-free (unit-tested like `board-layout`, `board-viewport`, …).
 */

/** An axis-aligned obstacle (a component body) in canvas coordinates. */
export interface RBox {
  x: number
  y: number
  w: number
  h: number
}

/** Which side of its component a pin sits on (its outward normal). */
export type RSide = 'N' | 'E' | 'S' | 'W'

/** A wire endpoint: the connection point + the side it must leave from. */
export interface RPin {
  x: number
  y: number
  side: RSide
}

export interface RWire {
  id: string
  src: RPin
  dst: RPin
}

export interface RouterOptions {
  /** Clearance inflated around each obstacle (px). */
  margin?: number
  /** Perpendicular lead length out of each pin before routing (px). */
  stub?: number
  /** Cost added per 90° turn (higher ⇒ straighter wires). */
  bendPenalty?: number
  /** Cost added per wire already using a grid edge (higher ⇒ more spread). */
  sharePenalty?: number
  /** Spacing of the synthetic lane rulers parallel wires spread onto (px). */
  lane?: number
}

interface Pt {
  x: number
  y: number
}

const NORMAL: Record<RSide, Pt> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 }
}

const manhattan = (a: Pt, b: Pt): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

const EPS = 1e-6

/** A tiny binary min-heap keyed by an f-score number. */
class MinHeap<T> {
  private readonly ks: number[] = []
  private readonly vs: T[] = []
  get size(): number {
    return this.ks.length
  }
  push(k: number, v: T): void {
    this.ks.push(k)
    this.vs.push(v)
    let i = this.ks.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.ks[p] <= this.ks[i]) break
      this.swap(i, p)
      i = p
    }
  }
  pop(): T | undefined {
    const n = this.ks.length
    if (n === 0) return undefined
    const top = this.vs[0]
    const lastK = this.ks.pop() as number
    const lastV = this.vs.pop() as T
    if (n > 1) {
      this.ks[0] = lastK
      this.vs[0] = lastV
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < this.ks.length && this.ks[l] < this.ks[s]) s = l
        if (r < this.ks.length && this.ks[r] < this.ks[s]) s = r
        if (s === i) break
        this.swap(i, s)
        i = s
      }
    }
    return top
  }
  private swap(a: number, b: number): void {
    ;[this.ks[a], this.ks[b]] = [this.ks[b], this.ks[a]]
    ;[this.vs[a], this.vs[b]] = [this.vs[b], this.vs[a]]
  }
}

/** Route every wire and return a map of `wire.id → ordered polyline points`
 *  (the caller renders them sharp via {@link toSvgPath} or rounded via
 *  {@link toRoundedPath}). */
export function routeOrthogonal(obstacles: RBox[], wires: RWire[], opts: RouterOptions = {}): Map<string, Pt[]> {
  const margin = opts.margin ?? 12
  const stub = opts.stub ?? 14
  const bendPenalty = opts.bendPenalty ?? 14
  // A high share cost makes wires take their own channel rather than overlap.
  const sharePenalty = opts.sharePenalty ?? 26

  const inflated = obstacles.map((b) => ({ x: b.x - margin, y: b.y - margin, w: b.w + 2 * margin, h: b.h + 2 * margin }))

  const stubs = wires.map((w) => {
    const sn = NORMAL[w.src.side]
    const dn = NORMAL[w.dst.side]
    return {
      w,
      s: { x: w.src.x + sn.x * stub, y: w.src.y + sn.y * stub },
      d: { x: w.dst.x + dn.x * stub, y: w.dst.y + dn.y * stub }
    }
  })

  // --- Hanan grid rulers: obstacle edges + every pin & stub coordinate. ---
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (const b of inflated) {
    xs.add(b.x)
    xs.add(b.x + b.w)
    ys.add(b.y)
    ys.add(b.y + b.h)
  }
  for (const st of stubs) {
    for (const p of [st.s, st.d, st.w.src, st.w.dst]) {
      xs.add(p.x)
      ys.add(p.y)
    }
  }
  // Synthetic lane rulers at ±lane and ±2·lane around each base ruler, so the
  // share-penalty has several adjacent channels (each `lane` px apart) to spread
  // parallel wires onto — a cheap stand-in for libavoid's segment nudging that
  // keeps a visible margin between wires. Guarded so the grid never explodes.
  const lane = opts.lane ?? 12
  if (xs.size * ys.size <= 900) {
    for (const v of [...xs]) {
      xs.add(v + lane)
      xs.add(v - lane)
      xs.add(v + 2 * lane)
      xs.add(v - 2 * lane)
    }
    for (const v of [...ys]) {
      ys.add(v + lane)
      ys.add(v - lane)
      ys.add(v + 2 * lane)
      ys.add(v - 2 * lane)
    }
  }
  const X = [...xs].sort((a, b) => a - b)
  const Y = [...ys].sort((a, b) => a - b)
  const xi = new Map(X.map((v, i) => [v, i]))
  const yi = new Map(Y.map((v, i) => [v, i]))

  /** Does an axis-aligned segment pass through any obstacle INTERIOR? (Routing
   *  along an inflated edge is allowed — channels hug components.) */
  const blocked = (ax: number, ay: number, bx: number, by: number): boolean =>
    inflated.some((bb) => {
      if (ay === by) {
        const lo = Math.min(ax, bx)
        const hi = Math.max(ax, bx)
        return ay > bb.y + EPS && ay < bb.y + bb.h - EPS && lo < bb.x + bb.w - EPS && hi > bb.x + EPS
      }
      const lo = Math.min(ay, by)
      const hi = Math.max(ay, by)
      return ax > bb.x + EPS && ax < bb.x + bb.w - EPS && lo < bb.y + bb.h - EPS && hi > bb.y + EPS
    })

  const usage = new Map<string, number>()
  const edgeKey = (a: Pt, b: Pt): string => {
    const swap = a.x > b.x || (a.x === b.x && a.y > b.y)
    const p = swap ? b : a
    const q = swap ? a : b
    return `${p.x},${p.y}|${q.x},${q.y}`
  }

  const result = new Map<string, Pt[]>()
  // Route the longest spans first so they claim the central channels; shorter
  // wires then nudge into adjacent lanes (deterministic spread).
  const order = [...stubs].sort((a, b) => manhattan(b.s, b.d) - manhattan(a.s, a.d))

  for (const st of order) {
    const mid = astar(st.s, st.d, X, Y, xi, yi, blocked, usage, edgeKey, bendPenalty, sharePenalty)
    // Charge usage on the per-ruler GRID edges actually traversed (not the
    // collapsed segments) so later wires' A* sees the shared channels and nudges.
    if (mid) {
      for (let i = 1; i < mid.length; i++) {
        const k = edgeKey(mid[i - 1], mid[i])
        usage.set(k, (usage.get(k) ?? 0) + 1)
      }
    }
    const src = { x: st.w.src.x, y: st.w.src.y }
    const dst = { x: st.w.dst.x, y: st.w.dst.y }
    const pts: Pt[] = mid ? [src, ...mid, dst] : [src, st.s, st.d, dst]
    result.set(st.w.id, collapseCollinear(dedupe(pts)))
  }
  return result
}

/** A\* over the Hanan grid from `start` to `goal` (both grid points). Returns the
 *  list of points start..goal, or null if unreachable. */
function astar(
  start: Pt,
  goal: Pt,
  X: number[],
  Y: number[],
  xi: Map<number, number>,
  yi: Map<number, number>,
  blocked: (ax: number, ay: number, bx: number, by: number) => boolean,
  usage: Map<string, number>,
  edgeKey: (a: Pt, b: Pt) => string,
  bendPenalty: number,
  sharePenalty: number
): Pt[] | null {
  const sX = xi.get(start.x)
  const sY = yi.get(start.y)
  const gX = xi.get(goal.x)
  const gY = yi.get(goal.y)
  if (sX === undefined || sY === undefined || gX === undefined || gY === undefined) return null

  const key = (cx: number, cy: number, dir: number): string => `${cx},${cy},${dir}`
  const g = new Map<string, number>()
  const came = new Map<string, string | null>()
  const heap = new MinHeap<{ cx: number; cy: number; dir: number }>()

  const h = (cx: number, cy: number): number => Math.abs(X[cx] - goal.x) + Math.abs(Y[cy] - goal.y)
  const startState = { cx: sX, cy: sY, dir: -1 }
  g.set(key(sX, sY, -1), 0)
  came.set(key(sX, sY, -1), null)
  heap.push(h(sX, sY), startState)

  // 4-neighbour steps: dir 0 = horizontal, 1 = vertical.
  const steps = [
    { dx: -1, dy: 0, dir: 0 },
    { dx: 1, dy: 0, dir: 0 },
    { dx: 0, dy: -1, dir: 1 },
    { dx: 0, dy: 1, dir: 1 }
  ]

  let goalKey: string | null = null
  const visited = new Set<string>()
  while (heap.size > 0) {
    const cur = heap.pop()
    if (!cur) break
    const ck = key(cur.cx, cur.cy, cur.dir)
    if (visited.has(ck)) continue
    visited.add(ck)
    if (cur.cx === gX && cur.cy === gY) {
      goalKey = ck
      break
    }
    const baseG = g.get(ck) ?? Infinity
    for (const step of steps) {
      const nx = cur.cx + step.dx
      const ny = cur.cy + step.dy
      if (nx < 0 || ny < 0 || nx >= X.length || ny >= Y.length) continue
      const ax = X[cur.cx]
      const ay = Y[cur.cy]
      const bx = X[nx]
      const by = Y[ny]
      if (blocked(ax, ay, bx, by)) continue
      const len = Math.abs(bx - ax) + Math.abs(by - ay)
      if (len === 0) continue
      const bend = cur.dir !== -1 && cur.dir !== step.dir ? bendPenalty : 0
      const share = sharePenalty * (usage.get(edgeKey({ x: ax, y: ay }, { x: bx, y: by })) ?? 0)
      const tentative = baseG + len + bend + share
      const nk = key(nx, ny, step.dir)
      if (tentative < (g.get(nk) ?? Infinity)) {
        g.set(nk, tentative)
        came.set(nk, ck)
        heap.push(tentative + h(nx, ny), { cx: nx, cy: ny, dir: step.dir })
      }
    }
  }

  if (!goalKey) return null
  const out: Pt[] = []
  let k: string | null = goalKey
  while (k) {
    const [cx, cy] = k.split(',').map(Number)
    out.push({ x: X[cx], y: Y[cy] })
    k = came.get(k) ?? null
  }
  out.reverse()
  return out
}

/** Drop consecutive duplicate points. */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  return out
}

/** Remove a middle point when its two neighbours are collinear with it. */
function collapseCollinear(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
    if (!collinear) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/** A polyline as an SVG path string (sharp right-angle corners — schematic). */
export function toSvgPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ')
}

/** The same routed polyline with ROUNDED corners — a curvy "noodle" that still
 *  follows the obstacle-avoiding route (used for the Breadboard view). */
export function toRoundedPath(pts: Pt[], radius = 14): string {
  if (pts.length < 3) return toSvgPath(pts)
  // Shorten from `from` toward `to` by up to `r` (clamped to half the segment).
  const towards = (from: Pt, to: Pt): Pt => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const r = Math.min(radius, len / 2)
    return { x: from.x + (dx / len) * r, y: from.y + (dy / len) * r }
  }
  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const a = towards(pts[i], pts[i - 1])
    const b = towards(pts[i], pts[i + 1])
    d += ` L ${round(a.x)} ${round(a.y)} Q ${round(pts[i].x)} ${round(pts[i].y)} ${round(b.x)} ${round(b.y)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${round(last.x)} ${round(last.y)}`
  return d
}

const round = (n: number): number => Math.round(n * 100) / 100

/** Map a part/board edge name to a router side (outward normal). */
export function sideFromEdge(edge: string): RSide {
  switch (edge) {
    case 'left':
      return 'W'
    case 'right':
      return 'E'
    case 'top':
      return 'N'
    default:
      return 'S' // bottom / led / unknown
  }
}
