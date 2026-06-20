import { describe, it, expect } from 'vitest'
import { parsePins, BUS_PERIPHERAL, BUS_COLOR } from '../src/renderer/src/components/parse-pins'

describe('parsePins', () => {
  it('returns nothing for empty / pinless source', () => {
    expect(parsePins('')).toEqual([])
    expect(parsePins('x = 1\nprint("hello")\n')).toEqual([])
  })

  it('parses a numeric digital Pin', () => {
    expect(parsePins('led = Pin(25, Pin.OUT)')).toEqual([
      { bus: 'digital', pins: ['25'], variable: 'led', constructor: 'Pin(25, Pin.OUT)' }
    ])
  })

  it('parses a string-labelled digital Pin (onboard LED)', () => {
    const [conn] = parsePins('led = Pin("LED", Pin.OUT)')
    expect(conn.bus).toBe('digital')
    expect(conn.pins).toEqual(['LED'])
    expect(conn.variable).toBe('led')
  })

  it('handles the machine.Pin prefix', () => {
    const [conn] = parsePins('btn = machine.Pin(14, machine.Pin.IN)')
    expect(conn.bus).toBe('digital')
    expect(conn.pins).toEqual(['14'])
  })

  it('parses a PWM-wrapped Pin', () => {
    expect(parsePins('servo = PWM(Pin(16))')).toEqual([
      { bus: 'pwm', pins: ['16'], variable: 'servo', constructor: 'PWM(Pin(16))' }
    ])
  })

  it('parses an I2C bus with sda/scl pins', () => {
    const [conn] = parsePins('i2c = I2C(0, sda=Pin(0), scl=Pin(1))')
    expect(conn.bus).toBe('i2c')
    expect(conn.pins).toEqual(['0', '1'])
    expect(conn.variable).toBe('i2c')
    expect(conn.constructor).toBe('I2C(0, sda=Pin(0), scl=Pin(1))')
  })

  it('parses an SPI bus including trailing cs/dc pins', () => {
    const [conn] = parsePins(
      'tft = SPI(1, sck=Pin(10), mosi=Pin(11), cs=Pin(13), dc=Pin(8))'
    )
    expect(conn.bus).toBe('spi')
    expect(conn.pins).toEqual(['10', '11', '13', '8'])
    expect(conn.variable).toBe('tft')
  })

  it('parses a PIO StateMachine pin', () => {
    const [conn] = parsePins('sm = StateMachine(0, prog, freq=8000000, sideset_base=Pin(22))')
    expect(conn.bus).toBe('pio')
    expect(conn.pins).toEqual(['22'])
    expect(conn.variable).toBe('sm')
  })

  it('parses multiple connections in source order', () => {
    const src = [
      'from machine import Pin, PWM, I2C',
      'led = Pin(25, Pin.OUT)',
      'servo = PWM(Pin(16))',
      'i2c = I2C(0, sda=Pin(0), scl=Pin(1))'
    ].join('\n')
    const conns = parsePins(src)
    expect(conns.map((c) => c.bus)).toEqual(['digital', 'pwm', 'i2c'])
    expect(conns.map((c) => c.variable)).toEqual(['led', 'servo', 'i2c'])
  })

  it('ignores comments and the import line', () => {
    const src = ['from machine import Pin  # noqa', 'led = Pin(2)  # status led'].join('\n')
    const conns = parsePins(src)
    expect(conns).toHaveLength(1)
    expect(conns[0].constructor).toBe('Pin(2)')
  })

  it('reads a typed annotation assignment', () => {
    const [conn] = parsePins('led: Pin = Pin(7)')
    expect(conn.variable).toBe('led')
    expect(conn.pins).toEqual(['7'])
  })

  it('reads a non-assignment constructor with an empty variable', () => {
    const [conn] = parsePins('PWM(Pin(3)).duty_u16(0)')
    expect(conn.bus).toBe('pwm')
    expect(conn.variable).toBe('')
    expect(conn.pins).toEqual(['3'])
  })

  it('drops a constructor that wires no pin', () => {
    // I2C without any Pin(...) args yields no connection to draw.
    expect(parsePins('i2c = I2C(0)')).toEqual([])
  })

  it('exposes a peripheral + colour for every bus', () => {
    for (const bus of ['digital', 'pwm', 'i2c', 'pio', 'spi'] as const) {
      expect(BUS_PERIPHERAL[bus]).toBeTruthy()
      expect(BUS_COLOR[bus]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
