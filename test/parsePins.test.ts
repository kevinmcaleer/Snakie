import { describe, it, expect } from 'vitest'
import {
  parseInstrumentPins,
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

  it('parses an I2C bus with sda/scl pins, roles and bus id', () => {
    const [conn] = parsePins('i2c = I2C(0, sda=Pin(0), scl=Pin(1))')
    expect(conn.type).toBe('i2c')
    expect(conn.pins).toEqual(['0', '1'])
    expect(conn.roles).toEqual(['SDA', 'SCL'])
    expect(conn.bus).toBe(0)
    expect(conn.variable).toBe('i2c')
    expect(conn.constructor).toBe('I2C(0, sda=Pin(0), scl=Pin(1))')
  })

  it('parses an I2C bus given bare pin numbers (sda=4, scl=5)', () => {
    // The `sda=Pin(..)` form is common but ports also accept raw numbers — and
    // the demos use that (examples/board_view_test.py). Both pins must surface
    // so the bus shows up grouped on the board (#147).
    const [conn] = parsePins('i2c = I2C(id=0, sda=4, scl=5)')
    expect(conn.type).toBe('i2c')
    expect(conn.pins).toEqual(['4', '5'])
    expect(conn.roles).toEqual(['SDA', 'SCL'])
    expect(conn.bus).toBe(0)
    expect(conn.constructor).toBe('I2C(id=0, sda=4, scl=5)')
  })

  it('resolves I2C pins passed as variables (sda=sda) back to their Pin numbers', () => {
    // Very common pattern: pins defined on their own lines then passed by name.
    // Previously the tokens `sda`/`scl` couldn't resolve and fell back to pad 0,
    // mislabelling `i2c` on GP0. They must resolve to GP6/GP7.
    const src = 'sda = Pin(6)\nscl = Pin(7)\nid = 0\ni2c = I2C(id=0, sda=sda, scl=scl)'
    const conns = parsePins(src)
    const i2c = conns.find((c) => c.type === 'i2c')
    expect(i2c?.pins).toEqual(['6', '7'])
    expect(i2c?.roles).toEqual(['SDA', 'SCL'])
    expect(i2c?.bus).toBe(0)
  })

  it('resolves pins from bare-int constants (SDA_PIN = 6) and named LED vars', () => {
    const i2c = parsePins('SDA_PIN = 6\nSCL_PIN = 7\nbus = I2C(1, sda=SDA_PIN, scl=SCL_PIN)').find((c) => c.type === 'i2c')
    expect(i2c?.pins).toEqual(['6', '7'])
    const [led] = parsePins('pin = Pin("LED")\nled = Pin(pin)')
    // The Pin("LED") line resolves; a var pointing at it resolves to "LED".
    expect(led.pins).toEqual(['LED'])
  })

  it('reads the I2C bus number from id= (bus 1) without mistaking it for a pin', () => {
    // `id=1` is the hardware bus (Pico I2C1), not a pad — only sda/scl are pins.
    const [conn] = parsePins('i2c = I2C(id=1, sda=2, scl=3)')
    expect(conn.pins).toEqual(['2', '3'])
    expect(conn.bus).toBe(1)
  })

  it('reads the I2C bus number from the first positional arg', () => {
    const [conn] = parsePins('i2c = I2C(1, sda=Pin(2), scl=Pin(3))')
    expect(conn.bus).toBe(1)
  })

  it('parses an SPI bus including trailing cs/dc pins, with roles and bus id', () => {
    const [conn] = parsePins(
      'tft = SPI(1, sck=Pin(10), mosi=Pin(11), cs=Pin(13), dc=Pin(8))'
    )
    expect(conn.type).toBe('spi')
    expect(conn.pins).toEqual(['10', '11', '13', '8'])
    // miso is absent → its role is skipped, roles stay parallel to pins.
    expect(conn.roles).toEqual(['SCK', 'MOSI', 'CS', 'DC'])
    expect(conn.bus).toBe(1)
    expect(conn.variable).toBe('tft')
  })

  it('parses an SPI bus given bare pin numbers (sck=2, mosi=3, miso=4)', () => {
    const [conn] = parsePins('spi = SPI(0, sck=2, mosi=3, miso=4)')
    expect(conn.type).toBe('spi')
    expect(conn.pins).toEqual(['2', '3', '4'])
    expect(conn.roles).toEqual(['SCK', 'MOSI', 'MISO'])
    expect(conn.bus).toBe(0)
  })

  it('labels positional I2C Pin() args by role', () => {
    const [conn] = parsePins('i2c = I2C(0, Pin(0), Pin(1))')
    expect(conn.pins).toEqual(['0', '1'])
    expect(conn.roles).toEqual(['SDA', 'SCL'])
  })

  it('leaves non-bus connections without roles/bus', () => {
    const [conn] = parsePins('led = Pin(15, Pin.OUT)')
    expect(conn.roles).toBeUndefined()
    expect(conn.bus).toBeUndefined()
  })

  it('parses an ADC wrapping a Pin', () => {
    expect(parsePins('temp = ADC(Pin(26))')).toEqual([
      { type: 'adc', pins: ['26'], variable: 'temp', constructor: 'ADC(Pin(26))' }
    ])
  })

  it('parses a bare ADC(channel-number) form', () => {
    const [conn] = parsePins('pot = ADC(0)')
    expect(conn.type).toBe('adc')
    expect(conn.pins).toEqual(['0'])
    expect(conn.variable).toBe('pot')
  })

  it('parses a bare ADC(gpio-number) and machine.ADC', () => {
    expect(parsePins('a = ADC(27)')[0]).toMatchObject({ type: 'adc', pins: ['27'] })
    const [conn] = parsePins('a = machine.ADC(Pin(28))')
    expect(conn.type).toBe('adc')
    expect(conn.pins).toEqual(['28'])
  })

  it('parses an ADC wrapping a string-labelled Pin', () => {
    const [conn] = parsePins("temp = ADC(Pin('GP26'))")
    expect(conn.type).toBe('adc')
    expect(conn.pins).toEqual(['GP26'])
  })

  it('does not misread an ADC as a plain Pin output', () => {
    // `ADC(Pin(26))` must classify as adc — never fall through to the Pin case.
    const [conn] = parsePins('temp = ADC(Pin(26))\ntemp.read_u16()')
    expect(conn.type).toBe('adc')
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
    for (const type of [
      'output',
      'input',
      'pwm',
      'adc',
      'i2c',
      'spi',
      'pio',
      'instrument'
    ] as const) {
      expect(PIN_TYPE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/i)
      expect(PIN_TYPE_LABEL[type]).toMatch(/^[A-Z0-9]+$/)
    }
    // ADC gets the teal accent + its own label/tag.
    expect(PIN_TYPE_COLOR.adc).toBe('#34c0a8')
    expect(PIN_TYPE_LABEL.adc).toBe('ADC')
    expect(PIN_TYPE_TAG.adc).toBe('ADC')
    // Instrument-owned pins get their own amber-gold accent + INST label.
    expect(PIN_TYPE_COLOR.instrument).toBe('#e8b34a')
    expect(PIN_TYPE_LABEL.instrument).toBe('INST')
  })

  it('exposes a short node-graph tag for every connection type', () => {
    // Each tag is short (≤3 visible chars) and a non-empty string — these label
    // the inline type chip on the node-graph Board View cards.
    const tags = ['output', 'input', 'pwm', 'adc', 'i2c', 'spi', 'pio', 'instrument'].map(
      (t) => PIN_TYPE_TAG[t as keyof typeof PIN_TYPE_TAG]
    )
    expect(tags).toEqual(['OUT', 'IN', 'PWM', 'ADC', 'I²C', 'SPI', 'PIO', '⚙'])
    for (const tag of tags) {
      expect(tag.length).toBeGreaterThan(0)
      expect(tag.length).toBeLessThanOrEqual(3)
    }
    // The short tags are never longer than the full table labels.
    for (const type of ['output', 'input', 'pwm', 'adc', 'i2c', 'spi', 'pio'] as const) {
      expect(PIN_TYPE_TAG[type].length).toBeLessThanOrEqual(PIN_TYPE_LABEL[type].length)
    }
  })
})

