import { describe, it, expect } from 'vitest'
import {
  hasI2cInterface,
  hexAddr,
  isReservedI2cAddress,
  knownDevicesFor,
  parseI2cAddress,
  partsClaimingAddress,
  partsForAddress
} from '../src/renderer/src/components/i2c-known-devices'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import type { PartDefinition } from '../src/shared/part'

describe('known I2C devices (#214)', () => {
  it('names the usual suspects', () => {
    expect(knownDevicesFor(0x3c).join(' ')).toContain('SSD1306')
    expect(knownDevicesFor(0x68).join(' ')).toContain('ICM-20948')
    expect(knownDevicesFor(0x76).join(' ')).toContain('BME280')
  })
  it('returns [] for an unknown address', () => {
    expect(knownDevicesFor(0x7f)).toEqual([])
  })
  it('formats addresses like the grid', () => {
    expect(hexAddr(0x68)).toBe('0x68')
    expect(hexAddr(0x03)).toBe('0x03')
  })
})

describe('partsForAddress (#214)', () => {
  const bme: PartDefinition = { id: 'bme280', name: 'BME280', headers: [], i2cAddresses: [0x76, 0x77] }
  const icm: PartDefinition = { id: 'icm20948', name: 'ICM20948', headers: [], i2cAddresses: [0x68, 0x69] }
  const servo: PartDefinition = { id: 'sg90', name: 'SG90', headers: [] } // no addresses
  const libs = [{ id: 'snakie-standard', parts: [bme, icm, servo] }]

  it('matches installed parts by declared address', () => {
    expect(partsForAddress(0x76, libs)).toEqual([{ libraryId: 'snakie-standard', part: bme }])
    expect(partsForAddress(0x69, libs)).toEqual([{ libraryId: 'snakie-standard', part: icm }])
  })
  it('no declared address / no match → []', () => {
    expect(partsForAddress(0x3c, libs)).toEqual([])
  })
})

describe('parts.yml i2cAddresses codec (#214)', () => {
  it('round-trips through YAML', () => {
    const yml = partToYaml({ id: 'x', name: 'X', headers: [], i2cAddresses: [0x76, 0x77] })
    expect(yml).toContain('i2cAddresses')
    const back = partFromYaml(yml)
    expect(back.i2cAddresses).toEqual([118, 119])
  })
  it('coerces hex strings and drops out-of-range values', () => {
    const p = partFromYaml('id: y\nname: Y\ni2cAddresses: ["0x68", 300, -1, 12]\n')
    expect(p.i2cAddresses).toEqual([0x68, 12])
  })
  it('absent → undefined', () => {
    expect(partFromYaml('id: z\nname: Z\n').i2cAddresses).toBeUndefined()
  })
})

/** The authoring helpers behind the Part Editor's Addresses section (#653). */
describe('parseI2cAddress (#653)', () => {
  it('accepts the marked hex forms', () => {
    expect(parseI2cAddress('0x76')).toBe(0x76)
    expect(parseI2cAddress('0X76')).toBe(0x76)
    expect(parseI2cAddress('76h')).toBe(0x76)
    expect(parseI2cAddress('$76')).toBe(0x76)
    expect(parseI2cAddress('0x7f')).toBe(0x7f)
  })

  it('reads bare digits as DECIMAL, not hex', () => {
    // The ambiguous case the section shows back to the author: someone meaning
    // 0x76 who types `76` gets 0x4C, and must be able to see that.
    expect(parseI2cAddress('76')).toBe(76)
    expect(hexAddr(parseI2cAddress('76') as number)).toBe('0x4C')
    expect(parseI2cAddress('118')).toBe(0x76)
  })

  it('tolerates surrounding whitespace and empty input', () => {
    expect(parseI2cAddress('  0x29  ')).toBe(0x29)
    expect(parseI2cAddress('')).toBeNull()
    expect(parseI2cAddress('   ')).toBeNull()
  })

  it('rejects anything outside the 7-bit range', () => {
    expect(parseI2cAddress('0x80')).toBeNull()
    expect(parseI2cAddress('128')).toBeNull()
    expect(parseI2cAddress('-1')).toBeNull()
    expect(parseI2cAddress('0x100')).toBeNull()
  })

  it('rejects junk rather than salvaging a number from it', () => {
    expect(parseI2cAddress('0x76 (SDO low)')).toBeNull()
    expect(parseI2cAddress('0x76/0x77')).toBeNull()
    expect(parseI2cAddress('zz')).toBeNull()
    expect(parseI2cAddress('12.5')).toBeNull()
  })

  it('agrees with what partFromYaml will accept', () => {
    // The editor must not author a value the loader would silently discard.
    for (const raw of ['0x00', '0x07', '0x76', '0x7f']) {
      const addr = parseI2cAddress(raw) as number
      const back = partFromYaml(`id: p\nname: P\ni2cAddresses: [${addr}]\n`)
      expect(back.i2cAddresses).toEqual([addr])
    }
  })
})

