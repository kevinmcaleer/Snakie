/**
 * Crop + zoom-to-fit for the Part Editor's board photo.
 * =============================================================================
 * Imported product photos usually arrive with a wide white margin, a second
 * copy of the part, a ruler… The crop tool lets you drag a box over the photo
 * and keep only that, and "Zoom to fit" then trims any transparent margin left
 * by background removal and scales the photo to fill the board outline.
 *
 * Pure geometry + pixel ops (like `image-bg-remove.ts`) so they're unit-testable
 * without a DOM canvas. Board coordinates are NORMALISED: 0..1 across the board
 * outline in each axis, so a box's real aspect is `w * boardAspect / h`.
 */
import type { RGBAImage } from './image-bg-remove'

/** A whole-pixel rectangle inside an image. */
export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/** A box in normalised board coordinates (the shape of an image layer). */
export interface NormBox {
  x: number
  y: number
  w: number
  h: number
}

/** Two corners of a dragged selection, normalised board coords, any order. */
export interface NormSelection {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Map a selection dragged on the canvas onto the photo. Returns the pixels to
 * keep and the box those pixels occupy on the board (snapped to whole pixels, so
 * the kept part of the photo doesn't shift when it's cropped), or null when the
 * selection misses the photo or covers less than 2×2 pixels of it.
 */
export function cropFromSelection(
  layer: NormBox,
  sel: NormSelection,
  imgW: number,
  imgH: number
): { px: PixelRect; box: NormBox } | null {
  if (!(layer.w > 0) || !(layer.h > 0) || imgW < 1 || imgH < 1) return null
  const x0 = Math.max(layer.x, Math.min(sel.x0, sel.x1))
  const x1 = Math.min(layer.x + layer.w, Math.max(sel.x0, sel.x1))
  const y0 = Math.max(layer.y, Math.min(sel.y0, sel.y1))
  const y1 = Math.min(layer.y + layer.h, Math.max(sel.y0, sel.y1))
  if (x1 <= x0 || y1 <= y0) return null
  const clampPx = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  const px0 = clampPx(Math.floor(((x0 - layer.x) / layer.w) * imgW), imgW)
  const px1 = clampPx(Math.ceil(((x1 - layer.x) / layer.w) * imgW), imgW)
  const py0 = clampPx(Math.floor(((y0 - layer.y) / layer.h) * imgH), imgH)
  const py1 = clampPx(Math.ceil(((y1 - layer.y) / layer.h) * imgH), imgH)
  const w = px1 - px0
  const h = py1 - py0
  if (w < 2 || h < 2) return null
  return {
    px: { x: px0, y: py0, w, h },
    box: {
      x: layer.x + (px0 / imgW) * layer.w,
      y: layer.y + (py0 / imgH) * layer.h,
      w: (w / imgW) * layer.w,
      h: (h / imgH) * layer.h
    }
  }
}

/** Copy a rectangle of pixels out into a new image (the input is untouched). */
export function cropPixels(img: RGBAImage, r: PixelRect): RGBAImage {
  const x0 = Math.max(0, Math.min(img.width, Math.round(r.x)))
  const y0 = Math.max(0, Math.min(img.height, Math.round(r.y)))
  const w = Math.max(0, Math.min(img.width - x0, Math.round(r.w)))
  const h = Math.max(0, Math.min(img.height - y0, Math.round(r.h)))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4
    data.set(img.data.subarray(src, src + w * 4), y * w * 4)
  }
  return { data, width: w, height: h }
}

/**
 * The bounding box of the pixels that aren't (nearly) transparent, or null when
 * the whole image is. `alphaMin` ignores the faint fringe a flood fill can leave.
 */
export function opaqueBounds(img: RGBAImage, alphaMin = 8): PixelRect | null {
  const { data, width, height } = img
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    let row = y * width * 4
    for (let x = 0; x < width; x++, row += 4) {
      if (data[row + 3] < alphaMin) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * The largest box an image of pixel aspect `imgAspect` (w/h) can fill inside the
 * board outline without distorting, centred. `boardAspect` is the outline's real
 * w/h; `margin` is a fraction of the board kept clear on every side.
 */
export function fitBoxToBoard(imgAspect: number, boardAspect: number, margin = 0): NormBox {
  const span = Math.max(0.01, 1 - 2 * margin)
  if (!(imgAspect > 0) || !(boardAspect > 0)) return { x: margin, y: margin, w: span, h: span }
  // A box (w, h) in normalised units has real aspect w·boardAspect/h.
  let w: number
  let h: number
  if (imgAspect >= boardAspect) {
    w = span
    h = (w * boardAspect) / imgAspect
  } else {
    h = span
    w = (h * imgAspect) / boardAspect
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}
