import { describe, expect, it } from 'vitest'
import { BUILTIN_BOARDS } from '../src/renderer/src/components/board-defs'
import {
  PinEventStream,
  pinStateLabel,
  pinsInCode,
  resolvePin
} from '../src/renderer/src/code-embed/embed-pins'
import { parseEmbedParams } from '../src/renderer/src/code-embed/params'
import { MIN_BOARD_H, PIN_CHIPS_H, preferredHeight } from '../src/renderer/src/code-embed/layout'

const PICO = BUILTIN_BOARDS.find((b) => b.id === 'pico2w')!
const ESP32 = BUILTIN_BOARDS.find((b) => b.ledLabel === '2')!

const PROGRAM = `from machine import Pin, PWM, I2C
from time import sleep

led = Pin(16, Pin.OUT)
i2c = I2C(0, sda=Pin(0), scl=Pin(1))
servo = PWM(Pin(15), freq=50)

while True:
    led.toggle()
    servo.duty_u16(4915)  # led is not used here
    sleep(0.5)
`

describe('resolving a pin against a board (#1318)', () => {
  it('finds a GPIO by number, by label, and the onboard LED', () => {
    expect(resolvePin('15', PICO)).toMatchObject({ id: 'GP15', onBoard: true, led: false })
    expect(resolvePin('gp15', PICO)).toMatchObject({ id: 'GP15', onBoard: true })
    expect(resolvePin(15, PICO)?.padIndex).toBe(resolvePin('GP15', PICO)?.padIndex)
    expect(resolvePin('"LED"', PICO)).toMatchObject({ id: 'LED', led: true, onBoard: true, padIndex: null })
    // A board whose LED is a GPIO number: that number is the LED.
    expect(resolvePin('2', ESP32)).toMatchObject({ id: 'LED', led: true })
  })

  it('says when the board has no such pin, and ignores what is not a pin', () => {
    expect(resolvePin('29', PICO)).toEqual({ id: 'GP29', padIndex: null, led: false, onBoard: false })
    expect(resolvePin('GP99', PICO)).toMatchObject({ id: 'GP99', onBoard: false })
    expect(resolvePin('motor_left', PICO)).toBeNull()
    expect(resolvePin('', PICO)).toBeNull()
  })
})

describe('the pins a program uses (#1318)', () => {
  const found = pinsInCode(PROGRAM, PICO)
  const pin = (id: string) => found.pins.find((p) => p.id === id)!

  it('lists each pin once, in source order, with what it does', () => {
    expect(found.pins.map((p) => [p.id, p.kind, p.variable])).toEqual([
      ['GP16', 'Output', 'led'],
      ['GP0', 'I2C SDA', 'i2c'],
      ['GP1', 'I2C SCL', 'i2c'],
      ['GP15', 'PWM', 'servo']
    ])
    expect(found.problems).toEqual([])
  })

  it('knows the line that sets a pin up and the lines that use its variable', () => {
    expect(pin('GP16').setupLines).toEqual([4])
    expect(pin('GP16').lines).toEqual([4, 9])
    expect(pin('GP15').lines).toEqual([6, 10])
    expect(found.byLine.get(5)).toEqual(['GP0', 'GP1'])
    expect(found.byLine.get(10)).toEqual(['GP15'])
    expect(found.byLine.get(11)).toBeUndefined()
  })

  it('follows a pin handed on through a variable without calling it shared', () => {
    const f = pinsInCode('p = Pin(15)\npwm = PWM(p)\npwm.duty_u16(0)\n', PICO)
    expect(f.pins).toHaveLength(1)
    expect(f.pins[0]).toMatchObject({ id: 'GP15', kind: 'PWM', shared: false, setupLines: [1, 2] })
    expect(f.pins[0].lines).toEqual([1, 2, 3])
    expect(f.problems).toEqual([])
  })

  it('flags a pin the board does not have, at the number', () => {
    const f = pinsInCode('from machine import Pin\nbuzzer = Pin(29, Pin.OUT)\n', PICO)
    expect(f.pins[0]).toMatchObject({ id: 'GP29', onBoard: false })
    expect(f.problems).toEqual([
      { line: 2, startColumn: 14, endColumn: 16, message: `${PICO.name} has no pin GP29.` }
    ])
  })

  it('flags a pin set up by number on two lines', () => {
    const f = pinsInCode('a = Pin(4, Pin.OUT)\nb = Pin(4, Pin.IN)\n', PICO)
    expect(f.pins).toHaveLength(1)
    expect(f.pins[0].shared).toBe(true)
    expect(f.problems).toEqual([{ line: 2, startColumn: 9, endColumn: 10, message: 'GP4 is already set up on line 1.' }])
  })

  it('finds nothing in code with no pins', () => {
    expect(pinsInCode('print("hello")\n', PICO)).toMatchObject({ pins: [], problems: [] })
    expect(pinsInCode('', PICO).pins).toEqual([])
  })
})

