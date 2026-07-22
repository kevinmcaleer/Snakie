import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'

/**
 * The Circuit Sim power-input parts (#602) — validate the REAL bundled parts.yml
 * files: they parse, carry a `source` electrical block, and expose PWR/GND pins.
 */
const DIR = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')

const BATTERIES = ['battery-aa-4', 'battery-lipo-1s', 'battery-lipo-2s', 'battery-coin-cr2032']

function load(id: string): ReturnType<typeof partFromYaml> {
  return partFromYaml(readFileSync(join(DIR, id, 'parts.yml'), 'utf8'))
}

describe('power-input parts (#602)', () => {
  it.each([...BATTERIES, 'bench-psu'])('%s parses as a Power source with PWR + GND pins', (id) => {
    const part = load(id)
    expect(part.id).toBe(id)
    expect(part.family).toBe('Power')
    expect(part.electrical?.model).toBe('source')
    const pins = (part.headers ?? []).flatMap((h) => h.pins)
    expect(pins.some((p) => p.type === 'pwr')).toBe(true)
    expect(pins.some((p) => p.type === 'gnd')).toBe(true)
    // The terminals map names a positive + negative so the solver knows the polarity.
    expect(part.electrical?.terminals?.positive).toBeTruthy()
    expect(part.electrical?.terminals?.negative).toBeTruthy()
  })

  it('batteries declare a nominal voltage + capacity (for battery-life estimates)', () => {
    for (const id of BATTERIES) {
      const e = load(id).electrical!
      expect(e.supplyV).toBeGreaterThan(0)
      expect(e.capacityMah).toBeGreaterThan(0)
    }
  })

  it('the bench PSU is adjustable — a supplyRange covering its default', () => {
    const e = load('bench-psu').electrical!
    expect(e.supplyRange).toBeDefined()
    const [lo, hi] = e.supplyRange!
    expect(lo).toBeLessThan(hi)
    expect(e.supplyV).toBeGreaterThanOrEqual(lo)
    expect(e.supplyV).toBeLessThanOrEqual(hi)
  })
})
