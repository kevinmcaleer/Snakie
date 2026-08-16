import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

/**
 * Geometry tests for the generated Modulino board mesh (#722, epic #721).
 *
 * The mesh is produced by a script rather than modelled by hand, so its
 * correctness is checkable: the board must be the published 41 × 25.36 × 1.6 mm,
 * sit with its underside on z = 0 (the link-origin convention placement uses),
 * carry four real through-holes, and gain exactly the QWIIC housings at each
 * end. A wrong number here would ship twelve wrong parts.
 */

// The generator is plain ESM JS with no type declarations; import it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mesh = (await import('../scripts/modulino-mesh.mjs')) as any

const BOARD = mesh.BOARD as {
  lengthMm: number
  widthMm: number
  thicknessMm: number
  holeDiameterMm: number
  holePitchXMm: number
  holePitchYMm: number
}
const CONNECTOR = mesh.CONNECTOR as { depthMm: number; widthMm: number; heightMm: number }

/** Does a straight-DOWN ray through (x, y) pass through solid board? */
function hitsAt(object: THREE.Object3D, x: number, y: number): number {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(object, true).length
}

describe('Modulino board mesh (#722)', () => {
  it('is the published 41 × 25.36 × 1.6 mm board', () => {
    const geo = mesh.boardGeometry() as THREE.BufferGeometry
    geo.computeBoundingBox()
    const b = geo.boundingBox!
    expect(b.max.x - b.min.x).toBeCloseTo(BOARD.lengthMm, 3)
    expect(b.max.y - b.min.y).toBeCloseTo(BOARD.widthMm, 3)
    expect(b.max.z - b.min.z).toBeCloseTo(BOARD.thicknessMm, 3)
  })

  it('sits centred in x/y with its underside on z = 0', () => {
    // Placement puts the link origin here (#716), so the board rests ON the
    // ground plane rather than being buried half-way through it.
    const geo = mesh.boardGeometry() as THREE.BufferGeometry
    geo.computeBoundingBox()
    const b = geo.boundingBox!
    expect(b.min.z).toBeCloseTo(0, 6)
    expect(b.min.x + b.max.x).toBeCloseTo(0, 6)
    expect(b.min.y + b.max.y).toBeCloseTo(0, 6)
  })

  it('has four REAL through-holes on the 16 × 32 mm pitch', () => {
    const board = new THREE.Mesh(mesh.boardGeometry(), new THREE.MeshBasicMaterial())
    const hx = BOARD.holePitchXMm / 2
    const hy = BOARD.holePitchYMm / 2
    // A vertical ray down a hole's centre meets no cap face (and the hole's own
    // wall is parallel to it), so a genuine hole reads as zero hits.
    for (const [x, y] of [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy]
    ]) {
      expect(hitsAt(board, x, y), `hole at ${x},${y}`).toBe(0)
    }
    // Solid board between the holes still reads as solid (top + bottom faces).
    expect(hitsAt(board, 0, 0)).toBe(2)
  })

  it('keeps the holes clear of the board edges', () => {
    const r = BOARD.holeDiameterMm / 2
    const edgeX = BOARD.lengthMm / 2 - (BOARD.holePitchXMm / 2 + r)
    const edgeY = BOARD.widthMm / 2 - (BOARD.holePitchYMm / 2 + r)
    expect(edgeX).toBeGreaterThan(1) // ≥1 mm of copper to the end
    expect(edgeY).toBeGreaterThan(1) // …and to the side
  })

  it('adds a QWIIC housing at EACH end, flush with the outer edge', () => {
    const group = mesh.modulinoGroup() as THREE.Group
    const box = new THREE.Box3().setFromObject(group)
    // The housings sit ON the board, so the group is taller but no wider.
    expect(box.max.x - box.min.x).toBeCloseTo(BOARD.lengthMm, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(BOARD.widthMm, 3)
    expect(box.max.z).toBeCloseTo(BOARD.thicknessMm + CONNECTOR.heightMm, 3)
    // One board + two connectors.
    expect(group.children.length).toBe(3)
  })

  it('a topper adds hardware without changing the board footprint', () => {
    const plain = new THREE.Box3().setFromObject(mesh.modulinoGroup() as THREE.Object3D)
    const knob = new THREE.Box3().setFromObject(mesh.modulinoGroup('knob') as THREE.Object3D)
    expect(knob.max.x - knob.min.x).toBeCloseTo(plain.max.x - plain.min.x, 3)
    expect(knob.max.y - knob.min.y).toBeCloseTo(plain.max.y - plain.min.y, 3)
    // …and it IS taller than the bare board + connectors.
    expect(knob.max.z).toBeGreaterThan(plain.max.z)
  })

  it('every declared topper builds (the per-module issues rely on these)', () => {
    for (const name of Object.keys(mesh.TOPPERS)) {
      const box = new THREE.Box3().setFromObject(mesh.modulinoGroup(name) as THREE.Object3D)
      expect(box.max.z, name).toBeGreaterThan(BOARD.thicknessMm + CONNECTOR.heightMm)
    }
  })

  it('exports a binary STL whose header advertises the real triangle count', () => {
    const stl = mesh.toStl(mesh.modulinoGroup()) as Buffer
    expect(stl.length).toBeGreaterThan(84)
    const declared = stl.readUInt32LE(80)
    expect(declared).toBe((stl.length - 84) / 50)
    // Small enough that duplicating it into every part folder is cheap (the
    // decision behind not extending the schema for a shared mesh path).
    expect(stl.length).toBeLessThan(120 * 1024)
  })
})
