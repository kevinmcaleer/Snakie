/**
 * Background removal for the Part Editor's board photo (#132 follow-up).
 * =============================================================================
 * Pure pixel ops over a minimal RGBA buffer so they're unit-testable without a
 * DOM canvas. The editor wraps these: load the image → `getImageData` → mutate
 * here → `putImageData` → `toDataURL`.
 *
 * Both entry points are magic-wand flood fills: a candidate pixel is compared to
 * the SEED colour (not its neighbour), so soft gradients don't creep the fill,
 * and only pixels CONNECTED to a seed are cleared — so an interior white
 * silkscreen survives while the connected border background is knocked out.
 */

/** The subset of `ImageData` these functions need (so tests can pass a literal). */
export interface RGBAImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Euclidean RGB distance (0..~441) between pixel `i` and a reference colour. */
function colourDist(data: Uint8ClampedArray, i: number, r: number, g: number, b: number): number {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * Flood-fill from each seed, setting alpha → 0 on the contiguous run of pixels
 * whose colour is within `tolerance` of THAT seed's colour. Returns the number
 * of pixels cleared. Seeds already transparent (or off-image) are skipped.
 */
export function floodFillTransparent(img: RGBAImage, seeds: Array<[number, number]>, tolerance: number): number {
  const { data, width, height } = img
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  let cleared = 0
  for (const [sx, sy] of seeds) {
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
    const seedIdx = (sy * width + sx) * 4
    if (data[seedIdx + 3] === 0) continue // seed is already transparent
    const r = data[seedIdx]
    const g = data[seedIdx + 1]
    const b = data[seedIdx + 2]
    stack.push(sy * width + sx)
    while (stack.length) {
      const p = stack.pop() as number
      if (visited[p]) continue
      visited[p] = 1
      const idx = p * 4
      if (data[idx + 3] === 0) continue // don't cross an already-clear region
      if (colourDist(data, idx, r, g, b) > tolerance) continue
      data[idx + 3] = 0
      cleared++
      const x = p % width
      const y = (p / width) | 0
      if (x > 0) stack.push(p - 1)
      if (x < width - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - width)
      if (y < height - 1) stack.push(p + width)
    }
  }
  return cleared
}

/**
 * Auto: seed from the four corners + the four edge midpoints and flood-fill the
 * connected border background to transparent. Interior regions that a seed can't
 * reach (e.g. white silkscreen surrounded by the PCB) are left intact.
 */
export function removeBackgroundFromEdges(img: RGBAImage, tolerance: number): number {
  const w = img.width
  const h = img.height
  const mx = (w / 2) | 0
  const my = (h / 2) | 0
  const seeds: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [mx, 0],
    [mx, h - 1],
    [0, my],
    [w - 1, my]
  ]
  return floodFillTransparent(img, seeds, tolerance)
}
