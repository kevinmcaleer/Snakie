import { describe, it, expect } from 'vitest'
import { detectSnapCentres, type Vec3 } from '../src/renderer/src/components/robot-holes'

/** A flat washer in the z=0 plane: an annulus between an outer + inner circle,
 *  triangulated (non-indexed). The inner circle is a "hole"; the outer is the
 *  face outline. Optionally offset the whole thing so the centroid isn't (0,0,0). */
function washer(R: number, r: number, N = 24, offset: Vec3 = [0, 0, 0]): number[] {
  const outer: Vec3[] = []
  const inner: Vec3[] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI
    outer.push([offset[0] + R * Math.cos(a), offset[1] + R * Math.sin(a), offset[2]])
    inner.push([offset[0] + r * Math.cos(a), offset[1] + r * Math.sin(a), offset[2]])
  }
  const pos: number[] = []
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N
    pos.push(...outer[i], ...outer[j], ...inner[i]) // tri 1
    pos.push(...outer[j], ...inner[j], ...inner[i]) // tri 2
  }
  return pos
}

describe('detectSnapCentres — hole/loop snapping (#354c)', () => {
  const plane = { point: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 }

  it('finds the hole centre + the outline centre of a washer', () => {
    const centres = detectSnapCentres(washer(0.05, 0.02), null, plane)
    const hole = centres.find((c) => c.kind === 'hole')
    const outline = centres.find((c) => c.kind === 'outline')
    expect(hole).toBeTruthy()
    expect(outline).toBeTruthy()
    // Both concentric at the origin.
    expect(hole!.p.map((v) => Math.round(v * 1000) + 0)).toEqual([0, 0, 0])
    expect(outline!.p.map((v) => Math.round(v * 1000) + 0)).toEqual([0, 0, 0])
    // Radii match the geometry (±1 mm).
    expect(Math.abs(hole!.radius - 0.02)).toBeLessThan(0.001)
    expect(Math.abs(outline!.radius - 0.05)).toBeLessThan(0.001)
  })

  it('locates an OFF-centre hole centroid', () => {
    const centres = detectSnapCentres(washer(0.04, 0.015, 24, [0.1, -0.05, 0.02]), null, {
      point: [0, 0, 0.02],
      normal: [0, 0, 1]
    })
    const hole = centres.find((c) => c.kind === 'hole')
    expect(hole).toBeTruthy()
    expect(hole!.p.map((v) => Math.round(v * 1000) + 0)).toEqual([100, -50, 20])
  })

  it('ignores triangles that are not coplanar with the clicked face', () => {
    // A washer at z=0 + a stray triangle standing up at z=0.1 (a wall).
    const pos = washer(0.05, 0.02)
    pos.push(0.2, 0, 0, 0.2, 0.01, 0, 0.2, 0, 0.1) // off-plane triangle
    const centres = detectSnapCentres(pos, null, plane)
    // Still exactly the two washer loops (the wall triangle is filtered out).
    const loops = centres.filter((c) => c.kind === 'hole' || c.kind === 'outline')
    expect(loops.length).toBe(2)
  })

  it('returns nothing for a plane with no coplanar rim loops', () => {
    const centres = detectSnapCentres(washer(0.05, 0.02), null, {
      point: [0, 0, 1],
      normal: [0, 0, 1]
    }) // plane 1 m away — no coplanar triangles
    expect(centres).toEqual([])
  })
})
