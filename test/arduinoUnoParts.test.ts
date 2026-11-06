import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { partFromYaml } from '../src/shared/part-yaml'

/**
 * The four Arduino UNO boards: same 68.58 × 53.34 mm PCB, authored portrait
 * (USB end up), with the UNO's 32 header pads where the shield standard puts
 * them. Their models follow the library convention (mm, Z up, lowest point on
 * z = 0, centred on the PCB); the R3's is generated, the others are Arduino's
 * STEP files converted by `scripts/arduino-uno-meshes.mjs`.
 *
 * They sit in `kevsrobots-catalog/`, NOT the Standard library: MicroPython
 * doesn't run on them, so Snakie (a MicroPython IDE) must not offer them, while
 * the kevsrobots.com catalog imports them.
 */
const LIB = join(__dirname, '..', 'examples', 'parts', 'kevsrobots-catalog')
const IDS = ['arduino-uno-r3', 'arduino-uno-r4-minima', 'arduino-uno-r4-wifi', 'arduino-uno-q']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gen = (await import('../scripts/arduino-uno-meshes.mjs')) as any

/** Bounds of a binary STL. */
function stlBounds(file: string): THREE.Box3 {
  const buf = readFileSync(file)
  const n = buf.readUInt32LE(80)
  expect(buf.length).toBe(84 + n * 50)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const o = 84 + i * 50 + 12 + k * 12
      box.expandByPoint(v.set(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)))
    }
  return box
}

describe('Arduino UNO parts', () => {
  it('are kept out of the Standard library Snakie loads', () => {
    for (const id of IDS)
      expect(existsSync(join(LIB, '..', 'snakie-standard', id)), id).toBe(false)
  })

  for (const id of IDS) {
    describe(id, () => {
      const part = partFromYaml(readFileSync(join(LIB, id, 'parts.yml'), 'utf8'))
      const pins = part.headers.flatMap((h) => h.pins)

      it('quotes pin names a YAML 1.1 reader would turn into booleans', () => {
        // kevsrobots' importer uses PyYAML, where a bare OFF/ON/YES/NO is a bool.
        const raw = readFileSync(join(LIB, id, 'parts.yml'), 'utf8')
        expect(raw).not.toMatch(/name: (OFF|ON|YES|NO|Off|On|off|on|yes|no|Y|N|y|n)\b/)
      })

      it('is a UNO-sized microcontroller board with a photo, help and a model', () => {
        expect(part.family).toBe('Microcontroller')
        expect(part.dimensions).toEqual({ width: 53.34, height: 68.58 })
        expect(part.image).toBeTruthy()
        expect(part.help).toBeTruthy()
        expect(part.mesh).toBe('model.stl')
        expect(part.meshUnits).toBe('mm')
      })

      it('has the 32 UNO header pins, digital down the right and power down the left', () => {
        const left = part.headers[0].pins
        const right = part.headers[1].pins
        expect(left.map((p) => p.name).slice(1)).toEqual([
          'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'
        ])
        expect(right.map((p) => p.name)).toEqual([
          'SCL', 'SDA', 'AREF', 'GND',
          ...[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((d) => `D${d}`)
        ])
        // Power and ground are typed as such, never as io.
        for (const p of pins) {
          if (p.name === 'GND') expect(p.type).toBe('gnd')
          if (['3V3', '5V', 'VIN', 'IOREF'].includes(p.name)) expect(p.type).toBe('pwr')
        }
        // Arduino pin numbers: Dn → n, An → 14 + n.
        for (const p of pins) {
          const d = /^D(\d+)$/.exec(p.name)
          const a = /^A(\d)$/.exec(p.name)
          if (d) expect(p.gpio).toBe(+d[1])
          if (a) expect(p.gpio).toBe(14 + +a[1])
        }
        // 2.54 mm pitch on the 68.58 mm edge, in the shield-standard places.
        const yOf = (n: string) => right.find((p) => p.name === n)!.y! * 68.58
        expect(yOf('D0') - yOf('D1')).toBeCloseTo(2.54, 2)
        expect(yOf('D0')).toBeCloseTo(63.5, 2)
        expect(yOf('SCL')).toBeCloseTo(18.796, 2)
        const numbers = pins.map((p) => p.number)
        expect(new Set(numbers).size).toBe(numbers.length)
      })

      it('ships a binary STL in the library frame', () => {
        const file = join(LIB, id, 'model.stl')
        expect(existsSync(file)).toBe(true)
        expect(statSync(file).size).toBeLessThan(3 * 1024 * 1024)
        const box = stlBounds(file)
        expect(box.min.z).toBeCloseTo(0, 3)
        expect(box.min.x).toBeCloseTo(-53.34 / 2, 1)
        expect(box.max.x).toBeCloseTo(53.34 / 2, 1)
        expect(box.min.y).toBeCloseTo(-68.58 / 2, 1)
        // Only the USB / barrel jack overhang the top (+y) edge.
        expect(box.max.y).toBeGreaterThanOrEqual(68.58 / 2 - 0.01)
        expect(box.max.y).toBeLessThan(68.58 / 2 + 7)
      })
    })
  }

  it('opens a socket at every header pin, so a shield\'s pin has a place to go', () => {
    // A top-face triangle of a header that covers a pin's centre would mean no socket there.
    const covers = (pos: ArrayLike<number>, x: number, y: number, z: number) => {
      for (let i = 0; i < pos.length; i += 9) {
        if (![2, 5, 8].every((k) => Math.abs(pos[i + k] - z) < 1e-3)) continue
        const [ax, ay, bx, by, cx, cy] = [pos[i], pos[i + 1], pos[i + 3], pos[i + 4], pos[i + 6], pos[i + 7]]
        const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
        const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
        const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true
      }
      return false
    }
    const top = gen.UNO_R3.thicknessMm + gen.UNO_R3.headerHeightMm
    const headers = gen.unoR3Geometries().filter((g: { name: string }) => g.name.startsWith('header-'))
    const pos = headers.flatMap((g: { geo: { getAttribute: (n: string) => { array: ArrayLike<number> } } }) => Array.from(g.geo.getAttribute('position').array))
    const pins: [number, number][] = gen.headerPins().map(([x, y]: [number, number]) => gen.toPortrait(x, y))
    expect(pins.length).toBe(32)
    for (const [x, y] of pins) {
      expect(covers(pos, x, y, top), `socket at ${x}, ${y}`).toBe(false)
      // …but the header's top is there either side of it.
      expect(covers(pos, x, y + 2.54 / 2 - 0.05, top) || covers(pos, x + 1.27 - 0.05, y, top)).toBe(true)
    }
  })

  it('generates the R3 model it ships', () => {
    const stl: Buffer = gen.toStl(gen.unoR3Group())
    expect(stl.equals(readFileSync(join(LIB, 'arduino-uno-r3', 'model.stl')))).toBe(true)
  })
})
