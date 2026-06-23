import { describe, it, expect } from 'vitest'
import {
  emptyButtonMap,
  applyButtonReading,
  buttonList,
  lastButton,
  totalEdges,
  buttonCount,
  type ButtonMap
} from '../src/renderer/src/components/button-logic'
import {
  LED_TARGET,
  digitalPayload,
  pwmPayload,
  rgbPayload,
  stripPayload,
  animPayload,
  formatLevel,
  hexToRgb,
  rgbToHex
} from '../src/renderer/src/components/led-logic'
import { buildControlLine } from '../src/renderer/src/components/snakie-control'

// =============================================================================
// button-logic — the rising-edge reducer behind the Button (READ) panel.
// =============================================================================

describe('button-logic applyButtonReading', () => {
  it('initialises a never-seen button (released first sight, 0 edges)', () => {
    const map = applyButtonReading(emptyButtonMap(), { name: 'a', pressed: false })
    expect(map.a).toEqual({ name: 'a', pressed: false, edgeCount: 0, lastSeq: 1 })
  })

  it('counts one edge when a button is already pressed at first sight (held)', () => {
    const map = applyButtonReading(emptyButtonMap(), { name: 'a', pressed: true })
    expect(map.a.pressed).toBe(true)
    expect(map.a.edgeCount).toBe(1)
  })

  it('counts a RISING edge on a released → pressed transition', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true })
    expect(map.a.pressed).toBe(true)
    expect(map.a.edgeCount).toBe(1)
  })

  it('does NOT count a falling edge (pressed → released)', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: true }) // edge 1 (held first sight)
    map = applyButtonReading(map, { name: 'a', pressed: false }) // release: no edge
    expect(map.a.pressed).toBe(false)
    expect(map.a.edgeCount).toBe(1)
  })

  it('does NOT count a repeated pressed reading', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // edge 1
    map = applyButtonReading(map, { name: 'a', pressed: true }) // repeat: no edge
    map = applyButtonReading(map, { name: 'a', pressed: true }) // repeat: no edge
    expect(map.a.edgeCount).toBe(1)
  })

  it('counts a full press/release/press cycle as two edges', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // edge 1
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // edge 2
    expect(map.a.edgeCount).toBe(2)
  })

  it('tracks multiple buttons independently', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'b', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // a: edge 1
    map = applyButtonReading(map, { name: 'b', pressed: true }) // b: edge 1
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // a: edge 2
    expect(map.a.edgeCount).toBe(2)
    expect(map.b.edgeCount).toBe(1)
    expect(buttonCount(map)).toBe(2)
    expect(totalEdges(map)).toBe(3)
  })

  it('does not mutate the input map or slot', () => {
    const before = applyButtonReading(emptyButtonMap(), { name: 'a', pressed: false })
    const snapshot = { ...before.a }
    const after = applyButtonReading(before, { name: 'a', pressed: true })
    expect(before.a).toEqual(snapshot) // original slot untouched
    expect(after).not.toBe(before) // new map object
    expect(after.a).not.toBe(before.a) // new slot object
  })

  it('orders buttonList by most-recently-updated first; lastButton picks it', () => {
    let map: ButtonMap = emptyButtonMap()
    map = applyButtonReading(map, { name: 'a', pressed: false })
    map = applyButtonReading(map, { name: 'b', pressed: false })
    map = applyButtonReading(map, { name: 'a', pressed: true }) // a updated last
    expect(buttonList(map).map((s) => s.name)).toEqual(['a', 'b'])
    expect(lastButton(map)).toBe('a')
  })

  it('lastButton is undefined for an empty map', () => {
    expect(lastButton(emptyButtonMap())).toBeUndefined()
  })
})

// =============================================================================
// led-logic — the payload builders behind the LED (WRITE) panel. These must
// match the on-device `Led` receiver grammar in micropython/instruments.py.
// =============================================================================

