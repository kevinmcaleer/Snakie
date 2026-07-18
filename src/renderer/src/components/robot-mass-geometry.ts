/**
 * MESH VOLUME + TRUE CENTROID (#552, epic #535 §1) — the geometry half of "how
 * heavy is this link?".
 *
 * Mass estimation needs two numbers from a mesh: its VOLUME (multiplied by a
 * material density and an infill factor to get grams) and its true volumetric
 * CENTROID (where that mass acts, for centre-of-mass maths).
 *
 * Both come from the divergence theorem: fan every triangle to the origin and
 * sum the signed tetrahedron volumes. Triangles facing away contribute negative
 * volume and cancel the overhang exactly, so a closed surface gives the right
 * answer regardless of how it is tessellated — and the winding direction only
 * flips the sign, which cancels in the centroid's division.
 *
 * That identity holds ONLY for a closed surface. A mesh with holes has no
 * well-defined interior, so the sum is meaningless rather than merely
 * imprecise. Hence {@link isWatertight} gates it, and {@link massGeometry}
 * degrades deliberately: mesh -> convex hull -> bounding box, reporting which
 * one it used so callers can label an estimate honestly.
 *
 * NOTE this is deliberately NOT the "centroid" the exploded view computes
 * (`robot-explode.ts`, `RobotView.tsx`) — that one is a bounding-box centre,
 * which is visibly wrong for an asymmetric part like a servo with a horn. Do
 * not conflate them.
 *
 * The core maths is pure and dependency-free (arrays in, numbers out) so it
 * unit-tests without a renderer, following `robot-holes.ts`. Only the convex
 * hull fallback reaches for three.js, which already runs fine under vitest.
 *
 * UNITS: everything is in the cubic units of the positions handed in. A URDF
 * mesh is metres, a raw STL is usually millimetres — callers apply `meshScale`
 * / `meshUnits` and convert to cm3 before multiplying by a g/cm3 density.
 */
import { Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'

export type Vec3 = [number, number, number]

/** Which computation produced a {@link MassGeometry} — drives the UI's honesty. */
export type MassGeometryMethod =
  /** Closed mesh, exact volume + centroid. */
  | 'mesh'
  /** Mesh had holes; convex hull stood in. Over-estimates concave parts. */
  | 'hull'
  /** Hull unavailable too (degenerate//coplanar input); bounding box stood in. */
  | 'bbox'
  /** No usable triangles at all — volume 0, centroid at the origin. */
  | 'empty'

export interface MassGeometry {
  /** Volume, in the cubed units of the input positions. Never negative. */
  volume: number
  /** Volumetric centroid, in the mesh's LOCAL frame. */
  centroid: Vec3
  method: MassGeometryMethod
  /** Whether the source mesh was a closed surface. */
  watertight: boolean
}

/**
 * Triangle vertex positions, flat `[x,y,z, x,y,z, …]`, optionally indexed —
 * matching a three.js BufferGeometry's `position` / `index` attributes, which
 * is what both STLLoader and ColladaLoader hand back.
 */
export interface MeshTriangles {
  positions: ArrayLike<number>
  index?: ArrayLike<number> | null
}

/** Number of triangles described by `positions`/`index`. */
const triangleCount = ({ positions, index }: MeshTriangles): number =>
  index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9)

