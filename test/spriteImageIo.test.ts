import { describe, expect, it } from 'vitest'
import {
  detectPixelScale,
  downscaleFrames,
  invertFrames,
  mostlyLit,
  rasterToSprite,
  thresholdRgba,
  mimeForFile,
  type RgbaFrame
} from '../src/renderer/src/components/sprite-image-io'
import type { SpriteFrame } from '../src/renderer/src/components/sprite-model'

/** Build an RGBA frame from rows of `#` (black ink) / `.` (white) / ` ` (transparent). */
function rgba(rows: string[]): RgbaFrame {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8Array(width * height * 4)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const c = row[x]
      const v = c === '#' ? 0 : 255
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = c === ' ' ? 0 : 255
    }
  })
  return { width, height, data }
}

const grid = (f: SpriteFrame): string[] =>
  f.pixels.map((row) => row.map((p) => (p ? '#' : '.')).join(''))

describe('thresholding + polarity', () => {
  it('marks opaque dark pixels as ink; transparent is off', () => {
    const f = thresholdRgba(rgba(['#. ', '.#.']))
    expect(grid(f)).toEqual(['#..', '.#.'])
  })

  it('mostlyLit flips a bright-on-black sprite back to sparse ink', () => {
    // 1 dark pixel on a white ground = sparse ink → stays as-is.
    const sparse = [thresholdRgba(rgba(['#..', '...']))]
    expect(mostlyLit(sparse)).toBe(false)
    // Dark ground + 1 bright pixel = mostly "ink" → invert to recover the sprite.
    const dense = [thresholdRgba(rgba(['.##', '###']))]
    expect(mostlyLit(dense)).toBe(true)
    expect(grid(invertFrames(dense)[0])).toEqual(['#..', '...'])
  })
})

describe('integer-upscale detection', () => {
  const art = ['#.', '.#']
  const scaled = (s: number): SpriteFrame => ({
    pixels: Array.from({ length: 2 * s }, (_, y) =>
      Array.from({ length: 2 * s }, (_, x) => art[Math.floor(y / s)][Math.floor(x / s)] === '#')
    )
  })

  it('finds the true grid under a uniform ×8 upscale', () => {
    const frames = [scaled(8)]
    expect(detectPixelScale(frames, 16, 16)).toBe(8)
    const folded = downscaleFrames(frames, 16, 16, 8)
    expect(folded.width).toBe(2)
    expect(grid(folded.frames[0])).toEqual(art)
  })

  it('reports 1 for true-size pixel art', () => {
    expect(detectPixelScale([scaled(1)], 2, 2)).toBe(1)
  })

  it('a single stray pixel defeats the scale (no false folding)', () => {
    const frames = [scaled(4)]
    frames[0].pixels[0][5] = true // breaks the (all-off) top-right 4×4 block
    expect(detectPixelScale(frames, 8, 8)).toBe(1)
  })

  it('rasterToSprite composes threshold + polarity + descale + durations', () => {
    // A ×2-upscaled 2×2 checker, dark-on-light, with a 40 ms duration.
    const raw = rgba(['##..', '##..', '..##', '..##'])
    raw.durationMs = 40
    const out = rasterToSprite([raw])
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(grid(out.frames[0])).toEqual(['#.', '.#'])
    expect(out.durations).toEqual([40])
    expect(() => rasterToSprite([])).toThrow(/no frames/)
  })
})

describe('mimeForFile', () => {
  it('maps the supported extensions and rejects others', () => {
    expect(mimeForFile('a.PNG')).toBe('image/png')
    expect(mimeForFile('a.jpeg')).toBe('image/jpeg')
    expect(mimeForFile('a.jpg')).toBe('image/jpeg')
    expect(mimeForFile('a.gif')).toBe('image/gif')
    expect(mimeForFile('a.webp')).toBeNull()
  })
})
