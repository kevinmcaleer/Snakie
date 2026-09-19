import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

/**
 * Geometry tests for the generated 2WD robot car chassis mesh
 * (`scripts/robot-chassis-mesh.mjs`).
 *
 * Like the Modulino board, the model is produced by a script from named
 * dimensions, so what it claims is checkable: the plate must be the listed
 * 210 × 150 × 3 mm, the kit must stand on its wheels at z = 0 (the link-origin
 * convention placement relies on), the vertical stack must close (axle drop +
 * wheel radius = standoff + caster), the holes and wheel notches must be real
 * cut-outs, and the three declared ground contacts must be where rubber (and
 * steel) meets the floor.
 */

// The generator is plain ESM JS with no type declarations; import it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gen = (await import('../scripts/robot-chassis-mesh.mjs')) as any

const PLATE = gen.PLATE as {
  lengthMm: number
  widthMm: number
  thicknessMm: number
  undersideZMm: number
  topZMm: number
  notch: { xFromMm: number; xToMm: number; depthMm: number }
}
const WHEEL = gen.WHEEL as { diameterMm: number; widthMm: number; axleXMm: number; innerFaceYMm: number }
const MOTOR = gen.MOTOR as { axleBelowPlateMm: number }
const CASTER = gen.CASTER as { xMm: number; heightMm: number; standoffLengthMm: number }
const BATTERY_BOX = gen.BATTERY_BOX as { heightMm: number }
const ROUND_HOLES = gen.ROUND_HOLES as { x: number; y: number; d: number }[]
const SLOTS = gen.SLOTS as { x: number; y: number }[]
const CONTACTS = gen.GROUND_CONTACTS as [number, number, number][]

/** The kit with every face raycastable from either side. */
function kit(opts?: { plateOnly?: boolean }): THREE.Group {
  const group = gen.chassisGroup(opts) as THREE.Group
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = mat
  })
  return group
}

/** z of every surface a straight-DOWN ray through (x, y) crosses, nearest first. */
function crossings(object: THREE.Object3D, x: number, y: number): number[] {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 500), new THREE.Vector3(0, 0, -1))
  return ray.intersectObject(object, true).map((h) => h.point.z)
}

const plateOf = (group: THREE.Group): THREE.Object3D => group.children.find((c) => c.name === 'plate')!

