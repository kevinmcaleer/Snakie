import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { partFromYaml } from '../src/shared/part-yaml'
import { cornerRadiusFraction } from '../src/shared/part'
import { moduleById } from '../src/shared/modules-catalog'
import { KNOWN_I2C_DEVICES } from '../src/renderer/src/components/i2c-known-devices'
import type { PartDefinition } from '../src/shared/part'

/**
 * TEMPLATE CONFORMANCE for the Modulino range (#722, epic #721).
 *
 * Every Modulino is the same board with different top-side hardware, so the
 * shared half — outline, both QWIIC sockets, the parallel bus, the mesh and the
 * driver wiring — is authored once and each module fills in the rest. This
 * enforces that: it runs over EVERY `modulino-*` part in the standard library,
 * so the twelve still to be built can't quietly drift into twelve subtly
 * different 41 mm boards, which is the exact failure #722 exists to prevent.
 */
const LIB = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')

const MODULINO_DIRS = readdirSync(LIB, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('modulino-'))
  .map((e) => e.name)
  .sort()

const load = (dir: string): PartDefinition =>
  partFromYaml(readFileSync(join(LIB, dir, 'parts.yml'), 'utf-8'))

/** The shared board, from #721. Kept in step with scripts/modulino-mesh.mjs. */
const BOARD = { lengthMm: 41, widthMm: 25.36 }
const BUS_PINS = ['GND', '3V3', 'SDA', 'SCL']
/** Read from the generator, so the 2-D parts and the 3-D mesh can't drift. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MESH_CORNER_RADIUS_MM = ((await import('../scripts/modulino-mesh.mjs')) as any).BOARD
  .cornerRadiusMm as number

describe('Modulino parts follow the shared template (#722)', () => {
  it('there is at least one Modulino part to check', () => {
    // Guards against this whole suite silently passing on an empty list if the
    // library is ever restructured.
    expect(MODULINO_DIRS.length).toBeGreaterThan(0)
  })

  describe.each(MODULINO_DIRS)('%s', (dir) => {
    const part = load(dir)

    it('is the shared 41 × 25.36 mm board', () => {
      expect(part.dimensions?.width).toBeCloseTo(BOARD.lengthMm, 2)
      expect(part.dimensions?.height).toBeCloseTo(BOARD.widthMm, 2)
      expect(part.aspect).toBeCloseTo(BOARD.lengthMm / BOARD.widthMm, 2)
    })

    it('has a rounded outline, and agrees with the mesh when it says so in mm (#739)', () => {
      // The board is a rounded rect, not a sharp one — that much is certain.
      const frac = cornerRadiusFraction(part.shape, part.dimensions)
      expect(frac, `${dir} declares a corner radius`).toBeGreaterThan(0)

      // The 2-D outline and the 3-D mesh are two views of one board, so IF the
      // part states its radius in millimetres they must match. Deliberately not
      // asserted otherwise: the generator's 2 mm is eyeballed from product
      // photos, while a part re-authored in the editor is drawn against a real
      // board photo — pinning the guess would fail the better source. Settle the
      // true radius once and this becomes an equality again.
      if (part.shape?.cornerRadiusMm !== undefined) {
        expect(part.shape.cornerRadiusMm).toBe(MESH_CORNER_RADIUS_MM)
      }
    })

    it('ships the generated mesh, declared in millimetres', () => {
      expect(part.mesh).toBe('modulino.stl')
      expect(part.meshUnits).toBe('mm')
      expect(existsSync(join(LIB, dir, part.mesh!)), `${dir}/${part.mesh}`).toBe(true)
    })

    it('declares a real mass (3.5–4.4 g per the range)', () => {
      expect(part.mass_g).toBeGreaterThanOrEqual(3.5)
      expect(part.mass_g).toBeLessThanOrEqual(4.4)
    })

    it('has four mounting holes', () => {
      expect(part.mountingHoles?.length).toBe(4)
      // The DIAMETER is deliberately not asserted. #721 quotes Ø3.2 from a
      // product page, but the parts are drawn against real board photos and
      // most of the library sits at 1–2 mm; pinning a number sourced from the
      // web would make the author's own eye fail CI. The pitch is what the
      // template actually shares, and the positions below carry that.
      for (const h of part.mountingHoles ?? []) expect(h.diameter).toBeGreaterThan(0)
    })

    it('has a QWIIC socket at EACH end — the daisy-chain', () => {
      const qwiic = (part.connectors ?? []).filter((c) => c.kind === 'qwiic')
      expect(qwiic.length).toBe(2)
      // One near each end of the long axis.
      const xs = qwiic.map((c) => c.x).sort((a, b) => a - b)
      expect(xs[0]).toBeLessThan(0.2)
      expect(xs[1]).toBeGreaterThan(0.8)
    })

    it('puts GND at the BOTTOM of the left socket, as the board does', () => {
      // Confirmed against a real Modulino (2026-08-16). Contacts lay out as
      // `ry = dx·sin(rotation)` with GND declared first, so rotation 270 puts it
      // at the largest y — the bottom — and 90 puts it at the top. The two
      // sockets are the same footprint at opposite ends, i.e. 180° apart, so the
      // right-hand one mirrors.
      //
      // Four of the five parts had these the wrong way round, which is invisible
      // on screen and shows up on real hardware as a dead bus or a reversed
      // supply — hence pinning it.
      const qwiic = (part.connectors ?? []).filter((c) => c.kind === 'qwiic')
      const left = qwiic.find((c) => c.x < 0.5)
      const right = qwiic.find((c) => c.x > 0.5)
      expect(left?.rotation, `${dir} left socket`).toBe(270)
      expect(right?.rotation, `${dir} right socket`).toBe(90)
      // …and GND really is the first contact, which is what makes 270 mean
      // "bottom" rather than the other way about.
      expect(left?.pins[0].name).toBe('GND')
    })

    it('wires both sockets to ONE bus, in parallel, via rails', () => {
      // Without the rails the two sockets are four independent nets and a
      // chained module downstream reads as unpowered.
      const rails = part.rails ?? []
      const byName = new Map(rails.map((r) => [r.name, r]))
      for (const net of BUS_PINS) {
        const rail = byName.get(net)
        expect(rail, `${dir} declares a ${net} rail`).toBeTruthy()
        // BOTH sockets' pins for that net must be on it. A rail may carry MORE
        // than the pair — Motors ties its screw-terminal ground here, because
        // the motor supply's return really is the logic ground (only the
        // positive rail is separate) — so this checks membership, not length.
        expect(rail!.pins).toContain(net)
        expect(rail!.pins).toContain(`${net}-B`)
      }
      // Every rail pin is a real pin somewhere on the part.
      const pinNames = new Set([
        ...(part.connectors ?? []).flatMap((c) => c.pins.map((p) => p.name)),
        ...(part.headers ?? []).flatMap((h) => h.pins.map((p) => p.name))
      ])
      for (const rail of rails) {
        for (const pin of rail.pins) expect(pinNames.has(pin), `${rail.name} → ${pin}`).toBe(true)
      }
    })

    it('carries I²C signals and NO gpio numbers (it is a peripheral, not an MCU)', () => {
      for (const conn of part.connectors ?? []) {
        for (const pin of conn.pins) {
          expect(pin.gpio, `${dir} ${pin.name}`).toBeUndefined()
          if (/^SDA|^SCL/.test(pin.name)) {
            expect(pin.capabilities).toContain('i2c')
            expect(pin.signals?.i2c).toBe(pin.name.startsWith('SDA') ? 'SDA' : 'SCL')
          }
        }
      }
    })

    it('installs the ONE shared catalog module, not its own copy', () => {
      // A board with several Modulinos must be offered a single install (#722):
      // the banner probes `module:` drivers by import, so they collapse into one.
      const drivers = part.drivers ?? []
      expect(drivers.length).toBe(1)
      expect(drivers[0].source).toBe('module:modulino')
      expect(moduleById('modulino'), 'modulino is in the catalog').toBeTruthy()
      expect(part.library?.module).toBe('modulino')
    })

    it('declares its I²C address, and the detect instrument can name it', () => {
      const addrs = part.i2cAddresses ?? []
      expect(addrs.length).toBeGreaterThan(0)
      for (const a of addrs) {
        const names = KNOWN_I2C_DEVICES[a] ?? []
        expect(
          names.some((n) => n.startsWith('Modulino')),
          `0x${a.toString(16)} is named in the I²C table`
        ).toBe(true)
      }
    })

    it('ships a help page', () => {
      expect(part.help).toBe('help.md')
      expect(existsSync(join(LIB, dir, 'help.md'))).toBe(true)
    })
  })
})
