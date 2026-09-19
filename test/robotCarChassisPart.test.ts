import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'
import { flattenPartPins } from '../src/shared/netlist'

/**
 * The bundled 2WD robot car chassis: the assembled "smart car" kit as one
 * part, whose `parts.yml` must agree with the generated model
 * (`scripts/robot-chassis-mesh.mjs`) it ships — same plate size, same ground
 * contacts, same hole grid — so the picture, the 2-D footprint and the 3-D
 * body cannot drift apart.
 */
const DIR = join(__dirname, '..', 'examples', 'parts', 'snakie-standard', 'robot-car-chassis-2wd')
const part = partFromYaml(readFileSync(join(DIR, 'parts.yml'), 'utf8'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gen = (await import('../scripts/robot-chassis-mesh.mjs')) as any
const PLATE = gen.PLATE as { lengthMm: number; widthMm: number }
const ROUND_HOLES = gen.ROUND_HOLES as { x: number; y: number; d: number }[]
const CONTACTS = gen.GROUND_CONTACTS as [number, number, number][]

describe('robot-car-chassis-2wd part', () => {
  it('is the generator’s part, in its own Chassis category', () => {
    expect(part.id).toBe(gen.PART_ID)
    expect(part.family).toBe('Chassis')
    expect(part.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('bundles its image, help and 3-D model, authored in millimetres', () => {
    expect(part.image).toBe('image.png')
    expect(part.help).toBe('help.md')
    expect(part.mesh).toBe(gen.MESH_FILENAME)
    expect(part.meshUnits).toBe('mm')
    for (const f of ['image.png', 'help.md', 'model.stl']) expect(existsSync(join(DIR, f)), f).toBe(true)
    // No orientation or position fix-up: the generator already puts it board-
    // flat, Z up, on the ground.
    expect(part.meshRotation).toBeUndefined()
    expect(part.meshOffset).toBeUndefined()
  })

  it('declares the plate’s real size, so the footprint scales like the model', () => {
    expect(part.dimensions).toEqual({ width: PLATE.lengthMm, height: PLATE.widthMm })
    expect(part.aspect).toBeCloseTo(PLATE.lengthMm / PLATE.widthMm, 2)
  })

  it('ships a top-down image cropped exactly to the plate', () => {
    // PNG IHDR: width and height as big-endian u32 at bytes 16 and 20.
    const png = readFileSync(join(DIR, 'image.png'))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    const w = png.readUInt32BE(16)
    const h = png.readUInt32BE(20)
    expect(w / h).toBeCloseTo(PLATE.lengthMm / PLATE.widthMm, 2)
    expect(part.imageLayer).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('touches the floor exactly where the model does', () => {
    expect(part.contacts).toEqual(CONTACTS)
    // Two tyres and a caster: the support polygon is a triangle.
    expect(part.contacts).toHaveLength(3)
  })

  it('carries a real mass and a centre of mass over the motors, not the plate centre', () => {
    expect(part.mass_g).toBe(250)
    expect(part.com_xyz).toBeDefined()
    const [x, , z] = part.com_xyz!
    expect(x).toBeLessThan(0) // the heavy end is the motors' end (−x)
    expect(z).toBeGreaterThan(0)
  })

  it('draws every one of the model’s round holes as a mounting hole', () => {
    const holes = part.mountingHoles ?? []
    expect(holes).toHaveLength(ROUND_HOLES.length)
    for (const h of ROUND_HOLES) {
      // Mesh frame (mm, +y left) → normalised outline (0..1, y down).
      const nx = (h.x + PLATE.lengthMm / 2) / PLATE.lengthMm
      const ny = (PLATE.widthMm / 2 - h.y) / PLATE.widthMm
      const match = holes.find((m) => Math.abs(m.x - nx) < 0.002 && Math.abs(m.y - ny) < 0.002)
      expect(match, `hole at ${h.x},${h.y}`).toBeDefined()
      expect(match!.diameter).toBe(h.d)
    }
  })

  it('brings out both motors and the battery pack as pins', () => {
    const pins = flattenPartPins(part)
    const byName = new Map(pins.map((p) => [p.name, p]))
    for (const n of ['ML+', 'ML-', 'MR+', 'MR-']) expect(byName.get(n)?.type, n).toBe('other')
    expect(byName.get('V+')?.type).toBe('pwr')
    expect(byName.get('GND')?.type).toBe('gnd')
    expect(pins).toHaveLength(6)
    // The left motor is drawn on the top half, the right on the bottom.
    expect(byName.get('ML+')!.y).toBeLessThan(0.5)
    expect(byName.get('MR+')!.y).toBeGreaterThan(0.5)
  })

  it('is a 6 V source in the circuit sim — the 4×AA pack, sag included', () => {
    expect(part.electrical?.model).toBe('source')
    expect(part.electrical?.supplyV).toBe(6)
    expect(part.electrical?.resistanceOhms).toBeGreaterThan(0)
    expect(part.electrical?.terminals).toEqual({ positive: 'V+', negative: 'GND' })
  })
})
