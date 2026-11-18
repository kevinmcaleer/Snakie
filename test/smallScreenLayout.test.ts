import { describe, expect, it } from 'vitest'
import {
  COMPACT_MAX_WIDTH,
  PHONE_MAX_WIDTH,
  viewportSizeFor
} from '../src/renderer/src/hooks/useViewportSize'
import { easeOutCubic, tweenValue } from '../src/renderer/src/hooks/useAnimatedNumber'
import { isTouchTap, TOUCH_TAP_SLOP } from '../src/renderer/src/components/MiniBoardView'

describe('viewportSizeFor (small-screen layout)', () => {
  it('keeps the desktop layout above the compact breakpoint', () => {
    expect(viewportSizeFor(1440)).toBe('wide')
    expect(viewportSizeFor(COMPACT_MAX_WIDTH + 1)).toBe('wide')
  })

  it('uses the compact layout for small laptops and tablets', () => {
    expect(viewportSizeFor(COMPACT_MAX_WIDTH)).toBe('compact')
    expect(viewportSizeFor(1024)).toBe('compact')
    expect(viewportSizeFor(768)).toBe('compact')
    expect(viewportSizeFor(PHONE_MAX_WIDTH + 1)).toBe('compact')
  })

  it('uses the phone layout at phone widths', () => {
    expect(viewportSizeFor(PHONE_MAX_WIDTH)).toBe('phone')
    expect(viewportSizeFor(390)).toBe('phone')
  })
})

describe('tweenValue (mini board smooth zoom)', () => {
  it('starts at the start value and lands exactly on the target', () => {
    expect(tweenValue(1, 1.25, 0, 200)).toBe(1)
    expect(tweenValue(1, 1.25, 200, 200)).toBe(1.25)
    expect(tweenValue(1, 1.25, 500, 200)).toBe(1.25)
  })

  it('moves monotonically toward the target in between', () => {
    const steps = [40, 80, 120, 160].map((t) => tweenValue(1, 2, t, 200))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
    expect(steps[0]).toBeGreaterThan(1)
    expect(steps[3]).toBeLessThan(2)
  })

  it('also eases when zooming out', () => {
    const mid = tweenValue(2, 1, 100, 200)
    expect(mid).toBeLessThan(2)
    expect(mid).toBeGreaterThan(1)
  })

  it('snaps when there is no duration', () => {
    expect(tweenValue(1, 3, 0, 0)).toBe(3)
  })

  it('easeOutCubic is clamped to [0, 1]', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875)
  })
})

describe('mini board touch pinout', () => {
  it('treats a small drift as a tap/hold and a longer drag as a pan', () => {
    expect(isTouchTap(0, 0)).toBe(true)
    expect(isTouchTap(6, 6)).toBe(true)
    expect(isTouchTap(TOUCH_TAP_SLOP, 0)).toBe(true)
    expect(isTouchTap(TOUCH_TAP_SLOP + 1, 0)).toBe(false)
    expect(isTouchTap(0, -40)).toBe(false)
  })
})
