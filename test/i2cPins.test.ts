import { describe, it, expect } from 'vitest'
import { i2cOptions, i2cBuses, sdaOptions, sclOptions, isValidI2c } from '../src/renderer/src/components/i2c-pins'

// The Pico exposes GP0..GP22 then GP26..GP28 (GP23..25 are internal).
const PICO = [...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28]

describe('i2cOptions (RP2040/RP2350 mapping)', () => {
  const opts = i2cOptions(PICO)

  it('maps GP0/1 to I2C0 and GP2/3 to I2C1, SCL = SDA+1', () => {
    expect(opts).toContainEqual({ bus: 0, sda: 0, scl: 1 })
    expect(opts).toContainEqual({ bus: 1, sda: 2, scl: 3 })
    expect(opts).toContainEqual({ bus: 0, sda: 4, scl: 5 })
    expect(opts).toContainEqual({ bus: 1, sda: 6, scl: 7 })
  })

  it('never pairs non-adjacent pins or wrong buses', () => {
    // No option has scl !== sda+1, and bus follows sda%4.
    for (const o of opts) {
      expect(o.scl).toBe(o.sda + 1)
      expect(o.bus).toBe(o.sda % 4 === 0 ? 0 : 1)
    }
  })

  it('only includes pairs whose BOTH pins are exposed', () => {
    // GP22 is exposed but GP23 is not → no {sda:22} option (22%4===2 would be I2C1).
    expect(opts.some((o) => o.sda === 22)).toBe(false)
    // GP26/27 → I2C1 (26%4===2), both exposed → valid.
    expect(opts).toContainEqual({ bus: 1, sda: 26, scl: 27 })
  })

  it('exposes both buses, with SDA/SCL helpers + validation', () => {
    expect(i2cBuses(opts)).toEqual([0, 1])
    expect(sdaOptions(opts, 0)).toContain(4)
    expect(sdaOptions(opts, 0)).not.toContain(2) // GP2 is I2C1
    expect(sclOptions(opts, 0, 4)).toEqual([5])
    expect(isValidI2c(opts, 0, 4, 5)).toBe(true)
    expect(isValidI2c(opts, 0, 4, 7)).toBe(false) // wrong SCL
    expect(isValidI2c(opts, 1, 4, 5)).toBe(false) // wrong bus
  })
})

describe('i2cOptions edge cases', () => {
  it('returns nothing when no adjacent pins are exposed', () => {
    expect(i2cOptions([0, 2, 4])).toEqual([]) // no n,n+1 pair present
  })
})
