import { describe, it, expect } from 'vitest'
import {
  floodFillTransparent,
  removeBackgroundFromEdges,
  type RGBAImage
} from '../src/renderer/src/components/image-bg-remove'

/** Build a w×h RGBA image, painting each pixel via `paint(x, y) → [r,g,b,a]`. */
function makeImage(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { data, width: w, height: h }
}

/** Alpha at (x, y). */
const alphaAt = (img: RGBAImage, x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3]

describe('image background removal (#132)', () => {
  // A 5×5 white board with a solid red 3×3 core in the middle.
  const board = (): RGBAImage =>
    makeImage(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? [220, 20, 20, 255] : [255, 255, 255, 255]))

  it('removeBackgroundFromEdges clears the white border, keeps the red core', () => {
    const img = board()
    const cleared = removeBackgroundFromEdges(img, 32)
    expect(cleared).toBe(16) // the 25-px board minus the 3×3 core = 16 white border px
    expect(alphaAt(img, 0, 0)).toBe(0) // corner gone
    expect(alphaAt(img, 2, 0)).toBe(0) // edge gone
    expect(alphaAt(img, 2, 2)).toBe(255) // red core intact
    expect(alphaAt(img, 1, 1)).toBe(255)
  })

  it('an interior white pocket surrounded by red is NOT reachable from the edges', () => {
    // 5×5 red, white ring of border is red too; only the very centre pixel is white.
    const img = makeImage(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [10, 10, 10, 255]))
    removeBackgroundFromEdges(img, 32)
    expect(alphaAt(img, 2, 2)).toBe(255) // enclosed white survives (silkscreen stays)
  })

  it('floodFillTransparent erases only the contiguous region under the seed', () => {
    // Left half light, right half dark; seed the left → only the left clears.
    const img = makeImage(4, 1, (x) => (x < 2 ? [240, 240, 240, 255] : [20, 20, 20, 255]))
    const cleared = floodFillTransparent(img, [[0, 0]], 30)
    expect(cleared).toBe(2)
    expect(alphaAt(img, 0, 0)).toBe(0)
    expect(alphaAt(img, 1, 0)).toBe(0)
    expect(alphaAt(img, 2, 0)).toBe(255)
  })

  it('tolerance decides what counts as background', () => {
    // A near-white pixel (245) next to the seed (255): within tol=20, outside tol=5.
    const lax = makeImage(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [245, 245, 245, 255]))
    expect(floodFillTransparent(lax, [[0, 0]], 20)).toBe(2) // both cleared
    const strict = makeImage(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [245, 245, 245, 255]))
    expect(floodFillTransparent(strict, [[0, 0]], 5)).toBe(1) // only the seed
  })

  it('an already-transparent seed is a no-op', () => {
    const img = makeImage(2, 1, () => [255, 255, 255, 0])
    expect(floodFillTransparent(img, [[0, 0]], 32)).toBe(0)
  })
})
