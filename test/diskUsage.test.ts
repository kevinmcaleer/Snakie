import { describe, it, expect } from 'vitest'
import { formatBytes, usageLabel, usedPct } from '../src/renderer/src/components/disk-usage'

describe('usedPct', () => {
  it('computes used/total as a rounded percentage', () => {
    expect(usedPct({ total: 1000, free: 250, used: 750 })).toBe(75)
    expect(usedPct({ total: 2_000_000, free: 2_000_000, used: 0 })).toBe(0)
    expect(usedPct({ total: 100, free: 0, used: 100 })).toBe(100)
  })
  it('is 0 for a missing / zero-total df (clamped, never throws)', () => {
    expect(usedPct(null)).toBe(0)
    expect(usedPct(undefined)).toBe(0)
    expect(usedPct({ total: 0, free: 0, used: 0 })).toBe(0)
  })
})

describe('formatBytes', () => {
  it('picks B / KB / MB (1024-based)', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(120 * 1024)).toBe('120 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
  it('is a dash for a bad size', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })
})

describe('usageLabel', () => {
  it('renders "used / total"', () => {
    expect(usageLabel({ total: 1_400_000, free: 1_280_000, used: 120_000 })).toBe('117 KB / 1.3 MB')
  })
  it('is empty for a missing df', () => {
    expect(usageLabel(null)).toBe('')
  })
})