describe('isReservedI2cAddress (#653)', () => {
  it('flags both reserved ranges', () => {
    expect(isReservedI2cAddress(0x00)).toBe(true)
    expect(isReservedI2cAddress(0x07)).toBe(true)
    expect(isReservedI2cAddress(0x78)).toBe(true)
    expect(isReservedI2cAddress(0x7f)).toBe(true)
  })

  it('leaves the usable range alone', () => {
    expect(isReservedI2cAddress(0x08)).toBe(false)
    expect(isReservedI2cAddress(0x76)).toBe(false)
    expect(isReservedI2cAddress(0x77)).toBe(false)
  })
})

describe('partsClaimingAddress (#653)', () => {
  const mk = (id: string, addrs?: number[]): PartDefinition =>
    ({ id, name: id, headers: [], i2cAddresses: addrs }) as PartDefinition
  const lib = [mk('bme280', [0x76, 0x77]), mk('bmp280', [0x76]), mk('nothing')]

  it('finds the other parts on that address', () => {
    expect(partsClaimingAddress(0x76, lib).map((p) => p.id)).toEqual(['bme280', 'bmp280'])
  })

  it('excludes the part being edited, so it never clashes with itself', () => {
    expect(partsClaimingAddress(0x76, lib, 'bme280').map((p) => p.id)).toEqual(['bmp280'])
  })

  it('is empty for an unclaimed address', () => {
    expect(partsClaimingAddress(0x29, lib)).toEqual([])
  })
})

describe('hasI2cInterface (#653)', () => {
  const base = { id: 'p', name: 'P', headers: [] } as unknown as PartDefinition

  it('sees an i2c-capable header pin', () => {
    expect(
      hasI2cInterface({
        ...base,
        headers: [{ edge: 'left', pins: [{ name: 'SDA', type: 'io', capabilities: ['i2c'] }] }]
      } as PartDefinition)
    ).toBe(true)
  })

  it('sees a QWIIC connector, and a Grove port strapped to i2c', () => {
    const conn = (kind: string, variant?: string): PartDefinition =>
      ({ ...base, connectors: [{ kind, variant, x: 0.5, y: 0.5, pins: [] }] }) as unknown as PartDefinition
    expect(hasI2cInterface(conn('qwiic'))).toBe(true)
    expect(hasI2cInterface(conn('grove', 'i2c'))).toBe(true)
    expect(hasI2cInterface(conn('grove', 'uart'))).toBe(false)
  })

  it('sees an i2c contact inside a connector', () => {
    expect(
      hasI2cInterface({
        ...base,
        connectors: [
          { kind: 'jst', x: 0.5, y: 0.5, pins: [{ name: 'SCL', type: 'io', capabilities: ['i2c'] }] }
        ]
      } as unknown as PartDefinition)
    ).toBe(true)
  })

  it('is false for a part with no I\u00b2C anything', () => {
    expect(hasI2cInterface(base)).toBe(false)
    expect(
      hasI2cInterface({
        ...base,
        headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', capabilities: ['pwm'] }] }]
      } as PartDefinition)
    ).toBe(false)
  })
})
