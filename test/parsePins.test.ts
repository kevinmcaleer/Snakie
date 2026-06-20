import { describe, it, expect } from 'vitest'
import {
  parsePins,
  PIN_TYPE_COLOR,
  PIN_TYPE_LABEL,
  PIN_TYPE_TAG
} from '../src/renderer/src/components/parse-pins'

describe('parsePins', () => {
  it('returns nothing for empty / pinless source', () => {
    expect(parsePins('')).toEqual([])
    expect(parsePins('x = 1\nprint("hello")\n')).toEqual([])
  })

  it('classifies an explicit Pin.OUT as output', () => {
    expect(parsePins('led = Pin(25, Pin.OUT)')).toEqual([
      { type: 'output', pins: ['25'], variable: 'led', constructor: 'Pin(25, Pin.OUT)' }
    ])
  })

  it('classifies a bare OUT 2nd positional as output', () => {
    const [conn] = parsePins('from machine import Pin, OUT\nled = Pin(15, OUT)')
    expect(conn.type).toBe('output')
    expect(conn.pins).toEqual(['15'])
  })

  it('classifies an explicit Pin.IN as input', () => {
    const [conn] = parsePins('btn = machine.Pin(14, machine.Pin.IN)')
    expect(conn.type).toBe('input')
    expect(conn.pins).toEqual(['14'])
  })

  it('classifies Pin.IN with a pull resistor as input', () => {
    const [conn] = parsePins('btn = Pin(16, Pin.IN, Pin.PULL_UP)')
    expect(conn.type).toBe('input')
    expect(conn.pins).toEqual(['16'])
  })

  it('classifies a string-labelled Pin (onboard LED) by usage', () => {
    const [conn] = parsePins('led = Pin("LED", Pin.OUT)')
    expect(conn.type).toBe('output')
    expect(conn.pins).toEqual(['LED'])
    expect(conn.variable).toBe('led')
  })

  it('infers output from a later .on() / .value(1) write on an undirected Pin', () => {
    const on = parsePins('led = Pin(2)\nled.on()')
    expect(on[0].type).toBe('output')
    const val = parsePins('relay = Pin(5)\nrelay.value(1)')
    expect(val[0].type).toBe('output')
  })

  it('infers input from a later bare .value() read on an undirected Pin', () => {
    const [conn] = parsePins('btn = Pin(12)\nif btn.value():\n    pass')
    expect(conn.type).toBe('input')
    expect(conn.pins).toEqual(['12'])
  })

  it('defaults an ambiguous undirected Pin to output', () => {
    const [conn] = parsePins('led = Pin(3)')
    expect(conn.type).toBe('output')
  })

  it('parses a PWM-wrapped Pin', () => {
    expect(parsePins('servo = PWM(Pin(16))')).toEqual([
      { type: 'pwm', pins: ['16'], variable: 'servo', constructor: 'PWM(Pin(16))' }
    ])
  })

  it('parses an I2C bus with sda/scl pins', () => {
    const [conn] = parsePins('i2c = I2C(0, sda=Pin(0), scl=Pin(1))')
    expect(conn.type).toBe('i2c')
    expect(conn.pins).toEqual(['0', '1'])
    expect(conn.variable).toBe('i2c')
    expect(conn.constructor).toBe('I2C(0, sda=Pin(0), scl=Pin(1))')
  })

  it('parses an SPI bus including trailing cs/dc pins', () => {
    const [conn] = parsePins(
      'tft = SPI(1, sck=Pin(10), mosi=Pin(11), cs=Pin(13), dc=Pin(8))'
    )
    expect(conn.type).toBe('spi')
    expect(conn.pins).toEqual(['10', '11', '13', '8'])
    expect(conn.variable).toBe('tft')
  })

  it('parses a PIO StateMachine pin', () => {
    const [conn] = parsePins('sm = StateMachine(0, prog, freq=8000000, sideset_base=Pin(22))')
    expect(conn.type).toBe('pio')
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
    expect(conns.map((c) => c.type)).toEqual(['output', 'pwm', 'i2c'])
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
    expect(conn.type).toBe('pwm')
    expect(conn.variable).toBe('')
    expect(conn.pins).toEqual(['3'])
  })

  it('drops a constructor that wires no pin', () => {
    // I2C without any Pin(...) args yields no connection to draw.
    expect(parsePins('i2c = I2C(0)')).toEqual([])
  })

  it('exposes a colour + label for every connection type', () => {
    for (const type of ['output', 'input', 'pwm', 'i2c', 'spi', 'pio'] as const) {
      expect(PIN_TYPE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(PIN_TYPE_LABEL[type]).toMatch(/^[A-Z0-9]+$/)
    }
  })

  it('exposes a short node-graph tag for every connection type', () => {
    // Each tag is short (≤3 visible chars) and a non-empty string — these label
    // the inline type chip on the node-graph Board View cards.
    const tags = ['output', 'input', 'pwm', 'i2c', 'spi', 'pio'].map(
      (t) => PIN_TYPE_TAG[t as keyof typeof PIN_TYPE_TAG]
    )
    expect(tags).toEqual(['OUT', 'IN', 'PWM', 'I²C', 'SPI', 'PIO'])
    for (const tag of tags) {
      expect(tag.length).toBeGreaterThan(0)
      expect(tag.length).toBeLessThanOrEqual(3)
    }
    // The short tags are never longer than the full table labels.
    for (const type of ['output', 'input', 'pwm', 'i2c', 'spi', 'pio'] as const) {
      expect(PIN_TYPE_TAG[type].length).toBeLessThanOrEqual(PIN_TYPE_LABEL[type].length)
    }
  })
})
