/**
 * HOLE / LOOP SNAP DETECTION (#354c) — find snappable centres on the flat face a
 * user clicked on a mesh (an STL is just a triangle soup). A bolt hole shows up in
 * the mesh as a ring of triangle edges where the flat face meets the cylindrical
 * bore; its centre is a natural place to attach a joint.
 *
 * The approach is pure + dependency-free (arrays in, points out) so it unit-tests
 * without three.js:
 *  1. keep only triangles COPLANAR with the clicked face (all verts on the plane +
 *     normal parallel),
 *  2. an edge used by exactly ONE coplanar triangle is a RIM edge (the border of
 *     the flat region — its outer outline or a hole),
 *  3. chain rim edges into closed loops,
 *  4. each loop's centroid is a snap centre; a roughly-circular loop is tagged a
 *     hole, and the largest loop is the face OUTLINE.
 * Also emits midpoints of long straight rim edges as alignment guides.
 */
export type Vec3 = [number, number, number]

export interface SnapCentre {
  /** Centre point, in the mesh's LOCAL frame. */
  p: Vec3
  /** Mean radius of the loop (metres). */
  radius: number
  kind: 'hole' | 'outline' | 'edge'
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Quantise a point to a grid so shared triangle vertices collapse to one key. */
function keyOf(p: Vec3, q = 1e5): string {
  return `${Math.round(p[0] * q)},${Math.round(p[1] * q)},${Math.round(p[2] * q)}`
}

/**
 * Find snap centres on the plane the user clicked, from a triangle mesh.
 *
 * @param positions flat [x,y,z, …] vertex positions in the mesh's local frame.
 * @param index     triangle vertex indices (3 per tri), or null for a non-indexed
 *                  soup (positions taken 3 verts at a time).
 * @param plane     the clicked face: a point on it + its (unit-ish) normal, local.
 */
export function detectSnapCentres(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  plane: { point: Vec3; normal: Vec3 },
  opts?: { planeEps?: number; circleTol?: number; minLoop?: number }
): SnapCentre[] {
  const n = norm(plane.normal)
  const planeEps = opts?.planeEps ?? 5e-4 // 0.5 mm on-plane tolerance
  const circleTol = opts?.circleTol ?? 0.18 // radius stddev / mean below this = circle
  const minLoop = opts?.minLoop ?? 3
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9)
  const vAt = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
  const idx = (t: number, k: number): number => (index ? index[t * 3 + k] : t * 3 + k)
  const dist = (p: Vec3): number => dot(sub(p, plane.point), n)

  // 1) coplanar triangles → 2) rim edges (used by exactly one coplanar triangle).
  const edgeCount = new Map<string, { a: Vec3; b: Vec3; count: number }>()
  const edgeKey = (ka: string, kb: string): string => (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)
  for (let t = 0; t < triCount; t++) {
    const a = vAt(idx(t, 0))
    const b = vAt(idx(t, 1))
    const c = vAt(idx(t, 2))
    if (Math.abs(dist(a)) > planeEps || Math.abs(dist(b)) > planeEps || Math.abs(dist(c)) > planeEps) {
      continue // not on the plane
    }
    const tn = norm(cross(sub(b, a), sub(c, a)))
    if (Math.abs(dot(tn, n)) < 0.98) continue // not parallel to the face
    const verts: Vec3[] = [a, b, c]
    const keys = verts.map((v) => keyOf(v))
    for (let e = 0; e < 3; e++) {
      const va = verts[e]
      const vb = verts[(e + 1) % 3]
      const k = edgeKey(keys[e], keys[(e + 1) % 3])
      const cur = edgeCount.get(k)
      if (cur) cur.count++
      else edgeCount.set(k, { a: va, b: vb, count: 1 })
    }
  }
  const rim = [...edgeCount.values()].filter((e) => e.count === 1)
  if (rim.length < minLoop) return []

  // 3) chain rim edges into closed loops (each rim vertex should have degree 2).
  const adj = new Map<string, { to: string; p: Vec3 }[]>()
  const posByKey = new Map<string, Vec3>()
  for (const e of rim) {
    const ka = keyOf(e.a)
    const kb = keyOf(e.b)
    posByKey.set(ka, e.a)
    posByKey.set(kb, e.b)
    ;(adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, p: e.b })
    ;(adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, p: e.a })
  }
  const seen = new Set<string>()
  const loops: Vec3[][] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const loop: Vec3[] = []
    let cur = start
    let prev = ''
    let ok = true
    for (let guard = 0; guard < adj.size + 2; guard++) {
      seen.add(cur)
      loop.push(posByKey.get(cur)!)
      const nbrs = adj.get(cur) ?? []
      const next = nbrs.find((e) => e.to !== prev && !(loop.length > 2 && e.to === start))
      const back = nbrs.find((e) => e.to === start && loop.length > 2)
      if (back && !next) break // closed the loop
      if (!next) {
        ok = false
        break
      }
      prev = cur
      cur = next.to
      if (cur === start) break
    }
    if (ok && loop.length >= minLoop) loops.push(loop)
  }
  if (loops.length === 0) return []

  // 4) centroid + circularity per loop; largest loop = the face outline.
  const centres: SnapCentre[] = loops.map((loop) => {
    const c: Vec3 = [0, 0, 0]
    for (const p of loop) {
      c[0] += p[0]
      c[1] += p[1]
      c[2] += p[2]
    }
    c[0] /= loop.length
    c[1] /= loop.length
    c[2] /= loop.length
    const radii = loop.map((p) => len(sub(p, c)))
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length
    const variance = radii.reduce((s, r) => s + (r - mean) * (r - mean), 0) / radii.length
    const std = Math.sqrt(variance)
    const circular = mean > 0 && std / mean < circleTol
    return { p: c, radius: mean, kind: circular ? ('hole' as const) : ('outline' as const) }
  })
  // The loop with the biggest radius is the outer outline, not a hole.
  let outer = 0
  for (let i = 1; i < centres.length; i++) if (centres[i].radius > centres[outer].radius) outer = i
  centres[outer] = { ...centres[outer], kind: 'outline' }

  // Alignment guides: midpoints of the longest few rim edges (between two edges).
  const edgeMids: SnapCentre[] = rim
    .map((e) => ({ mid: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2] as Vec3, l: len(sub(e.a, e.b)) }))
    .sort((x, y) => y.l - x.l)
    .slice(0, 4)
    .map((e) => ({ p: e.mid, radius: e.l / 2, kind: 'edge' as const }))

  return [...centres, ...edgeMids]
}