describe('parseInstrumentPins', () => {
  it('returns nothing for empty / instrument-free source', () => {
    expect(parseInstrumentPins('')).toEqual([])
    expect(parseInstrumentPins('led = Pin(25, Pin.OUT)\nled.on()')).toEqual([])
  })

  it('detects a buzzer_pin kwarg on inst.start(...)', () => {
    expect(parseInstrumentPins('inst.start(buzzer_pin=15)')).toEqual([
      { instrument: 'buzzer', pin: '15' }
    ])
  })

  it('tolerates the `instruments` alias and whitespace around the kwarg', () => {
    expect(parseInstrumentPins('instruments.start(  buzzer_pin = 9  )')).toEqual([
      { instrument: 'buzzer', pin: '9' }
    ])
    // Any identifier bound to the library works (alias-agnostic).
    expect(parseInstrumentPins('svc . start( buzzer_pin=2 )')).toEqual([
      { instrument: 'buzzer', pin: '2' }
    ])
  })

  it('captures multiple *_pin kwargs in one call, in order', () => {
    expect(
      parseInstrumentPins('inst.start(hz=50, buzzer_pin=9, led_pin=25)')
    ).toEqual([
      { instrument: 'buzzer', pin: '9' },
      { instrument: 'led', pin: '25' }
    ])
  })

  it('ignores a non-numeric pin value (Pin(...) / variable expressions)', () => {
    expect(parseInstrumentPins('inst.start(buzzer_pin=PWM(Pin(15)))')).toEqual([])
    expect(parseInstrumentPins('inst.start(buzzer_pin=PIN)')).toEqual([])
    // A `start(` with no *_pin kwarg at all → no instrument pins.
    expect(parseInstrumentPins('inst.start(i2c=i2c, hz=50)')).toEqual([])
  })

  it('handles multiple start() calls across the source', () => {
    const src = ['a.start(buzzer_pin=1)', 'b.start(led_pin=2)'].join('\n')
    expect(parseInstrumentPins(src)).toEqual([
      { instrument: 'buzzer', pin: '1' },
      { instrument: 'led', pin: '2' }
    ])
  })

  it('detects a *_PIN constant passed to the library by name (the demo pattern)', () => {
    // The demo writes `BUZZER_PIN = 0` then `inst.start(buzzer_pin=BUZZER_PIN)`;
    // the kwarg value is a name (no literal), so the constant carries the pin.
    const src = ['BUZZER_PIN = 0', 'inst.start(buzzer_pin=BUZZER_PIN)'].join('\n')
    expect(parseInstrumentPins(src)).toEqual([{ instrument: 'buzzer', pin: '0' }])
  })

  it('de-dupes the same instrument pin seen in both the constant and the call', () => {
    expect(parseInstrumentPins('LED_PIN = 5\ninst.start(led_pin=5)')).toEqual([
      { instrument: 'led', pin: '5' }
    ])
  })

  it('surfaces a rangefinder TRIG + ECHO via _trig / _echo kwargs', () => {
    expect(parseInstrumentPins('inst.start(range_trig=3, range_echo=2)')).toEqual([
      { instrument: 'range', pin: '3' },
      { instrument: 'range', pin: '2' }
    ])
  })

  it('surfaces UPPERCASE RANGE_TRIG / RANGE_ECHO constants (the demo form)', () => {
    const src = ['RANGE_TRIG = 3', 'RANGE_ECHO = 2', 'inst.start(range_trig=RANGE_TRIG)'].join('\n')
    expect(parseInstrumentPins(src)).toEqual([
      { instrument: 'range', pin: '3' },
      { instrument: 'range', pin: '2' }
    ])
  })

  it('still surfaces single-pin _pin devices (no regression)', () => {
    expect(parseInstrumentPins('inst.start(buzzer_pin=15)')).toEqual([
      { instrument: 'buzzer', pin: '15' }
    ])
  })

  it('surfaces a display SDA + SCL via _sda / _scl kwargs', () => {
    expect(parseInstrumentPins('inst.start(screen_sda=0, screen_scl=1)')).toEqual([
      { instrument: 'screen', pin: '0' },
      { instrument: 'screen', pin: '1' }
    ])
  })

  it('surfaces UPPERCASE SCREEN_SDA / SCREEN_SCL constants (the demo form)', () => {
    const src = ['SCREEN_SDA = 0', 'SCREEN_SCL = 1', 'inst.start(screen_sda=SCREEN_SDA)'].join('\n')
    expect(parseInstrumentPins(src)).toEqual([
      { instrument: 'screen', pin: '0' },
      { instrument: 'screen', pin: '1' }
    ])
  })
})

