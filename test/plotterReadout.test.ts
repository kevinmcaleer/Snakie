import { describe, it, expect } from 'vitest'
import { estimateHz, formatHz, sampleReadout } from '../src/renderer/src/components/Plotter.readout'

describe('Plotter estimateHz', () => {
  it('returns 0 with fewer than two timestamps', () => {
    expect(estimateHz([])).toBe(0)
    expect(estimateHz([1000])).toBe(0)
  })

  it('returns 0 when no time elapses', () => {
    expect(estimateHz([1000, 1000, 1000])).toBe(0)
  })

  it('derives 10 Hz from 100ms-spaced samples', () => {
    // 11 timestamps, 100ms apart → 10 intervals over 1000ms → 10 Hz.
    const ts = Array.from({ length: 11 }, (_, i) => i * 100)
    expect(estimateHz(ts)).toBeCloseTo(10, 5)
  })

  it('derives 2 Hz from 500ms-spaced samples', () => {
    expect(estimateHz([0, 500, 1000])).toBeCloseTo(2, 5)
  })
})

describe('Plotter formatHz', () => {
  it('shows a dash for non-positive / non-finite rates', () => {
    expect(formatHz(0)).toBe('—')
    expect(formatHz(-3)).toBe('—')
    expect(formatHz(Infinity)).toBe('—')
  })

  it('rounds to a whole number at or above 10 Hz', () => {
    expect(formatHz(10)).toBe('10 Hz')
    expect(formatHz(10.4)).toBe('10 Hz')
    expect(formatHz(59.6)).toBe('60 Hz')
  })

  it('keeps one decimal below 10 Hz', () => {
    expect(formatHz(2)).toBe('2.0 Hz')
    expect(formatHz(4.25)).toBe('4.3 Hz')
  })
})

describe('Plotter sampleReadout', () => {
  it('pluralises the sample count', () => {
    expect(sampleReadout(0, 0)).toBe('0 samples')
    expect(sampleReadout(1, 0)).toBe('1 sample')
    expect(sampleReadout(120, 0)).toBe('120 samples')
  })

  it('appends the rate when known', () => {
    expect(sampleReadout(120, 10)).toBe('120 samples · 10 Hz')
    expect(sampleReadout(50, 2)).toBe('50 samples · 2.0 Hz')
  })
})
