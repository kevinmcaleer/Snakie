import { describe, it, expect } from 'vitest'
import {
  adcChannel,
  adcFromU16,
  ADC_MAX_RAW,
  ADC_VREF,
  emptyStats,
  foldStat,
  formatDuty,
  formatFreq,
  formatPeriod,
  pwmConfig,
  sampleWavePath,
  squareWavePath
} from '../src/renderer/src/components/instrument-data'

describe('pwmConfig', () => {
  it('returns empty for no source', () => {
    expect(pwmConfig('')).toEqual({})
  })

  it('reads freq= and duty_u16= kwargs from a constructor', () => {
    expect(pwmConfig('PWM(Pin(0), freq=1000, duty_u16=32768)')).toEqual({
      freq: 1000,
      duty: 32768 / 65535
    })
  })

  it('reads a duty_u16(...) setter call', () => {
    const cfg = pwmConfig('pwm = PWM(Pin(0), freq=2000)\npwm.duty_u16(16384)')
    expect(cfg.freq).toBe(2000)
    expect(cfg.duty).toBeCloseTo(16384 / 65535, 6)
  })

  it('reads a .freq(...) setter call when no kwarg is present', () => {
    expect(pwmConfig('pwm = PWM(Pin(0))\npwm.freq(500)').freq).toBe(500)
  })

  it('reads freq_hz= as an alias for freq=', () => {
    expect(pwmConfig('PWM(Pin(0), freq_hz=440)').freq).toBe(440)
  })

  it('scales a legacy duty() 10-bit value', () => {
    // duty() is 0..1023 → 511/1023 ≈ 0.5
    expect(pwmConfig('p = PWM(Pin(0))\np.duty(511)').duty).toBeCloseTo(0.4995, 3)
  })

  it('derives duty from duty_ns when freq is known', () => {
    // 1 kHz → 1_000_000 ns period; 500_000 ns high → 50%.
    const cfg = pwmConfig('PWM(Pin(0), freq=1000, duty_ns=500000)')
    expect(cfg.duty).toBeCloseTo(0.5, 6)
  })

  it('ignores duty_ns when freq is unknown (cannot derive a fraction)', () => {
    expect(pwmConfig('PWM(Pin(0), duty_ns=500000)').duty).toBeUndefined()
  })

  it('clamps an over-range duty into [0,1]', () => {
    expect(pwmConfig('PWM(Pin(0), duty_u16=99999)').duty).toBe(1)
  })
})

describe('adcChannel', () => {
  it('maps GP26/27/28 to ADC0/1/2', () => {
    expect(adcChannel('26')).toBe('ADC0')
    expect(adcChannel('27')).toBe('ADC1')
    expect(adcChannel('28')).toBe('ADC2')
  })
  it('accepts GP-prefixed labels', () => {
    expect(adcChannel('GP26')).toBe('ADC0')
    expect(adcChannel('gp28')).toBe('ADC2')
  })
  it('returns undefined for non-analog or missing pins', () => {
    expect(adcChannel('25')).toBeUndefined()
    expect(adcChannel('LED')).toBeUndefined()
    expect(adcChannel(undefined)).toBeUndefined()
  })
})

describe('adcFromU16', () => {
  it('converts a 16-bit reading to volts + 12-bit raw', () => {
    const half = adcFromU16(32768)
    expect(half.volts).toBeCloseTo(1.65, 2)
    expect(half.raw).toBe(2048)
  })
  it('handles 0 and full-scale', () => {
    expect(adcFromU16(0)).toEqual({ raw: 0, volts: 0 })
    const full = adcFromU16(65535)
    expect(full.raw).toBe(ADC_MAX_RAW)
    expect(full.volts).toBeCloseTo(ADC_VREF, 5)
  })
  it('clamps out-of-range input', () => {
    expect(adcFromU16(-5)).toEqual({ raw: 0, volts: 0 })
    expect(adcFromU16(99999).raw).toBe(ADC_MAX_RAW)
  })
})

