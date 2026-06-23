import { describe, it, expect } from 'vitest'
import {
  blipOpacity,
  classifyProximity,
  clampRange,
  cmToMm,
  convertUnit,
  DEFAULT_MAX_MM,
  formatRange,
  historyPath,
  HISTORY_CAP,
  isNoEcho,
  mmToCm,
  polarToPoint,
  pushBlip,
  pushHistory,
  SWEEP_TRAIL,
  type RadarBlip
} from '../src/renderer/src/components/range-logic'
import { parseDistance } from '../src/renderer/src/components/range-telemetry'

// A small fixed geometry: a 200×100 viewBox with no padding, so a max-range
// reading lands exactly on the dome rim (radius = min(100, 100) = 100).
const GEOM = { width: 200, height: 100, maxMm: 1000, pad: 0 }

describe('isNoEcho (out-of-range / no-echo detection)', () => {
  it('treats 0 mm as no echo', () => {
    expect(isNoEcho(0)).toBe(true)
  })
  it('treats a negative / non-finite reading as no echo', () => {
    expect(isNoEcho(-5)).toBe(true)
    expect(isNoEcho(NaN)).toBe(true)
    expect(isNoEcho(Infinity)).toBe(true)
  })
  it('treats a beyond-max reading as no echo when maxMm is given', () => {
    expect(isNoEcho(5000, 2000)).toBe(true)
  })
  it('accepts an in-range positive reading', () => {
    expect(isNoEcho(500, 2000)).toBe(false)
    expect(isNoEcho(500)).toBe(false)
  })
})

describe('clampRange', () => {
  it('clamps over-range to the cap and floors invalids to 0', () => {
    expect(clampRange(5000, 2000)).toBe(2000)
    expect(clampRange(-1, 2000)).toBe(0)
    expect(clampRange(NaN, 2000)).toBe(0)
  })
  it('passes an in-range value through', () => {
    expect(clampRange(750, 2000)).toBe(750)
  })
  it('falls back to DEFAULT_MAX_MM for a bad cap', () => {
    expect(clampRange(99999, 0)).toBe(DEFAULT_MAX_MM)
  })
})

describe('mm ↔ cm conversion', () => {
  it('converts mm → cm and back', () => {
    expect(mmToCm(1234)).toBe(123.4)
    expect(cmToMm(12.3)).toBeCloseTo(123, 6)
  })
  it('convertUnit honours the chosen unit', () => {
    expect(convertUnit(1500, 'mm')).toBe(1500)
    expect(convertUnit(1500, 'cm')).toBe(150)
  })
})

describe('formatRange', () => {
  it('formats mm as whole, cm to 1dp', () => {
    expect(formatRange(1234, 'mm')).toBe('1234 mm')
    expect(formatRange(1234, 'cm')).toBe('123.4 cm')
  })
  it('rounds mm to a whole number', () => {
    expect(formatRange(1234.7, 'mm')).toBe('1235 mm')
  })
  it('renders NO ECHO for an out-of-range / zero reading', () => {
    expect(formatRange(0, 'cm')).toBe('NO ECHO')
    expect(formatRange(5000, 'cm', 2000)).toBe('NO ECHO')
  })
})

describe('classifyProximity (near / clear vs threshold)', () => {
  it('flags a reading at or under the threshold as near', () => {
    expect(classifyProximity(200, 300)).toBe('near')
    expect(classifyProximity(300, 300)).toBe('near') // boundary is inclusive
  })
  it('flags a reading beyond the threshold as clear', () => {
    expect(classifyProximity(500, 300)).toBe('clear')
  })
  it('returns none for a no-echo reading', () => {
    expect(classifyProximity(0, 300)).toBe('none')
    expect(classifyProximity(5000, 300, 2000)).toBe('none')
  })
})

describe('polarToPoint (polar → cartesian in the radar viewBox)', () => {
  it('puts the apex at the bottom-centre for 0 mm', () => {
    const p = polarToPoint(90, 0, GEOM)
    expect(p).toEqual({ x: 100, y: 100 })
  })
  it('plots 90° (straight up) at max range on the rim above the apex', () => {
    // r = (1000/1000)*100 = 100; up → cy - 100 = 0.
    const p = polarToPoint(90, 1000, GEOM)
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })
  it('plots 0° (right) and 180° (left) along the baseline', () => {
    const right = polarToPoint(0, 1000, GEOM)
    const left = polarToPoint(180, 1000, GEOM)
    expect(right).toEqual({ x: 200, y: 100 })
    expect(left).toEqual({ x: 0, y: 100 })
  })
  it('scales distance linearly from apex to rim', () => {
    // Half range straight up → halfway between apex (y=100) and rim (y=0).
    const p = polarToPoint(90, 500, GEOM)
    expect(p.y).toBeCloseTo(50, 6)
  })
  it('clamps an over-range reading onto the rim', () => {
    const over = polarToPoint(90, 9999, GEOM)
    const rim = polarToPoint(90, 1000, GEOM)
    expect(over).toEqual(rim)
  })
})