describe('led-logic digital/pwm/rgb payloads (match the device Led grammar)', () => {
  it('builds the bare on/off digital payload (Led.set)', () => {
    expect(digitalPayload(true)).toBe('on')
    expect(digitalPayload(false)).toBe('off')
  })

  it('round-trips the digital payload into the canonical wire line', () => {
    // Matches docs/instruments-library.md: `SNKCMD led on`
    expect(buildControlLine(LED_TARGET, digitalPayload(true))).toBe('SNKCMD led on\n')
    expect(buildControlLine(LED_TARGET, digitalPayload(false))).toBe('SNKCMD led off\n')
  })

  it('builds the pwm payload, clamping the level to 0..1 (Led.pwm)', () => {
    expect(pwmPayload(0.5)).toBe('pwm 0.5')
    expect(pwmPayload(0)).toBe('pwm 0')
    expect(pwmPayload(1)).toBe('pwm 1')
    expect(pwmPayload(1.5)).toBe('pwm 1') // clamped high
    expect(pwmPayload(-0.2)).toBe('pwm 0') // clamped low
  })

  it('round-trips the pwm payload into the canonical wire line', () => {
    // Matches the docs/test canonical example: `SNKCMD led pwm 0.5`
    expect(buildControlLine(LED_TARGET, pwmPayload(0.5))).toBe('SNKCMD led pwm 0.5\n')
  })

  it('builds the rgb payload with rounded, clamped 0..255 channels (Led.rgb)', () => {
    expect(rgbPayload({ r: 255, g: 107, b: 94 })).toBe('rgb 255 107 94')
    expect(rgbPayload({ r: 0, g: 0, b: 0 })).toBe('rgb 0 0 0')
    expect(rgbPayload({ r: 300, g: -5, b: 127.6 })).toBe('rgb 255 0 128') // clamp + round
  })
})

describe('led-logic formatLevel', () => {
  it('clamps and trims trailing zeros', () => {
    expect(formatLevel(0.5)).toBe('0.5')
    expect(formatLevel(0.25)).toBe('0.25')
    expect(formatLevel(1)).toBe('1')
    expect(formatLevel(0)).toBe('0')
    expect(formatLevel(2)).toBe('1')
    expect(formatLevel(-1)).toBe('0')
    expect(formatLevel(0.3334)).toBe('0.333') // 3dp
  })
})

describe('led-logic hex <-> rgb conversion', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgb('#ff6b5e')).toEqual({ r: 255, g: 107, b: 94 })
  })

  it('parses an un-hashed and a 3-digit shorthand hex', () => {
    expect(hexToRgb('ff6b5e')).toEqual({ r: 255, g: 107, b: 94 })
    expect(hexToRgb('#0af')).toEqual({ r: 0, g: 170, b: 255 })
  })

  it('falls back to black for garbage input', () => {
    expect(hexToRgb('not-a-color')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('formats rgb back to #rrggbb (clamped, zero-padded)', () => {
    expect(rgbToHex({ r: 255, g: 107, b: 94 })).toBe('#ff6b5e')
    expect(rgbToHex({ r: 0, g: 10, b: 255 })).toBe('#000aff')
    expect(rgbToHex({ r: 300, g: -5, b: 16 })).toBe('#ff0010')
  })

  it('round-trips an in-range full-form colour', () => {
    expect(rgbToHex(hexToRgb('#1a2b3c'))).toBe('#1a2b3c')
  })
})

describe('led-logic strip + anim serialization', () => {
  it('serialises per-pixel colours as normalised #rrggbb tokens', () => {
    expect(stripPayload(['#ff0000', '#00ff00', '#0000ff'])).toBe('strip #ff0000 #00ff00 #0000ff')
  })

  it('normalises shorthand / un-hashed pixels through hex round-trip', () => {
    expect(stripPayload(['f00', '0F0'])).toBe('strip #ff0000 #00ff00')
  })

  it('yields a bare strip command for an empty pixel list', () => {
    expect(stripPayload([])).toBe('strip')
  })

  it('round-trips a strip payload into a wire line', () => {
    expect(buildControlLine(LED_TARGET, stripPayload(['#ff0000']))).toBe('SNKCMD led strip #ff0000\n')
  })

  it('builds an anim payload (name only)', () => {
    expect(animPayload('rainbow')).toBe('anim rainbow')
  })

  it('hyphen-joins a multi-word anim name and appends args', () => {
    expect(animPayload('color wipe', [50, '#ff0000'])).toBe('anim color-wipe 50 #ff0000')
  })

  it('defaults a blank anim name to off', () => {
    expect(animPayload('  ')).toBe('anim off')
  })

  it('round-trips an anim payload into a wire line', () => {
    expect(buildControlLine(LED_TARGET, animPayload('chase'))).toBe('SNKCMD led anim chase\n')
  })

  it('exposes the led control target', () => {
    expect(LED_TARGET).toBe('led')
  })
})
