import { describe, it, expect } from 'vitest'
import { mirrorRotationX, mirrorX, padPassesThrough } from '../src/shared/part'
import { pinOutwardDir } from '../src/renderer/src/components/part-body'

/**
 * A through pad seen from the FAR side of the board (#688).
 *
 * Reported as: flip the board in the Part Editor and the castellated pins keep
 * facing their original direction. `rotation` is which way a pad faces — and the
 * half-hole of a castellation is cut on that side — so it has to mirror along
 * with the pad's position.
 */
describe('mirrorRotationX (#688)', () => {
  it('swaps left and right', () => {
    expect(mirrorRotationX(0)).toBe(180) // right -> left
    expect(mirrorRotationX(180)).toBe(0) // left  -> right
  })

  it('leaves up and down alone — mirroring in x does not touch them', () => {
    expect(mirrorRotationX(90)).toBe(90)
    expect(mirrorRotationX(270)).toBe(270)
  })

  it('is its own inverse, so flipping twice is the original', () => {
    for (const d of [0, 90, 180, 270]) expect(mirrorRotationX(mirrorRotationX(d))).toBe(d)
  })

  it('keeps "no explicit direction" absent, so the nearest-edge fallback still applies', () => {
    // That fallback already mirrors, because the pad's x does.
    expect(mirrorRotationX(undefined)).toBeUndefined()
    expect(mirrorRotationX(Number.NaN)).toBeUndefined()
  })

  it('quantises a sloppy angle before mirroring', () => {
    expect(mirrorRotationX(3)).toBe(180)
    expect(mirrorRotationX(-90)).toBe(270)
    expect(mirrorRotationX(360)).toBe(180)
  })
})

describe('the mirrored pad faces off the board on both sides (#688)', () => {
  it('a right-facing pad on the right edge faces LEFT once flipped', () => {
    const nx = 0.95
    expect(pinOutwardDir(0, nx, 0.5)).toBe('right')
    // Flipped: the pad is now at 0.05, and must run off the left edge.
    expect(pinOutwardDir(mirrorRotationX(0), mirrorX(nx), 0.5)).toBe('left')
  })

  it('a pad with no rotation already mirrored, via its x', () => {
    expect(pinOutwardDir(undefined, 0.95, 0.5)).toBe('right')
    expect(pinOutwardDir(undefined, mirrorX(0.95), 0.5)).toBe('left')
  })

  it('only through pads are shown on the far face at all', () => {
    // A surface pad belongs to one face, so it is never drawn mirrored.
    expect(padPassesThrough('castellated')).toBe(true)
    expect(padPassesThrough('smd')).toBe(false)
    expect(padPassesThrough('round')).toBe(false)
  })
})