describe('pin states out of the simulator output (#1318)', () => {
  const msg = (k: string, pin: string, v: number): string => `\x1b]7373;${k};${pin};${v}\x07`

  it('takes the messages out and leaves the program output', () => {
    const s = new PinEventStream()
    expect(s.push(`hello\r\n${msg('p', '16', 1)}world${msg('w', 'GP15', 4915)}`)).toEqual({
      text: 'hello\r\nworld',
      events: [
        { kind: 'p', pin: '16', value: 1 },
        { kind: 'w', pin: 'GP15', value: 4915 }
      ]
    })
  })

  it('joins a message split across chunks, wherever it is cut', () => {
    const whole = `a${msg('p', 'LED', 0)}b`
    for (let cut = 1; cut < whole.length; cut++) {
      const s = new PinEventStream()
      const one = s.push(whole.slice(0, cut))
      const two = s.push(whole.slice(cut))
      expect(one.text + two.text).toBe('ab')
      expect([...one.events, ...two.events]).toEqual([{ kind: 'p', pin: 'LED', value: 0 }])
    }
  })

  it('lets other escape sequences and stray text through', () => {
    const s = new PinEventStream()
    expect(s.push('\x1b[31mred\x1b[0m').text).toBe('\x1b[31mred\x1b[0m')
    // An unfinished message that never ends is not held for ever.
    const long = '\x1b]7373;' + 'x'.repeat(200)
    expect(s.push(long).text).toBe(long)
  })

  it('words a state', () => {
    expect(pinStateLabel({ kind: 'p', value: 1 })).toBe('on')
    expect(pinStateLabel({ kind: 'p', value: 0 })).toBe('off')
    expect(pinStateLabel({ kind: 'w', value: 32768 })).toBe('PWM 50%')
    expect(pinStateLabel({ kind: 'w', value: 999999 })).toBe('PWM 100%')
  })
})

describe('the embed options for the board strip (#1318)', () => {
  it('reads board= and pins=', () => {
    expect(parseEmbedParams('?code=x')).toMatchObject({ board: null, pins: true })
    expect(parseEmbedParams('?code=x&board=Pico-2-W&pins=0')).toMatchObject({ board: 'pico2w', pins: false })
    expect(parseEmbedParams('?code=x&board=' + encodeURIComponent('<script>')).board).toBeNull()
  })

  it('has no pins for the Pyodide engine', () => {
    expect(parseEmbedParams('?code=x&engine=pyodide').pins).toBe(false)
  })

  it('asks for room for the board beside short code, and for the chips under it', () => {
    const base = { lines: 4, view: 'code' as const, repl: false, plots: false, error: false }
    const plain = preferredHeight(base)
    expect(preferredHeight({ ...base, board: 'side' })).toBeGreaterThanOrEqual(MIN_BOARD_H)
    expect(preferredHeight({ ...base, board: 'chips' })).toBe(plain + PIN_CHIPS_H)
    expect(preferredHeight({ ...base, board: null })).toBe(plain)
    const long = { ...base, lines: 20 }
    expect(preferredHeight({ ...long, board: 'side' })).toBe(preferredHeight(long))
  })
})