describe('parsePins — rangefinder instrument pins (board view bonus)', () => {
  it('surfaces a range_trig / range_echo pair as instrument-typed connections', () => {
    const conns = parsePins('import instruments as inst\ninst.start(range_trig=3, range_echo=2)')
    expect(conns.map((c) => c.type)).toEqual(['instrument', 'instrument'])
    expect(conns.map((c) => c.pins[0])).toEqual(['3', '2'])
    expect(conns.every((c) => c.instrument === 'range')).toBe(true)
  })

  it('surfaces a screen_sda / screen_scl pair as instrument-typed connections', () => {
    const conns = parsePins('import instruments as inst\ninst.start(screen_sda=0, screen_scl=1)')
    expect(conns.map((c) => c.type)).toEqual(['instrument', 'instrument'])
    expect(conns.map((c) => c.pins[0])).toEqual(['0', '1'])
    expect(conns.every((c) => c.instrument === 'screen')).toBe(true)
  })
})

describe('parsePins — instrument pins', () => {
  it('surfaces a buzzer_pin as an instrument-typed connection', () => {
    const conns = parsePins('import instruments as inst\ninst.start(buzzer_pin=15)')
    expect(conns).toHaveLength(1)
    expect(conns[0]).toMatchObject({
      type: 'instrument',
      pins: ['15'],
      instrument: 'buzzer'
    })
  })

  it('keeps direct machine pins AND appends instrument pins together', () => {
    const src = [
      'from machine import Pin',
      'import instruments as inst',
      'led = Pin(25, Pin.OUT)',
      'inst.start(buzzer_pin=15)'
    ].join('\n')
    const conns = parsePins(src)
    expect(conns.map((c) => c.type)).toEqual(['output', 'instrument'])
    expect(conns.map((c) => c.pins[0])).toEqual(['25', '15'])
    // The instrument tag rides only on the instrument-owned connection.
    expect(conns[0].instrument).toBeUndefined()
    expect(conns[1].instrument).toBe('buzzer')
  })

  it('does not regress when no instrument call is present', () => {
    const conns = parsePins('servo = PWM(Pin(16))')
    expect(conns).toEqual([
      { type: 'pwm', pins: ['16'], variable: 'servo', constructor: 'PWM(Pin(16))' }
    ])
  })
})
