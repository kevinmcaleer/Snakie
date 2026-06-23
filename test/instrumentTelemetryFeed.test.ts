import { describe, it, expect } from 'vitest'
import {
  emptyFeed,
  foldTelemetry,
  matchChannel,
  meterReadingFor,
  scopeSamplesFor,
  SCOPE_BUFFER
} from '../src/renderer/src/components/instrument-telemetry-feed'
import type { Telemetry } from '../src/renderer/src/components/instrument-telemetry'

const scope = (ch: string, value: number): Telemetry => ({ kind: 'scope', ch, value })
const meter = (ch: string, value: number, unit = 'V'): Telemetry => ({
  kind: 'meter',
  ch,
  value,
  unit
})

describe('instrument-telemetry-feed foldTelemetry — scope', () => {
  it('accumulates samples per channel', () => {
    let f = emptyFeed()
    f = foldTelemetry(f, scope('pwm', 0.1))
    f = foldTelemetry(f, scope('pwm', 0.2))
    expect(f.scope.pwm).toEqual([0.1, 0.2])
  })

  it('keeps channels independent', () => {
    let f = emptyFeed()
    f = foldTelemetry(f, scope('a', 1))
    f = foldTelemetry(f, scope('b', 2))
    expect(f.scope.a).toEqual([1])
    expect(f.scope.b).toEqual([2])
  })

  it('caps the ring at SCOPE_BUFFER, dropping the oldest', () => {
    let f = emptyFeed()
    for (let i = 0; i < SCOPE_BUFFER + 5; i++) f = foldTelemetry(f, scope('pwm', i))
    expect(f.scope.pwm).toHaveLength(SCOPE_BUFFER)
    expect(f.scope.pwm[0]).toBe(5) // first five were evicted
    expect(f.scope.pwm[f.scope.pwm.length - 1]).toBe(SCOPE_BUFFER + 4)
  })

  it('returns a new feed reference on a scope fold', () => {
    const f0 = emptyFeed()
    const f1 = foldTelemetry(f0, scope('pwm', 1))
    expect(f1).not.toBe(f0)
  })
})

describe('instrument-telemetry-feed foldTelemetry — meter', () => {
  it('stores the latest reading per channel', () => {
    let f = emptyFeed()
    f = foldTelemetry(f, meter('adc0', 1.0))
    f = foldTelemetry(f, meter('adc0', 1.5))
    expect(f.meter.adc0).toEqual({ value: 1.5, unit: 'V' })
  })

  it('keeps a custom unit', () => {
    const f = foldTelemetry(emptyFeed(), meter('temp', 25, 'C'))
    expect(f.meter.temp).toEqual({ value: 25, unit: 'C' })
  })
})

describe('instrument-telemetry-feed foldTelemetry — ignored input', () => {
  it('ignores plot telemetry (same reference back)', () => {
    const f0 = emptyFeed()
    const f1 = foldTelemetry(f0, { kind: 'plot', series: [{ label: 'x', value: 1 }] })
    expect(f1).toBe(f0)
  })

  it('ignores null (same reference back)', () => {
    const f0 = emptyFeed()
    expect(foldTelemetry(f0, null)).toBe(f0)
  })
})

describe('instrument-telemetry-feed matchChannel', () => {
  it('prefers an exact label match', () => {
    expect(matchChannel('pwm', ['adc0', 'pwm'])).toBe('pwm')
  })

  it('falls back to the sole channel when only one reported', () => {
    expect(matchChannel('myPwm', ['ch1'])).toBe('ch1')
  })

  it('is undefined when ambiguous and no exact match', () => {
    expect(matchChannel('pwm', ['a', 'b'])).toBeUndefined()
  })

  it('is undefined when no channels reported', () => {
    expect(matchChannel('pwm', [])).toBeUndefined()
  })
})

describe('instrument-telemetry-feed selectors', () => {
  it('scopeSamplesFor returns the matched channel samples', () => {
    let f = emptyFeed()
    f = foldTelemetry(f, scope('pwm', 0.5))
    expect(scopeSamplesFor(f, 'pwm')).toEqual([0.5])
  })

  it('scopeSamplesFor falls back to the sole channel', () => {
    const f = foldTelemetry(emptyFeed(), scope('ch1', 0.5))
    expect(scopeSamplesFor(f, 'unrelated')).toEqual([0.5])
  })

  it('scopeSamplesFor is empty when ambiguous', () => {
    let f = emptyFeed()
    f = foldTelemetry(f, scope('a', 1))
    f = foldTelemetry(f, scope('b', 2))
    expect(scopeSamplesFor(f, 'pwm')).toEqual([])
  })

  it('meterReadingFor returns the matched channel reading', () => {
    const f = foldTelemetry(emptyFeed(), meter('adc0', 1.65))
    expect(meterReadingFor(f, 'adc0')).toEqual({ value: 1.65, unit: 'V' })
  })

  it('meterReadingFor falls back to the sole channel', () => {
    const f = foldTelemetry(emptyFeed(), meter('adc0', 1.65))
    expect(meterReadingFor(f, 'whatever')).toEqual({ value: 1.65, unit: 'V' })
  })

  it('meterReadingFor is undefined when no telemetry', () => {
    expect(meterReadingFor(emptyFeed(), 'adc0')).toBeUndefined()
  })
})
