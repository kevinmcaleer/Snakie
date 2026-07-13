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