describe('foldStat', () => {
  it('seeds from the first sample', () => {
    expect(foldStat(emptyStats(), 1.5)).toEqual({ min: 1.5, max: 1.5, avg: 1.5, count: 1 })
  })
  it('tracks running min/max/avg', () => {
    let s = emptyStats()
    for (const v of [1, 2, 3]) s = foldStat(s, v)
    expect(s.min).toBe(1)
    expect(s.max).toBe(3)
    expect(s.avg).toBeCloseTo(2, 6)
    expect(s.count).toBe(3)
  })
  it('ignores non-finite samples', () => {
    const s = foldStat(emptyStats(), 2)
    expect(foldStat(s, NaN)).toBe(s)
  })
})

describe('squareWavePath', () => {
  it('draws edges for a 50% duty wave', () => {
    const d = squareWavePath({ width: 100, height: 100, duty: 0.5, cycles: 1, padY: 20 })
    // Starts high at x=0, falls at x=50, ends low at x=100. No trailing rise.
    expect(d.startsWith('M0 20')).toBe(true)
    expect(d).toContain('L50 20')
    expect(d).toContain('L50 80')
    expect(d).toContain('L100 80')
    expect(d.endsWith('L100 20')).toBe(false)
  })
  it('flattens to the low rail at 0% duty', () => {
    expect(squareWavePath({ width: 80, height: 60, duty: 0, cycles: 4, padY: 10 })).toBe('M0 50 L80 50')
  })
  it('flattens to the high rail at 100% duty', () => {
    expect(squareWavePath({ width: 80, height: 60, duty: 1, cycles: 4, padY: 10 })).toBe('M0 10 L80 10')
  })
  it('repeats edges across multiple cycles', () => {
    const d = squareWavePath({ width: 100, height: 100, duty: 0.5, cycles: 2, padY: 20 })
    // Two periods of 50px each: falls at 25 and 75; rises once mid-way at 50.
    expect(d).toContain('L25 20')
    expect(d).toContain('L50 20') // the inter-cycle rising edge
    expect(d).toContain('L75 20')
  })
})

describe('sampleWavePath', () => {
  it('returns empty string for no samples', () => {
    expect(sampleWavePath({ width: 100, height: 100, samples: [] })).toBe('')
  })

  it('maps samples left to right, auto-scaling min→bottom and max→top', () => {
    // 3 samples [0,1,2] over width 100, padY 10, height 100 → usable rows 10..90.
    // min(0)→y90, max(2)→y10, mid(1)→y50. xStep = 100/2 = 50.
    const d = sampleWavePath({ width: 100, height: 100, samples: [0, 1, 2], padY: 10 })
    expect(d).toBe('M0 90 L50 50 L100 10')
  })

  it('centres a flat series (no divide-by-zero)', () => {
    // All equal → a centred horizontal line at yTop + usable/2 = 10 + 80/2 = 50.
    const d = sampleWavePath({ width: 100, height: 100, samples: [5, 5, 5], padY: 10 })
    expect(d).toBe('M0 50 L50 50 L100 50')
  })

  it('starts the path with a single M for a one-sample series', () => {
    expect(sampleWavePath({ width: 100, height: 100, samples: [1], padY: 10 })).toBe('M0 50')
  })

  it('returns empty when every sample is non-finite', () => {
    expect(sampleWavePath({ width: 100, height: 100, samples: [NaN, Infinity] })).toBe('')
  })
})

describe('format helpers', () => {
  it('formats frequency with SI prefixes', () => {
    expect(formatFreq(1000)).toBe('1.00 kHz')
    expect(formatFreq(50)).toBe('50.0 Hz')
    expect(formatFreq(2_000_000)).toBe('2.00 MHz')
    expect(formatFreq(undefined)).toBe('—')
    expect(formatFreq(0)).toBe('—')
  })
  it('formats the period (reciprocal of freq)', () => {
    expect(formatPeriod(1000)).toBe('1.00 ms')
    expect(formatPeriod(50)).toBe('20.0 ms')
    expect(formatPeriod(1_000_000)).toBe('1.00 µs')
    expect(formatPeriod(undefined)).toBe('—')
  })
  it('formats duty as a percentage', () => {
    expect(formatDuty(0.5)).toBe('50.0 %')
    expect(formatDuty(0.25)).toBe('25.0 %')
    expect(formatDuty(undefined)).toBe('—')
  })
})
