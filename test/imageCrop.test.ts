import { describe, it, expect } from 'vitest'
import { cropFromSelection, cropPixels, fitBoxToBoard, opaqueBounds } from '../src/renderer/src/components/image-crop'
import type { RGBAImage } from '../src/renderer/src/components/image-bg-remove'

/** A w×h image whose pixel (x, y) is [x, y, 0, alpha(x, y)]. */
function makeImage(w: number, h: number, alpha: (x: number, y: number) => number = () => 255): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = x
      data[i + 1] = y
      data[i + 3] = alpha(x, y)
    }
  return { data, width: w, height: h }
}

describe('cropFromSelection', () => {
  const layer = { x: 0, y: 0, w: 1, h: 1 }

  it('maps a box on the board to the pixels under it, and keeps them in place', () => {
    const c = cropFromSelection(layer, { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 }, 100, 40)
    expect(c?.px).toEqual({ x: 25, y: 20, w: 50, h: 20 })
    expect(c?.box).toEqual({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('accepts the corners in any order', () => {
    const a = cropFromSelection(layer, { x0: 0.75, y0: 1, x1: 0.25, y1: 0.5 }, 100, 40)
    expect(a?.px).toEqual({ x: 25, y: 20, w: 50, h: 20 })
  })

  it('clips a box that spills off the photo to the photo', () => {
    const offset = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }
    const c = cropFromSelection(offset, { x0: -1, y0: -1, x1: 0.45, y1: 2 }, 10, 10)
    expect(c?.px).toEqual({ x: 0, y: 0, w: 5, h: 10 })
    expect(c?.box.x).toBeCloseTo(0.2)
    expect(c?.box.w).toBeCloseTo(0.25)
    expect(c?.box.h).toBeCloseTo(0.5)
  })

  it('snaps the kept box to whole pixels so the photo does not shift', () => {
    const c = cropFromSelection(layer, { x0: 0.123, y0: 0, x1: 0.5, y1: 1 }, 10, 10)
    expect(c?.px.x).toBe(1)
    expect(c?.box.x).toBeCloseTo(0.1)
  })

  it('returns null when the box misses the photo or is under 2×2 px', () => {
    expect(cropFromSelection(layer, { x0: 1.2, y0: 0, x1: 1.5, y1: 1 }, 10, 10)).toBeNull()
    expect(cropFromSelection(layer, { x0: 0.5, y0: 0.5, x1: 0.51, y1: 0.51 }, 10, 10)).toBeNull()
  })
})

describe('cropPixels', () => {
  it('copies just the rectangle, row by row', () => {
    const out = cropPixels(makeImage(6, 4), { x: 2, y: 1, w: 3, h: 2 })
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    // top-left of the crop is source (2, 1); bottom-right is (4, 2)
    expect([out.data[0], out.data[1]]).toEqual([2, 1])
    const last = (1 * 3 + 2) * 4
    expect([out.data[last], out.data[last + 1]]).toEqual([4, 2])
  })
})

describe('opaqueBounds', () => {
  it('finds the box around the non-transparent pixels', () => {
    const img = makeImage(8, 6, (x, y) => (x >= 2 && x <= 5 && y >= 1 && y <= 3 ? 255 : 0))
    expect(opaqueBounds(img)).toEqual({ x: 2, y: 1, w: 4, h: 3 })
  })

  it('ignores a faint fringe and returns null for an empty image', () => {
    expect(opaqueBounds(makeImage(4, 4, () => 3))).toBeNull()
  })
})

describe('fitBoxToBoard', () => {
  it('fills the width of a board for a wider photo, centred', () => {
    // a 2:1 photo on a square board → full width, half height
    expect(fitBoxToBoard(2, 1)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 })
  })

  it('fills the height for a taller photo', () => {
    // a 1:1 photo on a 2:1 board → full height, half width (in normalised units)
    expect(fitBoxToBoard(1, 2)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
  })

  it('keeps the photo undistorted (box real aspect = photo aspect)', () => {
    const board = 0.6
    const b = fitBoxToBoard(1.37, board)
    expect((b.w * board) / b.h).toBeCloseTo(1.37)
    expect(Math.max(b.w, b.h)).toBeCloseTo(1)
  })

  it('leaves the margin clear', () => {
    const b = fitBoxToBoard(1, 1, 0.1)
    expect(b.x).toBeCloseTo(0.1)
    expect(b.y).toBeCloseTo(0.1)
    expect(b.w).toBeCloseTo(0.8)
    expect(b.h).toBeCloseTo(0.8)
  })
})
