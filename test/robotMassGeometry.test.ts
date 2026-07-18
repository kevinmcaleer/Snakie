import { describe, expect, it } from 'vitest'
import {
  MATERIAL_DENSITY_G_CM3,
  estimateMassGrams,
  isWatertight,
  massGeometry,
  signedVolumeAndCentroid,
  type MeshTriangles,
  type Vec3
} from '../src/renderer/src/components/robot-mass-geometry'

/**
 * Shapes with volumes and centroids known ANALYTICALLY, so the tests check the
 * maths rather than just pinning whatever the code happens to return.
 */

/** Axis-aligned box as 12 triangles, corner at `min`, size `size`. */
function boxMesh(min: Vec3, size: Vec3): MeshTriangles {
  const [x, y, z] = min
  const [w, h, d] = size
  const v: Vec3[] = [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + h, z],
    [x, y + h, z],
    [x, y, z + d],
    [x + w, y, z + d],
    [x + w, y + h, z + d],
    [x, y + h, z + d]
  ]
  // Outward winding (counter-clockwise seen from outside).
  const faces: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5] //  +x
  ]
  const positions: number[] = []
  for (const [a, b, c] of faces) positions.push(...v[a], ...v[b], ...v[c])
  return { positions }
}

/** Regular tetrahedron on the given corners. */
function tetraMesh(a: Vec3, b: Vec3, c: Vec3, d: Vec3): MeshTriangles {
  const positions: number[] = []
  for (const [p, q, r] of [
    [a, c, b],
    [a, b, d],
    [b, c, d],
    [c, a, d]
  ] as Array<[Vec3, Vec3, Vec3]>) {
    positions.push(...p, ...q, ...r)
  }
  return { positions }
}

const close = (got: number, want: number, tol = 1e-6): void => {
  expect(Math.abs(got - want)).toBeLessThan(tol)
}
const closeVec = (got: Vec3, want: Vec3, tol = 1e-6): void => {
  for (let i = 0; i < 3; i++) close(got[i], want[i], tol)
}

describe('isWatertight', () => {
  it('accepts a closed box', () => {
    expect(isWatertight(boxMesh([0, 0, 0], [2, 3, 4]))).toBe(true)
  })

  it('accepts a closed box built from a triangle SOUP with duplicated corners', () => {
    // STLs repeat shared corners as separate floats; welding by position is
    // what makes the edge-parity check work at all.
    const box = boxMesh([0, 0, 0], [1, 1, 1])
    expect(box.index).toBeUndefined()
    expect(isWatertight(box)).toBe(true)
  })

  it('rejects a box with a face removed (a hole)', () => {
    const box = boxMesh([0, 0, 0], [2, 2, 2])
    const open = { positions: Array.from(box.positions).slice(0, -18) } // drop 2 tris
    expect(isWatertight(open)).toBe(false)
  })

  it('rejects a single open triangle', () => {
    expect(isWatertight({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })).toBe(false)
  })

  it('rejects an empty mesh', () => {
    expect(isWatertight({ positions: [] })).toBe(false)
  })
})

describe('signedVolumeAndCentroid', () => {
  it('measures a unit cube at the origin', () => {
    const { volume, centroid } = signedVolumeAndCentroid(boxMesh([0, 0, 0], [1, 1, 1]))
    close(Math.abs(volume), 1)
    closeVec(centroid, [0.5, 0.5, 0.5])
  })

  it('measures a box far from the origin (divergence theorem, not bbox)', () => {
    const { volume, centroid } = signedVolumeAndCentroid(boxMesh([10, -4, 7], [2, 3, 4]))
    close(Math.abs(volume), 24)
    closeVec(centroid, [11, -2.5, 9])
  })

  it('measures a tetrahedron: V = 1/6 for the unit corner tetra', () => {
    const { volume, centroid } = signedVolumeAndCentroid(
      tetraMesh([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1])
    )
    close(Math.abs(volume), 1 / 6)
    closeVec(centroid, [0.25, 0.25, 0.25])
  })

  it('is winding-independent for the centroid, sign-flipped for the volume', () => {
    const box = boxMesh([1, 2, 3], [2, 2, 2])
    const flipped: number[] = []
    const p = Array.from(box.positions)
    // Reverse each triangle's winding.
    for (let t = 0; t * 9 < p.length; t++) {
      const s = t * 9
      flipped.push(p[s], p[s + 1], p[s + 2], p[s + 6], p[s + 7], p[s + 8], p[s + 3], p[s + 4], p[s + 5])
    }
    const a = signedVolumeAndCentroid(box)
    const b = signedVolumeAndCentroid({ positions: flipped })
    close(a.volume, -b.volume)
    closeVec(a.centroid, b.centroid)
  })

  it('reads an INDEXED mesh identically to the same soup', () => {
    const box = boxMesh([0, 0, 0], [2, 2, 2])
    const p = Array.from(box.positions)
    const index = p.map((_, i) => i).filter((i) => i % 3 === 0).map((i) => i / 3)
    const soup = signedVolumeAndCentroid(box)
    const indexed = signedVolumeAndCentroid({ positions: p, index })
    close(soup.volume, indexed.volume)
    closeVec(soup.centroid, indexed.centroid)
  })
})

