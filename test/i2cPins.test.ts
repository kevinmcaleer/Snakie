import { describe, it, expect } from 'vitest'
import { i2cOptions, i2cBuses, sdaOptions, sclOptions, isValidI2c, derivedI2cOptions, declaredI2cOptions } from '../src/renderer/src/components/i2c-pins'

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

/**
 * A board's DECLARED I²C pins beat the RP2040 arithmetic (#701).
 *
 * The rule below — SDA at `gpio % 4 === 0` (bus 0) or `=== 2` (bus 1), SCL always
 * SDA+1 — is the Pico family's pin multiplexing, and it was applied to every
 * board. An ESP32 routes I²C through a GPIO matrix, so almost any pin can serve.
 *
 * On a XIAO ESP32-S3 the Grove port is GPIO5 (D4, SDA) and GPIO6 (D5, SCL), and
 * `5 % 4 === 1` satisfies neither branch — so the one pair that actually works
 * could never appear. The dropdown offered 4 & 5 instead, the nearest legal pair
 * under a rule for a different chip, and scanning it finds nothing.
 */
describe('declared I²C pins (#701)', () => {
  /** The real XIAO ESP32-S3 header, as its part declares it. */
  const XIAO_S3 = [
    { gpio: 1 },
    { gpio: 2 },
    { gpio: 3 },
    { gpio: 4 },
    { gpio: 5, i2c: 'SDA' as const, i2cBus: 1 },
    { gpio: 6, i2c: 'SCL' as const, i2cBus: 1 },
    { gpio: 7 },
    { gpio: 8 },
    { gpio: 9 },
    { gpio: 43 },
    { gpio: 44 }
  ]

  it('offers the pair the board actually has — the reported bug', () => {
    const opts = i2cOptions(XIAO_S3)
    expect(opts).toContainEqual({ bus: 1, sda: 5, scl: 6 })
  })

  it('offers it FIRST, so the dropdown opens on the real Grove port', () => {
    // Ordering is the whole user-visible fix: 4 & 5 is still a legal ESP32 pairing,
    // it is just not where the connector is.
    expect(i2cOptions(XIAO_S3)[0]).toEqual({ bus: 1, sda: 5, scl: 6 })
  })

  it('the arithmetic alone could never produce it', () => {
    // Proves the fix is necessary, not merely a reordering: 5 % 4 === 1.
    const gpios = XIAO_S3.map((p) => p.gpio)
    expect(derivedI2cOptions(gpios)).not.toContainEqual({ bus: 1, sda: 5, scl: 6 })
    expect(derivedI2cOptions(gpios)).toContainEqual({ bus: 0, sda: 4, scl: 5 }) // what was shown
  })

  it('keeps the derived options too — a Pico may be wired off-piste', () => {
    // Union, not replacement: narrowing to declared pins only would take away
    // legal combinations from boards where the arithmetic is right.
    const opts = i2cOptions(XIAO_S3)
    expect(opts).toContainEqual({ bus: 0, sda: 4, scl: 5 })
    expect(opts).toContainEqual({ bus: 0, sda: 8, scl: 9 })
  })

  it('is unchanged for a board that declares nothing', () => {
    const bare = [0, 1, 2, 3, 4, 5]
    expect(i2cOptions(bare)).toEqual(derivedI2cOptions(bare))
  })

  it('defaults an unstated bus to 0, and pairs within a bus only', () => {
    expect(declaredI2cOptions([{ gpio: 8, i2c: 'SDA' }, { gpio: 9, i2c: 'SCL' }])).toEqual([
      { bus: 0, sda: 8, scl: 9 }
    ])
    // An SDA on bus 0 must not pair with an SCL on bus 1.
    expect(
      declaredI2cOptions([
        { gpio: 4, i2c: 'SDA', i2cBus: 0 },
        { gpio: 6, i2c: 'SCL', i2cBus: 1 }
      ])
    ).toEqual([])
  })
})
