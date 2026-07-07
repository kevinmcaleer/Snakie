import { describe, it, expect } from 'vitest'
import {
  histogram,
  median,
  gapPercent,
  profileColumn,
  type NumericProfile,
  type TextProfile
} from '../src/renderer/src/components/data-view-profile'

describe('histogram (#276)', () => {
  it('buckets values into equal-width bins; max lands in the last bin', () => {
    const { bins, binEdges } = histogram([0, 1, 2, 3, 4], 0, 4, 4)
    expect(bins).toHaveLength(4)
    expect(binEdges).toEqual([0, 1, 2, 3, 4])
    // 0→b0, 1→b1, 2→b2, 3→b3, 4→last bin (b3)
    expect(bins).toEqual([1, 1, 1, 2])
    expect(bins.reduce((a, b) => a + b, 0)).toBe(5)
  })
  it('a zero-span column puts everything in one bin', () => {
    const { bins } = histogram([7, 7, 7], 7, 7, 8)
    expect(bins[0]).toBe(3)
    expect(bins.slice(1).every((b) => b === 0)).toBe(true)
  })
})

describe('median (#276)', () => {
  it('odd + even lengths, unsorted input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('profileColumn (#276)', () => {
  const rows = [
    ['10', 'ok'],
    ['20', 'ok'],
    ['', 'warm'], // null number
    ['30', 'cool'],
    ['40', 'ok']
  ]

  it('numeric: stats + histogram + null count over the visible set', () => {
    const p = profileColumn(rows, 0, 'number', [0, 1, 2, 3, 4], 4) as NumericProfile
    expect(p.kind).toBe('number')
    expect(p.count).toBe(4)
    expect(p.nulls).toBe(1)
    expect(p.min).toBe(10)
    expect(p.max).toBe(40)
    expect(p.mean).toBeCloseTo(25)
    expect(p.median).toBeCloseTo(25)
    expect(p.bins.reduce((a, b) => a + b, 0)).toBe(4) // every non-null value binned
  })

  it('recomputes for a filtered subset only', () => {
    const p = profileColumn(rows, 0, 'number', [0, 1], 4) as NumericProfile
    expect(p.count).toBe(2)
    expect(p.max).toBe(20)
    expect(p.nulls).toBe(0)
  })

  it('text: top values by frequency (desc) + distinct + nulls', () => {
    const p = profileColumn(rows, 1, 'string', [0, 1, 2, 3, 4]) as TextProfile
    expect(p.kind).toBe('string')
    expect(p.distinct).toBe(3) // ok, warm, cool
    expect(p.top[0]).toEqual({ value: 'ok', count: 3 })
    expect(p.count).toBe(5)
    expect(p.nulls).toBe(0)
  })

  it('gapPercent reflects the dropped readings', () => {
    const p = profileColumn(rows, 0, 'number', [0, 1, 2, 3, 4]) // 1 null of 5
    expect(gapPercent(p)).toBeCloseTo(20)
  })

  it('an all-null numeric column → count 0, empty histogram', () => {
    const p = profileColumn([['']], 0, 'number', [0]) as NumericProfile
    expect(p.count).toBe(0)
    expect(p.nulls).toBe(1)
    expect(p.bins).toEqual([])
    expect(gapPercent(p)).toBe(100)
  })

  it('timestamps profile like numbers (row-count-over-time buckets)', () => {
    const ts = [['2026-01-01'], ['2026-02-01'], ['2026-03-01'], ['2026-04-01']]
    const p = profileColumn(ts, 0, 'timestamp', [0, 1, 2, 3], 4) as NumericProfile
    expect(p.kind).toBe('timestamp')
    expect(p.count).toBe(4)
    expect(p.bins.reduce((a, b) => a + b, 0)).toBe(4)
  })
})