/** Read triangle `t`'s three corners. */
const triangleAt = ({ positions, index }: MeshTriangles, t: number): [Vec3, Vec3, Vec3] => {
  const corner = (k: number): Vec3 => {
    const v = index ? index[t * 3 + k] : t * 3 + k
    return [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
  }
  return [corner(0), corner(1), corner(2)]
}

/**
 * Weld vertices by QUANTISED position, not by index.
 *
 * An STL is a triangle soup: neighbouring faces repeat a shared corner as
 * separate floats, so index-based edge matching would see every edge as
 * unshared and call every mesh open. Quantising to a tolerance makes the
 * duplicates collide into one id.
 */
const weldKey = (p: Vec3, tolerance: number): string => {
  const q = (n: number): number => Math.round(n / tolerance)
  // -0 and 0 quantise to different strings otherwise.
  return `${q(p[0]) + 0},${q(p[1]) + 0},${q(p[2]) + 0}`
}

/**
 * A closed surface has every edge shared by exactly two triangles. Anything
 * else — a boundary edge used once, or a non-manifold edge used three or more
 * times — means the volume integral has no meaning.
 *
 * `tolerance` is the vertex weld distance, in the input's units.
 */
export function isWatertight(mesh: MeshTriangles, tolerance = 1e-6): boolean {
  const n = triangleCount(mesh)
  if (n === 0) return false

  const ids = new Map<string, number>()
  const idOf = (p: Vec3): number => {
    const k = weldKey(p, tolerance)
    let id = ids.get(k)
    if (id === undefined) {
      id = ids.size
      ids.set(k, id)
    }
    return id
  }

  const edges = new Map<string, number>()
  for (let t = 0; t < n; t++) {
    const [a, b, c] = triangleAt(mesh, t)
    const tri = [idOf(a), idOf(b), idOf(c)]
    // A degenerate triangle (two corners welded together) has a zero-length
    // edge; it contributes no volume and would break the parity count.
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) continue
    for (let k = 0; k < 3; k++) {
      const u = tri[k]
      const v = tri[(k + 1) % 3]
      const key = u < v ? `${u}_${v}` : `${v}_${u}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  if (edges.size === 0) return false
  for (const count of edges.values()) if (count !== 2) return false
  return true
}

/**
 * Signed volume and volumetric centroid by the divergence theorem.
 *
 * Each triangle forms a tetrahedron with the origin: signed volume
 * `a · (b × c) / 6`, centroid `(a + b + c + origin) / 4`. Summing the
 * volume-weighted centroids and dividing by the total gives the solid's
 * centroid — and because a flipped winding negates both sums, the centroid is
 * winding-independent while the volume merely changes sign.
 *
 * Meaningful only for a closed surface; callers gate on {@link isWatertight}.
 */
export function signedVolumeAndCentroid(mesh: MeshTriangles): {
  volume: number
  centroid: Vec3
} {
  const n = triangleCount(mesh)
  let vol = 0
  let cx = 0
  let cy = 0
  let cz = 0

  for (let t = 0; t < n; t++) {
    const [a, b, c] = triangleAt(mesh, t)
    // a · (b × c) / 6
    const v =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
    vol += v
    // Tetrahedron centroid, apex at the origin.
    cx += v * ((a[0] + b[0] + c[0]) / 4)
    cy += v * ((a[1] + b[1] + c[1]) / 4)
    cz += v * ((a[2] + b[2] + c[2]) / 4)
  }

  if (Math.abs(vol) < Number.EPSILON) return { volume: vol, centroid: [0, 0, 0] }
  return { volume: vol, centroid: [cx / vol, cy / vol, cz / vol] }
}

/** Axis-aligned bounds, or null when there are no finite points. */
const boundsOf = ({ positions }: MeshTriangles): { min: Vec3; max: Vec3 } | null => {
  if (positions.length < 3) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const c = positions[i + k]
      if (!Number.isFinite(c)) return null
      if (c < min[k]) min[k] = c
      if (c > max[k]) max[k] = c
    }
  }
  return { min, max }
}

/**
 * Convex hull of the mesh's points, re-measured as a closed mesh.
 *
 * The hull is watertight by construction, so the same integral applies. It
 * OVER-estimates anything concave (a bracket with a slot reads as solid), which
 * is why it is a labelled fallback rather than a default.
 *
 * Returns null when the points are degenerate (fewer than four, or all
 * coplanar) and no hull exists.
 */
const hullGeometry = (mesh: MeshTriangles): { volume: number; centroid: Vec3 } | null => {
  const { positions } = mesh
  if (positions.length < 12) return null // fewer than 4 points — no volume
  const points: Vector3[] = []
  for (let i = 0; i + 2 < positions.length; i += 3) {
    points.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]))
  }
  try {
    const hull = new ConvexHull().setFromPoints(points)
    const flat: number[] = []
    for (const face of hull.faces) {
      // Each face is a closed edge loop; fan-triangulate from its first vertex.
      const loop: Vector3[] = []
      let edge = face.edge
      do {
        loop.push(edge.head().point)
        edge = edge.next
      } while (edge !== face.edge)
      for (let k = 1; k + 1 < loop.length; k++) {
        flat.push(
          loop[0].x, loop[0].y, loop[0].z,
          loop[k].x, loop[k].y, loop[k].z,
          loop[k + 1].x, loop[k + 1].y, loop[k + 1].z
        )
      }
    }
    if (flat.length < 9) return null
    const { volume, centroid } = signedVolumeAndCentroid({ positions: flat })
    if (!Number.isFinite(volume) || Math.abs(volume) < Number.EPSILON) return null
    return { volume: Math.abs(volume), centroid }
  } catch {
    // ConvexHull throws on fully degenerate input rather than returning empty.
    return null
  }
}

/**
 * Volume + centroid for a link's mesh, degrading deliberately and reporting how.
 *
 * `mesh` -> closed surface, exact. `hull` -> had holes, convex hull stood in
 * (over-estimates concave shapes; warn the user). `bbox` -> not even a hull was
 * possible, bounding box stood in (rough). `empty` -> nothing usable.
 */
export function massGeometry(mesh: MeshTriangles, tolerance = 1e-6): MassGeometry {
  if (triangleCount(mesh) === 0) {
    return { volume: 0, centroid: [0, 0, 0], method: 'empty', watertight: false }
  }

  const watertight = isWatertight(mesh, tolerance)
  if (watertight) {
    const { volume, centroid } = signedVolumeAndCentroid(mesh)
    if (Number.isFinite(volume) && Math.abs(volume) > Number.EPSILON) {
      return { volume: Math.abs(volume), centroid, method: 'mesh', watertight: true }
    }
  }

  const hull = hullGeometry(mesh)
  if (hull) return { ...hull, method: 'hull', watertight }

  const b = boundsOf(mesh)
  if (b) {
    const dx = b.max[0] - b.min[0]
    const dy = b.max[1] - b.min[1]
    const dz = b.max[2] - b.min[2]
    return {
      volume: Math.abs(dx * dy * dz),
      centroid: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
      method: 'bbox',
      watertight
    }
  }

  return { volume: 0, centroid: [0, 0, 0], method: 'empty', watertight }
}

/** Cubic millimetres in a cubic centimetre — densities are quoted per cm3. */
export const MM3_PER_CM3 = 1000

/**
 * Grams for a printed part: volume x density x infill.
 *
 * `volumeMm3` in mm3, `densityGCm3` from a material preset (PLA 1.24, PETG
 * 1.27, ABS 1.04, resin ~1.1). `infill` is a 0..1 solidity factor — a printed
 * part is mostly air, and infill dominates real mass, so this is an ESTIMATE
 * and the UI must say so. A measured mass always wins.
 */
export function estimateMassGrams(volumeMm3: number, densityGCm3: number, infill = 1): number {
  if (!Number.isFinite(volumeMm3) || volumeMm3 <= 0) return 0
  const clamped = Math.min(Math.max(infill, 0), 1)
  return (volumeMm3 / MM3_PER_CM3) * densityGCm3 * clamped
}

/** Material density presets in g/cm3 (#535 §1). */
export const MATERIAL_DENSITY_G_CM3: Readonly<Record<string, number>> = Object.freeze({
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  Resin: 1.1
})
