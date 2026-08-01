import { describe, it, expect } from 'vitest'
import { pinOutwardDir } from '../src/renderer/src/components/part-body'

/**
 * Which way a pin's label reads (#664).
 *
 * `pinOutwardDir` honours an explicit `rotation` above everything else, because
 * that is the pin inspector's "aim the label this way" override. `servoTrio` used
 * to preset `rotation: 270` on every servo signal pin, which pinned the label to
 * the TOP of the board however far down the header actually sat.
 */
describe('pinOutwardDir (#664)', () => {
  it('falls back to the nearest edge when no rotation is set', () => {
    expect(pinOutwardDir(undefined, 0.5, 0.9)).toBe('bottom')
    expect(pinOutwardDir(undefined, 0.5, 0.1)).toBe('top')
    expect(pinOutwardDir(undefined, 0.05, 0.5)).toBe('left')
    expect(pinOutwardDir(undefined, 0.95, 0.5)).toBe('right')
  })

  it('still obeys an explicit rotation — the inspector control must keep working', () => {
    expect(pinOutwardDir(270, 0.5, 0.9)).toBe('top')
    expect(pinOutwardDir(0, 0.5, 0.9)).toBe('right')
    expect(pinOutwardDir(90, 0.5, 0.1)).toBe('bottom')
    expect(pinOutwardDir(180, 0.5, 0.1)).toBe('left')
  })
})
