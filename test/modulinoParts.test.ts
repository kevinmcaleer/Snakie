import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { partFromYaml } from '../src/shared/part-yaml'
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

    it('ships the generated mesh, declared in millimetres', () => {
      expect(part.mesh).toBe('modulino.stl')
      expect(part.meshUnits).toBe('mm')
      expect(existsSync(join(LIB, dir, part.mesh!)), `${dir}/${part.mesh}`).toBe(true)
    })

    it('declares a real mass (3.5–4.4 g per the range)', () => {
      expect(part.mass_g).toBeGreaterThanOrEqual(3.5)
      expect(part.mass_g).toBeLessThanOrEqual(4.4)
    })

    it('has four mounting holes on the shared pitch', () => {
      expect(part.mountingHoles?.length).toBe(4)
      for (const h of part.mountingHoles ?? []) expect(h.diameter).toBeCloseTo(3.2, 2)
    })

    it('has a QWIIC socket at EACH end — the daisy-chain', () => {
      const qwiic = (part.connectors ?? []).filter((c) => c.kind === 'qwiic')
      expect(qwiic.length).toBe(2)
      // One near each end of the long axis.
      const xs = qwiic.map((c) => c.x).sort((a, b) => a - b)
      expect(xs[0]).toBeLessThan(0.2)
      expect(xs[1]).toBeGreaterThan(0.8)
    })

    it('wires both sockets to ONE bus, in parallel, via rails', () => {
      // Without the rails the two sockets are four independent nets and a
      // chained module downstream reads as unpowered.
      const rails = part.rails ?? []
      expect(rails.map((r) => r.name).sort()).toEqual([...BUS_PINS].sort())
      for (const rail of rails) expect(rail.pins.length).toBe(2)
      // Every rail pin is a real pin on one of the connectors.
      const pinNames = new Set((part.connectors ?? []).flatMap((c) => c.pins.map((p) => p.name)))
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