describe('pushHistory (fixed-size ring buffer)', () => {
  it('appends a reading (oldest → newest)', () => {
    expect(pushHistory([1, 2], 3)).toEqual([1, 2, 3])
  })
  it('does not mutate the input array', () => {
    const h = [1, 2]
    pushHistory(h, 3)
    expect(h).toEqual([1, 2])
  })
  it('stores a no-echo reading as 0 (a dropout)', () => {
    expect(pushHistory([10], 0)).toEqual([10, 0])
    expect(pushHistory([10], NaN)).toEqual([10, 0])
  })
  it('caps at HISTORY_CAP, dropping the oldest', () => {
    let h: number[] = []
    for (let i = 0; i < HISTORY_CAP + 25; i++) h = pushHistory(h, i)
    expect(h.length).toBe(HISTORY_CAP)
    // The most recent value is the last pushed.
    expect(h[h.length - 1]).toBe(HISTORY_CAP + 24)
    // The oldest retained is exactly cap-1 behind it.
    expect(h[0]).toBe(HISTORY_CAP + 24 - (HISTORY_CAP - 1))
  })
  it('honours a custom cap', () => {
    let h: number[] = []
    for (let i = 0; i < 10; i++) h = pushHistory(h, i, 3)
    expect(h).toEqual([7, 8, 9])
  })
})

describe('historyPath (single-sensor history polyline)', () => {
  it('returns empty for no history', () => {
    expect(historyPath([], 100, 50, 1000)).toBe('')
  })
  it('maps oldest→left, newest→right with 0 mm at the bottom', () => {
    // Two points: [0 mm, 1000 mm] over width 100, height 50, max 1000.
    // x: 0 and 100; y: bottom (50) then top (0).
    expect(historyPath([0, 1000], 100, 50, 1000)).toBe('0,50 100,0')
  })
})

describe('swept persistence (pushBlip / blipOpacity)', () => {
  it('drops a no-echo reading from the trail', () => {
    expect(pushBlip([], 45, 0, 1)).toEqual([])
    expect(pushBlip([], 45, 5000, 1, 2000)).toEqual([])
  })
  it('appends a valid blip', () => {
    expect(pushBlip([], 45, 500, 1)).toEqual([{ angle: 45, mm: 500, seq: 1 }])
  })
  it('replaces an existing blip at (approximately) the same bearing', () => {
    const t: RadarBlip[] = [{ angle: 45, mm: 500, seq: 1 }]
    const next = pushBlip(t, 45, 700, 2)
    expect(next).toEqual([{ angle: 45, mm: 700, seq: 2 }])
  })
  it('keeps blips at distinct bearings', () => {
    const t = pushBlip(pushBlip([], 30, 500, 1), 120, 800, 2)
    expect(t).toHaveLength(2)
  })
  it('caps the trail at SWEEP_TRAIL', () => {
    let t: RadarBlip[] = []
    for (let i = 0; i < SWEEP_TRAIL + 20; i++) t = pushBlip(t, i % 180, 500, i)
    expect(t.length).toBeLessThanOrEqual(SWEEP_TRAIL)
  })
  it('fades older blips toward the floor opacity', () => {
    expect(blipOpacity(10, 10)).toBe(1) // freshest
    expect(blipOpacity(10, 10 + SWEEP_TRAIL)).toBeCloseTo(0.05, 6) // fully aged → floor
    const mid = blipOpacity(10, 10 + SWEEP_TRAIL / 2)
    expect(mid).toBeGreaterThan(0.05)
    expect(mid).toBeLessThan(1)
  })
})

describe('parseDistance (SNK DIST telemetry, single vs swept)', () => {
  it('parses a single-sensor reading (no angle)', () => {
    expect(parseDistance('SNK DIST tof 1234')).toEqual({ kind: 'dist', ch: 'tof', mm: 1234 })
  })
  it('parses a swept reading (with angle)', () => {
    expect(parseDistance('SNK DIST sonar 800 45')).toEqual({
      kind: 'dist',
      ch: 'sonar',
      mm: 800,
      angle: 45
    })
  })
  it('tolerates leading whitespace and extra spaces', () => {
    expect(parseDistance('   SNK   DIST   tof   500')).toEqual({ kind: 'dist', ch: 'tof', mm: 500 })
  })
  it('returns null for a non-DIST or malformed line', () => {
    expect(parseDistance('SNK SCOPE pwm 0.5')).toBeNull()
    expect(parseDistance('hello world')).toBeNull()
    expect(parseDistance('SNK DIST tof notanumber')).toBeNull()
    expect(parseDistance('')).toBeNull()
  })
  it('ignores a non-numeric angle token (falls back to single-sensor)', () => {
    expect(parseDistance('SNK DIST tof 500 NaNish')).toEqual({ kind: 'dist', ch: 'tof', mm: 500 })
  })
})
