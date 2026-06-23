import { describe, it, expect } from 'vitest'
import {
  isTelemetry,
  parseTelemetry,
  TELEMETRY_SENTINEL
} from '../src/renderer/src/components/instrument-telemetry'

describe('instrument-telemetry isTelemetry', () => {
  it('detects a SNK-prefixed line', () => {
    expect(isTelemetry('SNK SCOPE pwm 0.5')).toBe(true)
  })

  it('tolerates leading whitespace', () => {
    expect(isTelemetry('   SNK METER adc0 1.65 V')).toBe(true)
  })

  it('accepts a bare sentinel token', () => {
    expect(isTelemetry('SNK')).toBe(true)
  })

  it('rejects a plain print line', () => {
    expect(isTelemetry('temp:21.4')).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(isTelemetry('')).toBe(false)
  })

  it('does not match an embedded SNK later in the line', () => {
    expect(isTelemetry('value is SNK SCOPE')).toBe(false)
  })

  it('exposes the sentinel constant', () => {
    expect(TELEMETRY_SENTINEL).toBe('SNK')
  })
})

describe('instrument-telemetry parseTelemetry — SCOPE', () => {
  it('parses a scope sample', () => {
    expect(parseTelemetry('SNK SCOPE pwm 0.75')).toEqual({
      kind: 'scope',
      ch: 'pwm',
      value: 0.75
    })
  })

  it('parses an integer scope value', () => {
    expect(parseTelemetry('SNK SCOPE ch1 3')).toEqual({
      kind: 'scope',
      ch: 'ch1',
      value: 3
    })
  })

  it('parses a negative scope value', () => {
    expect(parseTelemetry('SNK SCOPE sig -1.5')).toEqual({
      kind: 'scope',
      ch: 'sig',
      value: -1.5
    })
  })

  it('returns null when the scope value is missing', () => {
    expect(parseTelemetry('SNK SCOPE pwm')).toBeNull()
  })

  it('returns null when the scope value is non-numeric', () => {
    expect(parseTelemetry('SNK SCOPE pwm high')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — METER', () => {
  it('parses a meter reading with an explicit unit', () => {
    expect(parseTelemetry('SNK METER adc0 1.65 V')).toEqual({
      kind: 'meter',
      ch: 'adc0',
      value: 1.65,
      unit: 'V'
    })
  })

  it('defaults the unit to V when omitted', () => {
    expect(parseTelemetry('SNK METER adc0 3.3')).toEqual({
      kind: 'meter',
      ch: 'adc0',
      value: 3.3,
      unit: 'V'
    })
  })

  it('keeps a custom unit', () => {
    expect(parseTelemetry('SNK METER temp 25.0 C')).toEqual({
      kind: 'meter',
      ch: 'temp',
      value: 25,
      unit: 'C'
    })
  })

  it('returns null when the meter value is non-numeric', () => {
    expect(parseTelemetry('SNK METER adc0 nope V')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — PLOT', () => {
  it('parses bare numbers into positional series', () => {
    expect(parseTelemetry('SNK PLOT 1 2 3')).toEqual({
      kind: 'plot',
      series: [
        { label: 'series 1', value: 1 },
        { label: 'series 2', value: 2 },
        { label: 'series 3', value: 3 }
      ]
    })
  })

  it('parses named series (name=value)', () => {
    expect(parseTelemetry('SNK PLOT temp=21.4 light=80')).toEqual({
      kind: 'plot',
      series: [
        { label: 'temp', value: 21.4 },
        { label: 'light', value: 80 }
      ]
    })
  })

  it('parses name:value pairs', () => {
    expect(parseTelemetry('SNK PLOT x:1 y:2')).toEqual({
      kind: 'plot',
      series: [
        { label: 'x', value: 1 },
        { label: 'y', value: 2 }
      ]
    })
  })

  it('mixes bare and named tokens with positional fallback labels', () => {
    expect(parseTelemetry('SNK PLOT 5 x=1 6')).toEqual({
      kind: 'plot',
      series: [
        { label: 'series 1', value: 5 },
        { label: 'x', value: 1 },
        { label: 'series 2', value: 6 }
      ]
    })
  })

  it('returns null for an empty PLOT payload', () => {
    expect(parseTelemetry('SNK PLOT')).toBeNull()
  })

  it('returns null when no token has a parsable number', () => {
    expect(parseTelemetry('SNK PLOT hello world')).toBeNull()
  })
})

describe('instrument-telemetry parseTelemetry — non-telemetry / unknown', () => {
  it('returns null for a plain numeric print', () => {
    expect(parseTelemetry('12.5')).toBeNull()
  })

  it('returns null for a labelled print without the sentinel', () => {
    expect(parseTelemetry('temp:21.4, humidity:48')).toBeNull()
  })

  it('returns null for an empty line', () => {
    expect(parseTelemetry('')).toBeNull()
  })

  it('returns null for an unknown SNK sub-command', () => {
    expect(parseTelemetry('SNK WOBBLE 1 2')).toBeNull()
  })

  it('returns null for a bare sentinel with no sub-command', () => {
    expect(parseTelemetry('SNK')).toBeNull()
  })
})
