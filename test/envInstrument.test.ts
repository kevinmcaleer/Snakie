import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'
import {
  clampPressure,
  dialPoint,
  pressureAngle,
  weatherWord,
  clampTemp,
  tempFraction,
  clampHumidity,
  humidityAngle,
  humidityWord,
  describeArc,
  PRESS_MIN,
  PRESS_MAX,
  TEMP_MIN,
  TEMP_MAX
} from '../src/renderer/src/components/env-logic'
import { EnvInstrument } from '../src/renderer/src/components/EnvInstrument'
import { INSTRUMENTS, instrumentById } from '../src/renderer/src/components/instruments-registry'

describe('SNK ENV telemetry (#216)', () => {
  it('parses temp / pressure / humidity with the channel', () => {
    expect(parseTelemetry('SNK ENV env 21.5 1013.2 45.0')).toEqual({
      kind: 'env',
      ch: 'env',
      temp: 21.5,
      pressure: 1013.2,
      humidity: 45.0
    })
    expect(parseTelemetry('SNK ENV attic 20 990 60')).toMatchObject({ ch: 'attic', pressure: 990 })
  })
  it('rejects malformed ENV lines', () => {
    expect(parseTelemetry('SNK ENV env 21.5 1013.2')).toBeNull() // missing humidity
    expect(parseTelemetry('SNK ENV env x y z')).toBeNull()
  })
})

describe('barometer dial geometry (#216)', () => {
  it('maps the printed range across the 270° sweep', () => {
    expect(pressureAngle(PRESS_MIN)).toBe(-135)
    expect(pressureAngle(1000)).toBe(0) // straight up = CHANGE
    expect(pressureAngle(PRESS_MAX)).toBe(135)
  })
  it('clamps out-of-range + non-finite pressure', () => {
    expect(clampPressure(0)).toBe(PRESS_MIN)
    expect(clampPressure(2000)).toBe(PRESS_MAX)
    expect(clampPressure(Number.NaN)).toBe(PRESS_MIN)
    expect(pressureAngle(900)).toBe(-135)
  })
  it('dialPoint: 0° is straight up, 90° is right', () => {
    const up = dialPoint(0, 100, 88, 74)
    expect(up.x).toBeCloseTo(100)
    expect(up.y).toBeCloseTo(14)
    const right = dialPoint(90, 100, 88, 74)
    expect(right.x).toBeCloseTo(174)
    expect(right.y).toBeCloseTo(88)
  })
  it('prints the antique legend', () => {
    expect(weatherWord(960)).toBe('RAIN')
    expect(weatherWord(1000)).toBe('CHANGE')
    expect(weatherWord(1030)).toBe('FAIR')
  })
})

describe('thermometer geometry (#216)', () => {
  it('fills 0 at the bulb (min) and 1 at the top (max), clamped', () => {
    expect(tempFraction(TEMP_MIN)).toBe(0)
    expect(tempFraction(TEMP_MAX)).toBe(1)
    expect(tempFraction((TEMP_MIN + TEMP_MAX) / 2)).toBeCloseTo(0.5)
    expect(tempFraction(999)).toBe(1) // clamped
    expect(tempFraction(Number.NaN)).toBe(0)
  })
  it('clampTemp holds the printed range', () => {
    expect(clampTemp(-100)).toBe(TEMP_MIN)
    expect(clampTemp(100)).toBe(TEMP_MAX)
    expect(clampTemp(21.5)).toBe(21.5)
  })
})

describe('hygrometer geometry (#216)', () => {
  it('sweeps 0..100 % across the same 270° as the barometer', () => {
    expect(humidityAngle(0)).toBe(-135)
    expect(humidityAngle(50)).toBe(0)
    expect(humidityAngle(100)).toBe(135)
    expect(humidityAngle(200)).toBe(135) // clamped
  })
  it('names the blue/red extremes', () => {
    expect(humidityWord(10)).toBe('DRY')
    expect(humidityWord(50)).toBe('NORMAL')
    expect(humidityWord(90)).toBe('DAMP')
  })
  it('clampHumidity holds 0..100', () => {
    expect(clampHumidity(-5)).toBe(0)
    expect(clampHumidity(150)).toBe(100)
    expect(clampHumidity(Number.NaN)).toBe(0)
  })
  it('describeArc emits a single-radius SVG arc between two angles', () => {
    const d = describeArc(46, 44, 30, humidityAngle(0), humidityAngle(30))
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+ A 30 30 0 [01] [01] [\d.-]+ [\d.-]+$/)
  })
})

describe('EnvInstrument render (#216)', () => {
  const def = instrumentById('env')!
  it('registers the env singleton with BME-ish hints', () => {
    expect(def.kind).toBe('singleton')
    expect(def.group).toBe('input')
    expect(def.hints).toContain('bme280')
    expect(INSTRUMENTS.filter((d) => d.id === 'env')).toHaveLength(1)
  })
  it('draws the aneroid face: bezel, dial, legend, needle + no-data readouts', () => {
    const html = renderToStaticMarkup(createElement(EnvInstrument, { def, docked: true }))
    expect(html).toContain('envbaro__bezel')
    expect(html).toContain('envbaro__dial')
    expect(html).toContain('envbaro__needle')
    expect(html).toContain('RAIN')
    expect(html).toContain('CHANGE')
    expect(html).toContain('FAIR')
    // Major scale numbers 950..1050.
    expect(html).toContain('>950<')
    expect(html).toContain('>1050<')
    // No data yet → dashes in the cells.
    expect(html).toContain('TEMP')
    expect(html).toContain('HUMIDITY')
    expect(html).toContain('——')
  })
  it('draws the thermometer (glass tube, mercury, °C scale)', () => {
    const html = renderToStaticMarkup(createElement(EnvInstrument, { def, docked: true }))
    expect(html).toContain('envtherm__glass')
    expect(html).toContain('envtherm__hg')
    expect(html).toContain('°C')
  })
  it('draws the hygrometer with blue-dry / red-damp extremes', () => {
    const html = renderToStaticMarkup(createElement(EnvInstrument, { def, docked: true }))
    expect(html).toContain('envhygro__dial')
    expect(html).toContain('envhygro__arc--dry')
    expect(html).toContain('envhygro__arc--damp')
    expect(html).toContain('DRY')
    expect(html).toContain('DAMP')
  })
})