describe('massGeometry', () => {
  it('uses the exact mesh for a closed box', () => {
    const g = massGeometry(boxMesh([0, 0, 0], [2, 2, 2]))
    expect(g.method).toBe('mesh')
    expect(g.watertight).toBe(true)
    close(g.volume, 8)
    closeVec(g.centroid, [1, 1, 1])
  })

  it('never reports a negative volume, whatever the winding', () => {
    const box = boxMesh([0, 0, 0], [1, 2, 3])
    const p = Array.from(box.positions)
    const flipped: number[] = []
    for (let t = 0; t * 9 < p.length; t++) {
      const s = t * 9
      flipped.push(p[s], p[s + 1], p[s + 2], p[s + 6], p[s + 7], p[s + 8], p[s + 3], p[s + 4], p[s + 5])
    }
    expect(massGeometry({ positions: flipped }).volume).toBeGreaterThan(0)
  })

  it('falls back to the convex hull when the mesh has holes', () => {
    const box = boxMesh([0, 0, 0], [2, 2, 2])
    const open = { positions: Array.from(box.positions).slice(0, -18) }
    const g = massGeometry(open)
    expect(g.method).toBe('hull')
    expect(g.watertight).toBe(false)
    // The hull of a box-minus-a-face is still the box.
    close(g.volume, 8, 1e-4)
  })

  it('falls back to the bounding box for coplanar input (no hull exists)', () => {
    // A flat sheet: hull is degenerate, bbox volume is zero but well-defined.
    const g = massGeometry({
      positions: [0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 0, 0, 4, 3, 0, 0, 3, 0]
    })
    expect(g.method).toBe('bbox')
    expect(g.watertight).toBe(false)
    closeVec(g.centroid, [2, 1.5, 0])
  })

  it('reports empty for a mesh with no triangles', () => {
    const g = massGeometry({ positions: [] })
    expect(g.method).toBe('empty')
    expect(g.volume).toBe(0)
  })

  it('sums two disjoint solids — both are closed, so the mesh path still applies', () => {
    const a = boxMesh([0, 0, 0], [1, 1, 1]) // V=1, centre (0.5,0.5,0.5)
    const b = boxMesh([9, 0, 0], [1, 1, 1]) // V=1, centre (9.5,0.5,0.5)
    const g = massGeometry({ positions: [...Array.from(a.positions), ...Array.from(b.positions)] })
    expect(g.method).toBe('mesh')
    close(g.volume, 2)
    closeVec(g.centroid, [5, 0.5, 0.5]) // midway — equal masses
  })

  it('the hull genuinely OVER-estimates a concave shape — why it is labelled', () => {
    // Two boxes far apart span a large empty gap. Their true combined volume is
    // 2; the convex hull swallows the gap and is an order of magnitude bigger.
    const a = boxMesh([0, 0, 0], [1, 1, 1])
    const b = boxMesh([9, 0, 0], [1, 1, 1])
    const both = [...Array.from(a.positions), ...Array.from(b.positions)]
    const trueVolume = massGeometry({ positions: both }).volume
    close(trueVolume, 2)

    // Punch a hole so the closed-mesh path is unavailable and the hull stands in.
    const holed = { positions: both.slice(0, -18) }
    const g = massGeometry(holed)
    expect(g.method).toBe('hull')
    expect(g.volume).toBeGreaterThan(trueVolume * 4)
  })

  it('centroid of an asymmetric solid is mass-weighted, NOT the bounding-box centre', () => {
    // The property this whole module exists for: a big block beside a small one
    // pulls the centroid toward the big block, while a bbox centre sits midway.
    const big = boxMesh([0, 0, 0], [4, 4, 4]) // V=64, centre x=2
    const small = boxMesh([8, 0, 0], [1, 4, 4]) // V=16, centre x=8.5
    const g = massGeometry({
      positions: [...Array.from(big.positions), ...Array.from(small.positions)]
    })
    expect(g.method).toBe('mesh')
    close(g.volume, 80)
    // (64*2 + 16*8.5) / 80 = 3.3
    close(g.centroid[0], 3.3, 1e-6)
    // The bounding box spans x 0..9, so its centre would be 4.5 — clearly different.
    expect(Math.abs(g.centroid[0] - 4.5)).toBeGreaterThan(1)
  })
})

describe('estimateMassGrams', () => {
  it('converts mm3 x density x infill to grams', () => {
    // 1000 mm3 = 1 cm3; PLA at 100% infill = 1.24 g.
    close(estimateMassGrams(1000, MATERIAL_DENSITY_G_CM3.PLA, 1), 1.24)
    close(estimateMassGrams(1000, MATERIAL_DENSITY_G_CM3.PLA, 0.2), 0.248)
  })

  it('clamps infill to 0..1 and rejects nonsense volumes', () => {
    close(estimateMassGrams(1000, 1.24, 5), 1.24)
    expect(estimateMassGrams(1000, 1.24, -1)).toBe(0)
    expect(estimateMassGrams(-5, 1.24, 1)).toBe(0)
    expect(estimateMassGrams(Number.NaN, 1.24, 1)).toBe(0)
  })

  it('ships the documented material presets', () => {
    expect(MATERIAL_DENSITY_G_CM3.PLA).toBe(1.24)
    expect(MATERIAL_DENSITY_G_CM3.PETG).toBe(1.27)
    expect(MATERIAL_DENSITY_G_CM3.ABS).toBe(1.04)
  })
})
