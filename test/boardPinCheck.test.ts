import { describe, it, expect } from 'vitest'
import { validateBusPins, boardPinsFromPart, type BoardPinInfo } from '../src/renderer/src/components/board-pin-check'

// A slice of the real Pico bus map: I2C0 = GP0(SDA)/GP1(SCL) & GP4/GP5,
// I2C1 = GP2/GP3 & GP6/GP7; SPI0 sck=GP2 mosi=GP3 miso=GP0 cs=GP1; UART1 = GP4/GP5.
const PICO: BoardPinInfo[] = [
  { gpio: 0, label: 'GP0', capabilities: ['i2c', 'spi'], signals: { i2c: 'SDA', spi: 'RX' }, buses: { i2c: 0, spi: 0 } },
  { gpio: 1, label: 'GP1', capabilities: ['i2c', 'spi'], signals: { i2c: 'SCL', spi: 'CSn' }, buses: { i2c: 0, spi: 0 } },
  { gpio: 2, label: 'GP2', capabilities: ['i2c', 'spi'], signals: { i2c: 'SDA', spi: 'SCK' }, buses: { i2c: 1, spi: 0 } },
  { gpio: 3, label: 'GP3', capabilities: ['i2c', 'spi'], signals: { i2c: 'SCL', spi: 'TX' }, buses: { i2c: 1, spi: 0 } },
  { gpio: 6, label: 'GP6', capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 1 } },
  { gpio: 7, label: 'GP7', capabilities: ['i2c'], signals: { i2c: 'SCL' }, buses: { i2c: 1 } },
  { gpio: 4, label: 'GP4', capabilities: ['uart'], signals: { uart: 'TX' }, buses: { uart: 1 } },
  { gpio: 5, label: 'GP5', capabilities: ['uart'], signals: { uart: 'RX' }, buses: { uart: 1 } },
  { gpio: 25, label: 'GP25', capabilities: ['digital'] }
]

describe('validateBusPins — I2C', () => {
  it('accepts a correct I2C0 wiring', () => {
    expect(validateBusPins('i2c = I2C(0, sda=Pin(0), scl=Pin(1))', PICO)).toEqual([])
  })

  it('flags id=0 when the pins are on I2C1, and offers a fix to id=1', () => {
    const src = 'i2c = I2C(0, sda=Pin(6), scl=Pin(7))'
    const diags = validateBusPins(src, PICO)
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toMatch(/id=0, but these pins are I2C1/)
    expect(diags[0].fix?.text).toBe('1')
    // The fix/diagnostic targets the `0` in `I2C(0,` (column of that digit).
    expect(src.slice(diags[0].startCol - 1, diags[0].endCol - 1)).toBe('0')
    expect(diags[0].fix?.title).toBe('Change I2C id to 1')
  })

  it('resolves pins passed as variables before validating (the GP0 report)', () => {
    const src = ['sda = Pin(6)', 'scl = Pin(7)', 'id = 0', 'i2c = I2C(id=0, sda=sda, scl=scl)'].join('\n')
    const diags = validateBusPins(src, PICO)
    expect(diags).toHaveLength(1)
    expect(diags[0].line).toBe(4)
    expect(diags[0].message).toMatch(/these pins are I2C1/)
    expect(diags[0].fix?.text).toBe('1')
  })

  it('flags a pin with no I2C capability', () => {
    const diags = validateBusPins('i2c = I2C(0, sda=Pin(25), scl=Pin(1))', PICO)
    expect(diags.some((d) => /GP25 can't be used as I2C SDA/.test(d.message))).toBe(true)
  })

  it('flags swapped SDA/SCL roles', () => {
    const diags = validateBusPins('i2c = I2C(0, sda=Pin(1), scl=Pin(0))', PICO)
    // GP1 is SCL used as sda; GP0 is SDA used as scl.
    expect(diags.some((d) => /GP1 is I2C0 SCL — not SDA/.test(d.message))).toBe(true)
    expect(diags.some((d) => /GP0 is I2C0 SDA — not SCL/.test(d.message))).toBe(true)
  })

  it('flags SDA/SCL resolving to different I2C buses', () => {
    const diags = validateBusPins('i2c = I2C(0, sda=Pin(0), scl=Pin(3))', PICO)
    expect(diags.some((d) => /different I2C buses \(I2C0 vs I2C1\)/.test(d.message))).toBe(true)
  })

  it('accepts bare pin numbers and GP-labels', () => {
    expect(validateBusPins('i2c = I2C(1, sda=6, scl=7)', PICO)).toEqual([])
    expect(validateBusPins('i2c = I2C(1, sda="GP6", scl="GP7")', PICO)).toEqual([])
  })
})

describe('validateBusPins — SPI + UART', () => {
  it('accepts a correct SPI0 wiring and flags a wrong id', () => {
    expect(validateBusPins('spi = SPI(0, sck=Pin(2), mosi=Pin(3), miso=Pin(0))', PICO)).toEqual([])
    const diags = validateBusPins('spi = SPI(1, sck=Pin(2), mosi=Pin(3), miso=Pin(0))', PICO)
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toMatch(/SPI id=1, but these pins are SPI0/)
    expect(diags[0].fix?.text).toBe('0')
  })

  it('validates UART tx/rx and the bus id', () => {
    expect(validateBusPins('u = UART(1, tx=Pin(4), rx=Pin(5))', PICO)).toEqual([])
    const diags = validateBusPins('u = UART(0, tx=Pin(4), rx=Pin(5))', PICO)
    expect(diags[0].message).toMatch(/UART id=0, but these pins are UART1/)
    expect(diags[0].fix?.text).toBe('1')
  })
})

describe('validateBusPins — guards', () => {
  it('stays silent when the board carries no bus metadata', () => {
    const plain: BoardPinInfo[] = [{ gpio: 0, label: 'GP0', capabilities: ['digital'] }]
    expect(validateBusPins('i2c = I2C(0, sda=Pin(0), scl=Pin(1))', plain)).toEqual([])
  })

  it('ignores pins not on the board (custom/unknown) rather than false-flagging', () => {
    expect(validateBusPins('i2c = I2C(0, sda=Pin(40), scl=Pin(41))', PICO)).toEqual([])
  })

  it('boardPinsFromPart flattens header + connector pins with gpio', () => {
    const pins = boardPinsFromPart({
      headers: [{ pins: [{ gpio: 0, name: 'GP0', capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 } }] }],
      connectors: [{ pins: [{ gpio: 4, name: 'SDA', capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 } }, { name: 'GND' }] }]
    })
    expect(pins.map((p) => p.gpio)).toEqual([0, 4])
  })
})
