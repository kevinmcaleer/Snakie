import { describe, it, expect } from 'vitest'
import {
  easeOutView,
  lerpView,
  VIEW_ANIM_EASING,
  VIEW_ANIM_MS,
  viewTransition
} from '../src/renderer/src/components/board-viewport'

describe('eased board-viewport zoom', () => {
  it('transitions only the transform, with the ease-out curve', () => {
    expect(viewTransition(true)).toBe(`transform ${VIEW_ANIM_MS}ms ${VIEW_ANIM_EASING}`)
  })

  it('is off for continuous gestures (wheel-zoom / drag-pan)', () => {
    expect(viewTransition(false)).toBe('none')
  })

  it('animates long enough to read as a glide, short enough to stay snappy', () => {
    expect(VIEW_ANIM_MS).toBeGreaterThanOrEqual(120)
    expect(VIEW_ANIM_MS).toBeLessThanOrEqual(400)
  })
})

describe('JS-tweened viewport ease (wiring canvas)', () => {
  it('starts at the old view and lands exactly on the new one', () => {
    const from = { tx: 0, ty: 0, scale: 1 }
    const to = { tx: 100, ty: -40, scale: 2 }
    expect(lerpView(from, to, 0)).toEqual(from)
    expect(lerpView(from, to, 1)).toEqual(to)
  })

  it('eases OUT — more than half the distance is covered by half-time', () => {
    expect(easeOutView(0.5)).toBeGreaterThan(0.5)
    expect(easeOutView(0.5)).toBeLessThan(1)
  })

  it('is monotonic and clamped outside 0…1', () => {
    expect(easeOutView(-1)).toBe(0)
    expect(easeOutView(2)).toBe(1)
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const v = easeOutView(t)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })

  it('tweens every axis together, so pan and zoom arrive as one move', () => {
    const mid = lerpView({ tx: 0, ty: 0, scale: 1 }, { tx: 10, ty: 20, scale: 3 }, 0.5)
    const k = easeOutView(0.5)
    expect(mid).toEqual({ tx: 10 * k, ty: 20 * k, scale: 1 + 2 * k })
  })
})
