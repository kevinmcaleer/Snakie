import { describe, it, expect } from 'vitest'
import {
  BONE_PALETTE,
  boneColor,
  boneLengthMm,
  boneSegments,
  duplicateNames,
  formatAngleDeg,
  formatMm,
  limitColorHex,
  limitProximity,
  mixHex
} from '../src/renderer/src/components/robot-bone-mode'

describe('boneSegments — skeleton topology (#536)', () => {
  it('chains joints through shared links, rooting the first at the base', () => {
    const segs = boneSegments([
      { name: 'hip', parentLink: 'base_link', childLink: 'thigh' },
      { name: 'knee', parentLink: 'thigh', childLink: 'shin' },
      { name: 'ankle', parentLink: 'shin', childLink: 'foot' }
    ])
    expect(segs).toEqual([
      { from: null, to: 'hip' },
      { from: 'hip', to: 'knee' },
      { from: 'knee', to: 'ankle' }
    ])
  })

  it('branches: two joints on one parent link share the same from-joint', () => {
    const segs = boneSegments([
      { name: 'neck', parentLink: 'base_link', childLink: 'torso' },
      { name: 'arm_l', parentLink: 'torso', childLink: 'hand_l' },
      { name: 'arm_r', parentLink: 'torso', childLink: 'hand_r' }
    ])
    expect(segs[1]).toEqual({ from: 'neck', to: 'arm_l' })
    expect(segs[2]).toEqual({ from: 'neck', to: 'arm_r' })
  })

  it('a loose sub-assembly joint (unknown parent link) roots at the base', () => {
    const segs = boneSegments([{ name: 'j', parentLink: 'floating_part', childLink: 'leaf' }])
    expect(segs).toEqual([{ from: null, to: 'j' }])
  })

  it('is order-independent: the parent joint may appear after its child', () => {
    const segs = boneSegments([
      { name: 'knee', parentLink: 'thigh', childLink: 'shin' },
      { name: 'hip', parentLink: 'base_link', childLink: 'thigh' }
    ])
    expect(segs[0]).toEqual({ from: 'hip', to: 'knee' })
  })
})

describe('boneLengthMm — bone endpoints → mm', () => {
  it('converts world metres to millimetres', () => {
    expect(boneLengthMm([0, 0, 0], [0.1, 0, 0])).toBeCloseTo(100)
  })
  it('handles 3-D diagonals', () => {
    expect(boneLengthMm([0.01, 0.02, 0.03], [0.04, 0.06, 0.03])).toBeCloseTo(50)
  })
  it('is zero for co-located joints', () => {
    expect(boneLengthMm([0.2, 0.1, -0.3], [0.2, 0.1, -0.3])).toBe(0)
  })
})

describe('formatMm / formatAngleDeg — label formatting', () => {
  it('rounds ≥10 mm to whole millimetres', () => {
    expect(formatMm(123.4)).toBe('123 mm')
    expect(formatMm(99.5)).toBe('100 mm')
  })
  it('keeps one decimal below 10 mm', () => {
    expect(formatMm(7.25)).toBe('7.3 mm')
    expect(formatMm(0.04)).toBe('0 mm')
  })
  it('formats angles in whole degrees', () => {
    expect(formatAngleDeg(Math.PI / 2)).toBe('90°')
    expect(formatAngleDeg(-Math.PI / 4)).toBe('-45°')
  })
  it('never shows -0°', () => {
    expect(formatAngleDeg(-0.001)).toBe('0°')
  })
})

describe('limitProximity — warning threshold near a joint limit', () => {
  const lo = -Math.PI / 2
  const hi = Math.PI / 2
  it('is 0 at the centre of the range', () => {
    expect(limitProximity(0, lo, hi)).toBe(0)
  })
  it('is 1 exactly at either limit', () => {
    expect(limitProximity(lo, lo, hi)).toBe(1)
    expect(limitProximity(hi, lo, hi)).toBe(1)
  })
  it('clamps to 1 past a limit', () => {
    expect(limitProximity(hi + 1, lo, hi)).toBe(1)
  })
  it('rises inside the outer 15% zone only', () => {
    const range = hi - lo
    const justInside = hi - 0.15 * range // zone edge
    expect(limitProximity(justInside, lo, hi)).toBeCloseTo(0)
    const halfway = hi - 0.075 * range // halfway into the zone
    expect(limitProximity(halfway, lo, hi)).toBeCloseTo(0.5)
  })
  it('reports 0 for a degenerate range (upper ≤ lower)', () => {
    expect(limitProximity(0, 1, 1)).toBe(0)
    expect(limitProximity(0, 2, -2)).toBe(0)
  })
})

describe('mixHex / limitColorHex — limit colour ramp', () => {
  it('mixes two colours linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#ff0000', '#00ff00', 0)).toBe('#ff0000')
    expect(mixHex('#ff0000', '#00ff00', 1)).toBe('#00ff00')
  })
  it('clamps t outside 0…1', () => {
    expect(mixHex('#102030', '#405060', -1)).toBe('#102030')
    expect(mixHex('#102030', '#405060', 2)).toBe('#405060')
  })
  it('runs green → amber → red across the proximity range', () => {
    expect(limitColorHex(0)).toBe('#6ee76e')
    expect(limitColorHex(0.5)).toBe('#ffd23f')
    expect(limitColorHex(1)).toBe('#ff5a5a')
  })
})

describe('duplicateNames — friendly unique-name check', () => {
  it('returns [] when all names are unique', () => {
    expect(duplicateNames(['a', 'b', 'c'])).toEqual([])
  })
  it('lists each duplicate once, first-seen order', () => {
    expect(duplicateNames(['hip', 'knee', 'hip', 'ankle', 'knee', 'hip'])).toEqual(['hip', 'knee'])
  })
  it('handles the empty list', () => {
    expect(duplicateNames([])).toEqual([])
  })
})

describe('boneColor — palette cycling', () => {
  it('cycles the palette and never goes out of bounds', () => {
    expect(boneColor(0)).toBe(BONE_PALETTE[0])
    expect(boneColor(BONE_PALETTE.length)).toBe(BONE_PALETTE[0])
    expect(boneColor(BONE_PALETTE.length + 2)).toBe(BONE_PALETTE[2])
  })
})
