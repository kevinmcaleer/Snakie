import { describe, it, expect } from 'vitest'
import {
  POT_VREF,
  knobRotation,
  needleAngle,
  needlePoint,
  pctFromVolts
} from '../src/renderer/src/components/pot-logic'

describe('pctFromVolts', () => {
  it('maps 0..vref volts to 0..100 %', () => {
    expect(pctFromVolts(0)).toBe(0)
    expect(pctFromVolts(POT_VREF)).toBe(100)
    expect(pctFromVolts(POT_VREF / 2)).toBe(50)
    expect(pctFromVolts(1.65)).toBe(50)
  })
  it('clamps out-of-range + tolerates a custom vref', () => {
    expect(pctFromVolts(5)).toBe(100)
    expect(pctFromVolts(-1)).toBe(0)
    expect(pctFromVolts(2.5, 5)).toBe(50)
    expect(pctFromVolts(NaN)).toBe(0)
  })
})

describe('needleAngle', () => {
  it('sweeps 150° (0%) → 90° (50%, straight up) → 30° (100%)', () => {
    expect(needleAngle(0)).toBe(150)
    expect(needleAngle(50)).toBe(90)
    expect(needleAngle(100)).toBe(30)
  })
  it('clamps beyond the ends', () => {
    expect(needleAngle(-20)).toBe(150)
    expect(needleAngle(200)).toBe(30)
  })
})

describe('needlePoint', () => {
  it('50% points straight up (same x as the pivot, smaller y)', () => {
    const p = needlePoint(50, 100, 100, 80)
    expect(p.x).toBeCloseTo(100, 5)
    expect(p.y).toBeCloseTo(20, 5) // 100 - 80
  })
  it('0% and 100% are mirror images across the pivot', () => {
    const a = needlePoint(0, 100, 100, 80)
    const b = needlePoint(100, 100, 100, 80)
    expect(a.x).toBeCloseTo(200 - b.x, 5)
    expect(a.y).toBeCloseTo(b.y, 5)
  })
})

describe('knobRotation', () => {
  it('maps 0..100 % to a 270° sweep centred on 0°', () => {
    expect(knobRotation(0)).toBe(-135)
    expect(knobRotation(50)).toBe(0)
    expect(knobRotation(100)).toBe(135)
  })
})
