import { describe, it, expect } from 'vitest'
import {
  hexAddr,
  knownDevicesFor,
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
