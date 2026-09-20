import { describe, it, expect } from 'vitest'
import {
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
