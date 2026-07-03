import { describe, it, expect } from 'vitest'
import {
  busLabel,
  classifyBusWire,
  i2cBusForGpio,
  spiBusForGpio
} from '../src/renderer/src/components/bus-wires'

describe('RP-family bus derivation (#217)', () => {
  it('I2C block from the GPIO (%4 rule)', () => {
    expect(i2cBusForGpio(0)).toBe(0) // SDA0
    expect(i2cBusForGpio(1)).toBe(0) // SCL0
    expect(i2cBusForGpio(2)).toBe(1) // SDA1
    expect(i2cBusForGpio(3)).toBe(1) // SCL1
    expect(i2cBusForGpio(20)).toBe(0)
    expect(i2cBusForGpio(21)).toBe(0)
    expect(i2cBusForGpio(undefined)).toBeNull()
  })
  it('SPI block from the GPIO (banks of 8)', () => {
    expect(spiBusForGpio(2)).toBe(0)
    expect(spiBusForGpio(19)).toBe(0)
    expect(spiBusForGpio(10)).toBe(1)
    expect(spiBusForGpio(26)).toBe(1)
    expect(spiBusForGpio(undefined)).toBeNull()
  })
  it('labels', () => {
    expect(busLabel('i2c', 0)).toBe('I2C0')
    expect(busLabel('spi', 1)).toBe('SPI1')
    expect(busLabel('i2c', null)).toBe('I2C')
  })
})

describe('bus wire classification (#217)', () => {
  it('part SDA → MCU pad = I2C, bus derived from the pad gpio', () => {
    const wire = classifyBusWire(
      { caps: ['i2c'], signals: { i2c: 'SDA' } }, // part pin (no gpio)
      { gpio: 12 } // Tiny 2350 Qwiic SDA (I2C0)
    )
    expect(wire).toEqual({ kind: 'i2c', bus: 0, label: 'I2C0' })
  })
  it('an authored bus id on either end wins over the derivation', () => {
    const wire = classifyBusWire({ caps: ['i2c'], buses: { i2c: 1 } }, { gpio: 0 })
    expect(wire?.label).toBe('I2C1')
  })
  it('SPI classifies with its own derivation', () => {
    const wire = classifyBusWire({ caps: ['spi'] }, { gpio: 10 })
    expect(wire).toEqual({ kind: 'spi', bus: 1, label: 'SPI1' })
  })
  it('no i2c/spi capability anywhere → not a bus wire', () => {
    expect(classifyBusWire({ caps: ['digital', 'pwm'] }, { gpio: 5 })).toBeNull()
    expect(classifyBusWire({}, {})).toBeNull()
  })
  it('no gpio + no authored bus → bare label', () => {
    expect(classifyBusWire({ caps: ['i2c'] }, {})).toEqual({ kind: 'i2c', bus: null, label: 'I2C' })
  })
})
