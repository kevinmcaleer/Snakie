import { describe, it, expect } from 'vitest'
import {
  easeInOutCubic,
  explodeProgress,
  explodeDirections,
  orbitPosition,
  pickVideoMime
} from '../src/renderer/src/components/robot-explode'

/** Exploded-view math (#499). */
describe('robot-explode', () => {
  it('easing is monotone with fixed endpoints', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5)
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOutCubic(t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('explodeProgress goes out, holds, and returns to zero', () => {
    expect(explodeProgress(0)).toBe(0)
    expect(explodeProgress(0.5)).toBe(1) // mid-hold
    expect(explodeProgress(1)).toBe(0)
    expect(explodeProgress(0.2)).toBeGreaterThan(0)
    // Symmetric out/back legs.
    expect(explodeProgress(0.1)).toBeCloseTo(explodeProgress(0.9), 6)
  })

  it('directions radiate from the centre; degenerate links go up', () => {
    const dirs = explodeDirections(
      new Map([
        ['left', { x: -2, y: 0, z: 0 }],
        ['up', { x: 0, y: 3, z: 0 }],
        ['centre', { x: 0, y: 0, z: 0 }]
      ]),
      { x: 0, y: 0, z: 0 }
    )
    expect(dirs.get('left')).toEqual({ x: -1, y: 0, z: 0 })
    expect(dirs.get('up')).toEqual({ x: 0, y: 1, z: 0 })
    expect(dirs.get('centre')).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('orbit keeps radius + height and ends where it started', () => {
    const start = { x: 3, y: 2, z: 0 }
    const target = { x: 1, y: 0, z: 0 }
    const r = Math.hypot(start.x - target.x, start.z - target.z)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = orbitPosition(t, start, target)
      expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeCloseTo(r, 6)
      expect(p.y).toBe(2)
    }
    const end = orbitPosition(1, start, target)
    expect(end.x).toBeCloseTo(start.x, 6)
    expect(end.z).toBeCloseTo(start.z, 6)
  })

  it('prefers mp4, falls back to webm, null when nothing works', () => {
    expect(pickVideoMime((m) => m.startsWith('video/mp4'))?.ext).toBe('mp4')
    expect(pickVideoMime((m) => m === 'video/webm')?.ext).toBe('webm')
    expect(pickVideoMime(() => false)).toBeNull()
  })
})

import { compensateAncestors } from '../src/renderer/src/components/robot-explode'

describe('compensateAncestors', () => {
  it('children subtract their nearest exploded ancestor so world paths stay straight', () => {
    const desired = new Map([
      ['base', { x: 0, y: 0, z: 0 }],
      ['arm', { x: 1, y: 0, z: 0 }],
      ['hand', { x: 1, y: 1, z: 0 }]
    ])
    const parentOf = new Map<string, string | null>([
      ['base', null],
      ['arm', 'base'],
      ['hand', 'arm']
    ])
    const net = compensateAncestors(desired, parentOf)
    expect(net.get('base')).toEqual({ x: 0, y: 0, z: 0 })
    expect(net.get('arm')).toEqual({ x: 1, y: 0, z: 0 })
    // hand's own world displacement = arm(1,0,0) + net(0,1,0) = desired (1,1,0) ✓
    expect(net.get('hand')).toEqual({ x: 0, y: 1, z: 0 })
  })
})

import { hierarchyDepths } from '../src/renderer/src/components/robot-explode'

describe('hierarchyDepths', () => {
  it('roots are 0, each level deeper +1', () => {
    const d = hierarchyDepths(
      new Map([
        ['base', null],
        ['arm', 'base'],
        ['hand', 'arm'],
        ['leg', 'base']
      ])
    )
    expect(d.get('base')).toBe(0)
    expect(d.get('arm')).toBe(1)
    expect(d.get('hand')).toBe(2)
    expect(d.get('leg')).toBe(1)
  })
  it('depth-weighted same-direction chains still separate after compensation', () => {
    // arm + hand explode along the SAME direction; weights 0.5 / 1.0.
    const desired = new Map([
      ['arm', { x: 0.5, y: 0, z: 0 }],
      ['hand', { x: 1, y: 0, z: 0 }]
    ])
    const net = compensateAncestors(desired, new Map([['arm', null], ['hand', 'arm']]))
    expect(net.get('hand')!.x).toBeCloseTo(0.5, 6) // > 0 → hand pulls AWAY from arm
  })
})

import { resolveOverlaps, type PartBox } from '../src/renderer/src/components/robot-explode'

describe('resolveOverlaps', () => {
  const box = (name: string, cx: number, dirx: number, travel: number, depth: number): PartBox => ({
    name,
    centre: { x: cx, y: 0, z: 0 },
    half: { x: 1, y: 1, z: 1 },
    dir: { x: dirx, y: 0, z: 0 },
    travel,
    depth
  })
  it('pushes the deeper part further until clear; leaves clear pairs alone', () => {
    // Both travel +x the same amount → they'd land overlapping; hand (deeper) must go further.
    const parts = [box('arm', 0, 1, 2, 1), box('hand', 1, 1, 2, 2)]
    const t = resolveOverlaps(parts, 0.1)
    expect(t.get('arm')).toBe(2) // untouched
    expect(t.get('hand')! - t.get('arm')!).toBeGreaterThanOrEqual(1) // separated by ≥ half sums
    // final gap check
    const gap = Math.abs(1 + t.get('hand')! - (0 + t.get('arm')!))
    expect(gap).toBeGreaterThanOrEqual(2) // half.x + half.x
  })
  it('never moves anchored parts', () => {
    const parts = [box('base', 0, 0, 0, 0), box('arm', 0.5, 1, 0, 1)]
    const t = resolveOverlaps(parts, 0.1)
    expect(t.get('base')).toBe(0)
    expect(t.get('arm')).toBeGreaterThan(0)
  })
})