describe('2WD robot car chassis mesh', () => {
  it('is the listed 210 × 150 mm plate, and the kit is no wider or longer than it', () => {
    expect(PLATE.lengthMm).toBe(210)
    expect(PLATE.widthMm).toBe(150)
    expect(PLATE.thicknessMm).toBe(3)
    const box = new THREE.Box3().setFromObject(kit())
    expect(box.max.x - box.min.x).toBeCloseTo(PLATE.lengthMm, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(PLATE.widthMm, 3)
    // Tallest thing is the battery box on the plate; the wheels are just below it.
    expect(box.max.z).toBeCloseTo(PLATE.topZMm + BATTERY_BOX.heightMm, 3)
    expect(box.max.z).toBeGreaterThan(WHEEL.diameterMm)
  })

  it('is centred on the plate in x/y and stands on the floor at z = 0', () => {
    const box = new THREE.Box3().setFromObject(kit())
    expect(box.min.x + box.max.x).toBeCloseTo(0, 6)
    expect(box.min.y + box.max.y).toBeCloseTo(0, 6)
    // The link origin is the ground under the plate's centre — a placed
    // chassis rests ON the floor, not buried to its axles in it.
    expect(box.min.z).toBeCloseTo(0, 6)
  })

  it('closes the vertical stack: axle drop + wheel radius = standoff + caster', () => {
    // The one derived height everything hangs off. If a measured correction to
    // any of these ever breaks the identity, the nose or the tail floats.
    expect(PLATE.undersideZMm).toBeCloseTo(WHEEL.diameterMm / 2 + MOTOR.axleBelowPlateMm, 6)
    expect(PLATE.undersideZMm).toBeCloseTo(CASTER.standoffLengthMm + CASTER.heightMm, 6)
    expect(CASTER.standoffLengthMm).toBe(30) // the kit's M3 × 30 brass pillars
    const plate = new THREE.Box3().setFromObject(plateOf(kit()))
    expect(plate.min.z).toBeCloseTo(PLATE.undersideZMm, 3)
    expect(plate.max.z).toBeCloseTo(PLATE.topZMm, 3)
  })

  it('puts the wheels THROUGH the plate: the tyre tops stand proud of it', () => {
    // The kit's signature look — and why the notches exist at all.
    expect(WHEEL.diameterMm).toBeGreaterThan(PLATE.topZMm)
  })

  it('declares the three ground contacts where the tyres and the ball touch', () => {
    const group = kit()
    expect(CONTACTS).toHaveLength(3)
    for (const [x, y, z] of CONTACTS) {
      expect(z).toBe(0)
      // The lowest surface under a contact point is the floor.
      const zs = crossings(group, x, y)
      expect(zs.length, `contact at ${x},${y}`).toBeGreaterThan(0)
      expect(Math.min(...zs)).toBeLessThan(0.5)
    }
    // Two tyres, one each side and a wheel-width outboard of the notch's inner
    // edge; the caster under the nose on the centre-line.
    const tyreY = WHEEL.innerFaceYMm + WHEEL.widthMm / 2
    expect(CONTACTS[0]).toEqual([WHEEL.axleXMm, tyreY, 0])
    expect(CONTACTS[1]).toEqual([WHEEL.axleXMm, -tyreY, 0])
    expect(CONTACTS[2]).toEqual([CASTER.xMm, 0, 0])
  })

  it('cuts REAL wheel notches: no plate over the tyres, but the tyres are there', () => {
    const group = kit()
    const plate = plateOf(group)
    for (const [x, y] of CONTACTS.slice(0, 2)) {
      expect(crossings(plate, x, y), `plate over tyre at ${x},${y}`).toHaveLength(0)
      // …and what the ray does meet first is the top of a Ø65 tyre.
      expect(crossings(group, x, y)[0]).toBeCloseTo(WHEEL.diameterMm, 3)
    }
    // The tyre sits inside its notch with clearance on every side.
    const tyreHalf = Math.sqrt((WHEEL.diameterMm / 2) ** 2 - (PLATE.undersideZMm - WHEEL.diameterMm / 2) ** 2)
    expect(WHEEL.axleXMm - tyreHalf).toBeGreaterThan(PLATE.notch.xFromMm + 1)
    expect(WHEEL.axleXMm + tyreHalf).toBeLessThan(PLATE.notch.xToMm - 1)
    expect(WHEEL.innerFaceYMm).toBeGreaterThan(PLATE.widthMm / 2 - PLATE.notch.depthMm + 1)
    expect(WHEEL.innerFaceYMm + WHEEL.widthMm).toBeLessThan(PLATE.widthMm / 2 - 1)
  })

  it('has real through-holes and slots, and solid acrylic between them', () => {
    const plate = plateOf(kit())
    for (const h of ROUND_HOLES) expect(crossings(plate, h.x, h.y), `hole at ${h.x},${h.y}`).toHaveLength(0)
    for (const s of SLOTS) expect(crossings(plate, s.x, s.y), `slot at ${s.x},${s.y}`).toHaveLength(0)
    // Solid plate reads as its top and bottom faces.
    const solid = crossings(plate, -100, 0)
    expect(solid).toHaveLength(2)
    expect(Math.max(...solid)).toBeCloseTo(PLATE.topZMm, 3)
    expect(Math.min(...solid)).toBeCloseTo(PLATE.undersideZMm, 3)
  })

  it('keeps every hole inside the outline and clear of the notches', () => {
    const halfW = PLATE.widthMm / 2
    const halfL = PLATE.lengthMm / 2
    for (const h of ROUND_HOLES) {
      const r = h.d / 2
      expect(Math.abs(h.x) + r).toBeLessThan(halfL - 2)
      expect(Math.abs(h.y) + r).toBeLessThan(halfW - 2)
      const inNotchSpan = h.x > PLATE.notch.xFromMm && h.x < PLATE.notch.xToMm
      if (inNotchSpan) expect(Math.abs(h.y) + r, `hole at ${h.x},${h.y}`).toBeLessThan(halfW - PLATE.notch.depthMm - 2)
    }
    // No two holes run into each other.
    for (let i = 0; i < ROUND_HOLES.length; i++)
      for (let j = i + 1; j < ROUND_HOLES.length; j++) {
        const a = ROUND_HOLES[i]
        const b = ROUND_HOLES[j]
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.d + b.d)
      }
  })

  it('offers the bare plate on its own for people building their own kit', () => {
    const plate = kit({ plateOnly: true })
    expect(plate.children).toHaveLength(1)
    const box = new THREE.Box3().setFromObject(plate)
    expect(box.max.x - box.min.x).toBeCloseTo(PLATE.lengthMm, 3)
    expect(box.max.y - box.min.y).toBeCloseTo(PLATE.widthMm, 3)
    expect(box.max.z - box.min.z).toBeCloseTo(PLATE.thicknessMm, 3)
  })

  it('exports a binary STL whose header advertises the real triangle count', () => {
    const stl = gen.toStl(gen.chassisGroup()) as Buffer
    expect(stl.length).toBeGreaterThan(84)
    expect(stl.readUInt32LE(80)).toBe((stl.length - 84) / 50)
    // Generated, so it stays a fraction of a hand-modelled kit's size.
    expect(stl.length).toBeLessThan(512 * 1024)
  })
})
