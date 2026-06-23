import { describe, it, expect } from 'vitest'
import {
  buttonLabel,
  buttonState,
  DEFAULT_COUNTS_PER_REV,
  direction,
  DIRECTION_LABEL,
  encoderSnapshot,
  formatDelta,
  formatRpm,
  rotationAngle,
  rpm,
  wrappedAngle
} from '../src/renderer/src/components/encoder-logic'

describe('direction', () => {
  it('increasing count is clockwise', () => {
    expect(direction(0, 1)).toBe('cw')
    expect(direction(5, 12)).toBe('cw')
  })

  it('decreasing count is counter-clockwise', () => {
    expect(direction(1, 0)).toBe('ccw')
    expect(direction(12, 5)).toBe('ccw')
  })

  it('no change is idle', () => {
    expect(direction(7, 7)).toBe('idle')
    expect(direction(0, 0)).toBe('idle')
  })

  it('handles negative counts crossing zero', () => {
    expect(direction(-1, 1)).toBe('cw')
    expect(direction(1, -1)).toBe('ccw')
  })

  it('non-finite input is idle (never throws)', () => {
    expect(direction(NaN, 1)).toBe('idle')
    expect(direction(0, Infinity)).toBe('idle')
  })

  it('exposes readable labels', () => {
    expect(DIRECTION_LABEL.cw).toBe('CW')
    expect(DIRECTION_LABEL.ccw).toBe('CCW')
    expect(DIRECTION_LABEL.idle).toBe('IDLE')
  })
})

describe('rotationAngle', () => {
  it('maps a full revolution of counts to 360 degrees', () => {
    expect(rotationAngle(20, 20)).toBe(360)
    expect(rotationAngle(10, 20)).toBe(180)
    expect(rotationAngle(5, 20)).toBe(90)
  })

  it('grows past 360 for more than one revolution (unwrapped)', () => {
    expect(rotationAngle(30, 20)).toBe(540)
    expect(rotationAngle(40, 20)).toBe(720)
  })

  it('goes negative for a negative count', () => {
    expect(rotationAngle(-5, 20)).toBe(-90)
  })

  it('degrades to 0 for a non-positive countsPerRev or bad input', () => {
    expect(rotationAngle(5, 0)).toBe(0)
    expect(rotationAngle(5, -20)).toBe(0)
    expect(rotationAngle(NaN, 20)).toBe(0)
  })
})

describe('wrappedAngle', () => {
  it('wraps into [0, 360)', () => {
    expect(wrappedAngle(20, 20)).toBe(0) // a whole turn → 0
    expect(wrappedAngle(30, 20)).toBe(180) // 540 → 180
    expect(wrappedAngle(25, 20)).toBe(90) // 450 → 90
  })

  it('wraps a negative angle up into range', () => {
    expect(wrappedAngle(-5, 20)).toBe(270) // -90 → 270
  })

  it('is 0 for bad input', () => {
    expect(wrappedAngle(5, 0)).toBe(0)
  })
})

describe('rpm', () => {
  it('one revolution in one second is 60 RPM', () => {
    // 20 counts (one rev) over 1000ms with 20 counts/rev → 60 rpm
    expect(rpm(20, 1000, 20)).toBeCloseTo(60, 6)
  })

  it('scales with the count delta', () => {
    // 10 counts (half a rev) over 1000ms → 30 rpm
    expect(rpm(10, 1000, 20)).toBeCloseTo(30, 6)
  })

  it('scales inversely with elapsed time', () => {
    // one rev over 500ms → 120 rpm
    expect(rpm(20, 500, 20)).toBeCloseTo(120, 6)
  })

  it('respects a different counts-per-rev', () => {
    // 24-count encoder: one rev (24 counts) over 1000ms → 60 rpm
    expect(rpm(24, 1000, 24)).toBeCloseTo(60, 6)
  })

  it('is negative for a CCW (negative) delta', () => {
    expect(rpm(-20, 1000, 20)).toBeCloseTo(-60, 6)
  })

  it('is 0 when no time elapsed or bad input', () => {
    expect(rpm(20, 0, 20)).toBe(0)
    expect(rpm(20, -100, 20)).toBe(0)
    expect(rpm(20, 1000, 0)).toBe(0)
    expect(rpm(NaN, 1000, 20)).toBe(0)
  })
})

describe('buttonState / buttonLabel', () => {
  it('passes a true flag through', () => {
    expect(buttonState(true)).toBe(true)
    expect(buttonLabel(true)).toBe('DOWN')
  })

  it('treats false and undefined as not pressed', () => {
    expect(buttonState(false)).toBe(false)
    expect(buttonState(undefined)).toBe(false)
    expect(buttonLabel(false)).toBe('UP')
    expect(buttonLabel(undefined)).toBe('UP')
  })
})

describe('formatRpm / formatDelta', () => {
  it('formats RPM as a 1dp magnitude', () => {
    expect(formatRpm(59.95)).toBe('60.0')
    expect(formatRpm(-30)).toBe('30.0') // magnitude only; DIR shows the sense
  })

  it('returns an em dash for a missing RPM', () => {
    expect(formatRpm(undefined)).toBe('—')
    expect(formatRpm(NaN)).toBe('—')
  })

  it('formats a signed delta', () => {
    expect(formatDelta(3)).toBe('+3')
    expect(formatDelta(-1)).toBe('-1')
    expect(formatDelta(0)).toBe('0')
    expect(formatDelta(undefined)).toBe('—')
  })
})

describe('encoderSnapshot', () => {
  it('first sample (no prev) is idle with no movement', () => {
    const s = encoderSnapshot({ count: 42 })
    expect(s.count).toBe(42)
    expect(s.delta).toBe(0)
    expect(s.direction).toBe('idle')
    expect(s.rpm).toBe(0)
    expect(s.pressed).toBe(false)
  })

  it('derives CW direction and angle from successive counts', () => {
    const s = encoderSnapshot({ count: 10, prev: 5, dtMs: 1000, countsPerRev: 20 })
    expect(s.delta).toBe(5)
    expect(s.direction).toBe('cw')
    expect(s.angle).toBe(180) // 10 / 20 * 360
    expect(s.rpm).toBeCloseTo(15, 6) // 5 counts / 20 per rev over 1s → 15 rpm
  })

  it('derives CCW when the count decreases', () => {
    const s = encoderSnapshot({ count: 5, prev: 12, dtMs: 1000, countsPerRev: 20 })
    expect(s.delta).toBe(-7)
    expect(s.direction).toBe('ccw')
    expect(s.rpm).toBeLessThan(0)
  })

  it('passes the button through', () => {
    expect(encoderSnapshot({ count: 1, pressed: true }).pressed).toBe(true)
    expect(encoderSnapshot({ count: 1, pressed: false }).pressed).toBe(false)
  })

  it('uses the default counts-per-rev when omitted', () => {
    const s = encoderSnapshot({ count: DEFAULT_COUNTS_PER_REV })
    expect(s.angle).toBe(360)
  })

  it('survives non-finite input', () => {
    const s = encoderSnapshot({ count: NaN, prev: NaN })
    expect(s.count).toBe(0)
    expect(s.direction).toBe('idle')
    expect(s.angle).toBe(0)
  })
})
