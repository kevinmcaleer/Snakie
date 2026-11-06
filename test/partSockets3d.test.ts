import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { coerceSockets3d, partFromYaml, partToYaml } from '../src/shared/part-yaml'

/**
 * `sockets3d`: where a part's pins are on its 3-D model, for wiring in
 * kevsrobots 3D scenes. Snakie only keeps it, so saving a part in the Part
 * Editor doesn't drop it.
 */
const N20 = join(__dirname, '..', 'examples', 'parts', 'snakie-standard', 'n20-motor')
const HCSR04 = join(__dirname, '..', 'examples', 'parts', 'snakie-standard', 'hc-sr04')

/** A binary STL's corners, moved to the middle of its box (as a 3D scene reads it), and the box's size. */
function centredStl(file: string): { pts: number[][]; size: number[] } {
  const buf = readFileSync(file)
  const n = buf.readUInt32LE(80)
  const pts: number[][] = []
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12
    pts.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)])
  }
  const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])))
  const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])))
  const mid = min.map((m, i) => (m + max[i]) / 2)
  return { pts: pts.map((p) => p.map((v, i) => v - mid[i])), size: max.map((m, i) => m - min[i]) }
}

describe('sockets3d', () => {
  it('survives a save in the Part Editor', () => {
    const part = partFromYaml(readFileSync(join(N20, 'parts.yml'), 'utf8'))
    expect(part.sockets3d?.sockets.map((s) => s.pin)).toEqual(['VCC', 'GND'])
    expect(partFromYaml(partToYaml(part)).sockets3d).toEqual(part.sockets3d)
  })

  it('drops malformed sockets and empty blocks', () => {
    expect(coerceSockets3d({ size: [1, 2], sockets: [] })).toBeUndefined()
    expect(coerceSockets3d({ size: [1, 2, 3], sockets: [{ id: 'a', point: [0, 0, 0] }] })).toBeUndefined()
    const got = coerceSockets3d({ size: [1, 2, 3], sockets: [{ id: 'a', point: [0, 0, 0], normal: [0, 0, 1], connector: 'pin', pin: 'M1', junk: 1 }] })
    expect(got).toEqual({ size: [1, 2, 3], sockets: [{ id: 'a', point: [0, 0, 0], normal: [0, 0, 1], connector: 'pin', pin: 'M1' }] })
  })

  it("puts the N20's VCC and GND on the ends of its two tabs", () => {
    const part = partFromYaml(readFileSync(join(N20, 'parts.yml'), 'utf8'))
    const { pts, size } = centredStl(join(N20, 'model.stl'))
    part.sockets3d!.size.forEach((v, i) => expect(Math.abs(v - size[i])).toBeLessThan(0.05))
    // The pins are named in the part's 2-D pinout.
    const names = part.headers!.flatMap((h) => h.pins.map((p) => p.name))
    for (const s of part.sockets3d!.sockets) {
      expect(names).toContain(s.pin)
      // A corner of the tab is within half a millimetre, and nothing of the model is further out along the normal.
      const near = Math.min(...pts.map((p) => Math.hypot(p[0] - s.point[0], p[1] - s.point[1], p[2] - s.point[2])))
      expect(near).toBeLessThan(0.5)
      const out = Math.max(...pts.map((p) => p[0] * s.normal[0] + p[1] * s.normal[1] + p[2] * s.normal[2]))
      expect(out - (s.point[0] * s.normal[0] + s.point[1] * s.normal[1] + s.point[2] * s.normal[2])).toBeLessThan(0.01)
    }
    // VCC is on the same side as on the 2-D picture (x > 0.5 is +x).
    const vcc = part.headers!.flatMap((h) => h.pins).find((p) => p.name === 'VCC')!
    expect(Math.sign((vcc.x ?? 0.5) - 0.5)).toBe(Math.sign(part.sockets3d!.sockets.find((s) => s.pin === 'VCC')!.point[0]))
  })

  it("puts the HC-SR04's four pins on the ends of its header pins, not on the board's face", () => {
    const part = partFromYaml(readFileSync(join(HCSR04, 'parts.yml'), 'utf8'))
    const { pts, size } = centredStl(join(HCSR04, 'model.stl'))
    part.sockets3d!.size.forEach((v, i) => expect(Math.abs(v - size[i])).toBeLessThan(0.05))
    const pins = part.headers!.flatMap((h) => h.pins)
    expect(part.sockets3d!.sockets.map((s) => s.pin).sort()).toEqual(pins.map((p) => p.name).sort())
    for (const s of part.sockets3d!.sockets) {
      // On the pin's end face (nothing further out along the normal near it), in the pin's square.
      const tip = pts.filter((p) => Math.abs(p[0] - s.point[0]) <= 0.5 && Math.abs(p[2] - s.point[2]) <= 0.5)
      expect(tip.length).toBeGreaterThan(0)
      const out = Math.max(...tip.map((p) => p[0] * s.normal[0] + p[1] * s.normal[1] + p[2] * s.normal[2]))
      expect(Math.abs(out - (s.point[0] * s.normal[0] + s.point[1] * s.normal[1] + s.point[2] * s.normal[2]))).toBeLessThan(0.01)
    }
    // Left to right as on the 2-D picture.
    const byX = [...part.sockets3d!.sockets].sort((a, b) => a.point[0] - b.point[0]).map((s) => s.pin)
    expect(byX).toEqual([...pins].sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map((p) => p.name))
  })
})
