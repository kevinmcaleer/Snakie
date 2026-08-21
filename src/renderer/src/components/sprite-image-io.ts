/**
 * SPRITE ⇄ IMAGE I/O — PNG / JPEG / GIF interchange for the Sprite editor.
 * =============================================================================
 *
 * The pure halves (thresholding a decoded RGBA buffer to 1-bit, the polarity
 * heuristic, integer-upscale detection) live at the top and are node-testable.
 * The DOM halves (decoding files via `createImageBitmap` / WebCodecs
 * `ImageDecoder`, encoding via `OffscreenCanvas` + `gifenc`) live below and only
 * touch browser APIs at call time.
 *
 * ── Polarity ────────────────────────────────────────────────────────────────
 * A sprite drawn for paper (black ink on white) and one drawn for an LED panel
 * (white pixels on black) are inverses of each other. We threshold dark+opaque
 * pixels as "ink" first, then — if that lights more than half of all pixels
 * across the animation — flip polarity, on the assumption that a mostly-lit
 * result really means a dark background. The editor's Invert tool fixes the
 * rare miss.
 *
 * ── Integer upscales ────────────────────────────────────────────────────────
 * Pixel art is often shared scaled up (a 12×8 sprite exported at ×10). On
 * import we look for the largest integer scale that divides both edges AND
 * leaves every scale×scale block uniform in every frame, and fold it back down,
 * so a ×10 GIF round-trips to the true 12×8 grid.
 */
import { GIFEncoder } from 'gifenc'
import { MAX_SIZE, blankFrame, type SpriteDoc, type SpriteFrame } from './sprite-model'
import { frameDurationMs } from './sprite-codecs'

// ── Pure: threshold, polarity, descale ──────────────────────────────────────

/** One decoded raster frame: RGBA bytes (4 per pixel, row-major). */
export interface RgbaFrame {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
  /** Frame display time in ms (0/undefined → the caller's default). */
  durationMs?: number
}

/** Threshold one RGBA frame: ink = opaque and dark (luminance < 128). */
export function thresholdRgba(frame: RgbaFrame): SpriteFrame {
  const { width, height, data } = frame
  const out = blankFrame(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const a = data[o + 3]
      const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
      out.pixels[y][x] = a >= 128 && lum < 128
    }
  }
  return out
}

/** True when more than half of all pixels across the frames are lit. */
export function mostlyLit(frames: SpriteFrame[]): boolean {
  let lit = 0
  let total = 0
  for (const f of frames) {
    for (const row of f.pixels) {
      for (const p of row) {
        total++
        if (p) lit++
      }
    }
  }
  return total > 0 && lit * 2 > total
}

/** Invert every frame (returns new frames). */
export function invertFrames(frames: SpriteFrame[]): SpriteFrame[] {
  return frames.map((f) => ({ pixels: f.pixels.map((row) => row.map((p) => !p)) }))
}

/**
 * The largest integer scale `s` (≤ `maxScale`) dividing both edges such that
 * every `s×s` block is uniform in EVERY frame — 1 when the image is true-size.
 */
export function detectPixelScale(
  frames: SpriteFrame[],
  width: number,
  height: number,
  maxScale = 32
): number {
  const uniformAt = (s: number): boolean =>
    frames.every((f) => {
      for (let by = 0; by < height / s; by++) {
        for (let bx = 0; bx < width / s; bx++) {
          const v = f.pixels[by * s][bx * s]
          for (let y = by * s; y < (by + 1) * s; y++) {
            for (let x = bx * s; x < (bx + 1) * s; x++) {
              if (f.pixels[y][x] !== v) return false
            }
          }
        }
      }
      return true
    })
  for (let s = Math.min(maxScale, width, height); s >= 2; s--) {
    if (width % s === 0 && height % s === 0 && uniformAt(s)) return s
  }
  return 1
}

/** Fold frames down by an integer scale (sampling each block's top-left). */
export function downscaleFrames(
  frames: SpriteFrame[],
  width: number,
  height: number,
  s: number
): { frames: SpriteFrame[]; width: number; height: number } {
  if (s <= 1) return { frames, width, height }
  const w = width / s
  const h = height / s
  return {
    width: w,
    height: h,
    frames: frames.map((f) => {
      const out = blankFrame(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) out.pixels[y][x] = f.pixels[y * s][x * s]
      }
      return out
    })
  }
}

/** Threshold + polarity + descale a decoded raster animation to 1-bit frames. */
export function rasterToSprite(raw: RgbaFrame[]): {
  width: number
  height: number
  frames: SpriteFrame[]
  durations: number[]
} {
  if (raw.length === 0) throw new Error('The image decoded to no frames.')
  let frames = raw.map(thresholdRgba)
  if (mostlyLit(frames)) frames = invertFrames(frames)
  const s = detectPixelScale(frames, raw[0].width, raw[0].height)
  const folded = downscaleFrames(frames, raw[0].width, raw[0].height, s)
  if (folded.width > MAX_SIZE || folded.height > MAX_SIZE) {
    throw new Error(
      `The image is ${folded.width}×${folded.height} — the editor supports up to ${MAX_SIZE}×${MAX_SIZE}.`
    )
  }
  return {
    width: folded.width,
    height: folded.height,
    frames: folded.frames,
    durations: raw.map((f) => f.durationMs || 100)
  }
}

// ── DOM: decoding image files ───────────────────────────────────────────────

// WebCodecs ImageDecoder — in Chromium (Electron + the web build) but not in the
// ES2020 DOM lib this project compiles against, so declare the slice we use
// (the MediaStreamTrackProcessor pattern from robot-video.ts).
interface DecodedVideoFrame {
  displayWidth: number
  displayHeight: number
  duration: number | null
  close(): void
}
interface ImageTrack {
  frameCount: number
}
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: ImageTrack | null }
  decode(opts: { frameIndex: number }): Promise<{ image: DecodedVideoFrame }>
  close(): void
}
declare const ImageDecoder:
  | (new (init: { data: BufferSource; type: string }) => ImageDecoderLike)
  | undefined

/** Rasterise a decoded frame through a 2D canvas (always yields RGBA). */
function frameToRgba(src: CanvasImageSource, w: number, h: number, durationMs?: number): RgbaFrame {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not create a canvas to decode the image.')
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  return { width: w, height: h, data: img.data, durationMs }
}

/**
 * Decode an image file's bytes to raw RGBA frames. Animated GIFs decode every
 * frame (with per-frame durations) via WebCodecs where available; everything
 * else (PNG/JPEG/single-frame GIF fallback) decodes one frame.
 */
export async function decodeImageFile(bytes: Uint8Array, mime: string): Promise<RgbaFrame[]> {
  if (mime === 'image/gif' && typeof ImageDecoder !== 'undefined') {
    const decoder = new ImageDecoder({ data: bytes as unknown as BufferSource, type: mime })
    try {
      await decoder.tracks.ready
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1
      const frames: RgbaFrame[] = []
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        const durationMs = image.duration ? Math.round(image.duration / 1000) : undefined
        frames.push(
          frameToRgba(
            image as unknown as CanvasImageSource,
            image.displayWidth,
            image.displayHeight,
            durationMs
          )
        )
        image.close()
      }
      return frames
    } finally {
      decoder.close()
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  try {
    return [frameToRgba(bitmap, bitmap.width, bitmap.height)]
  } finally {
    bitmap.close()
  }
}

/** Best-guess MIME type from a file name (import filters keep this short). */
export function mimeForFile(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  return null
}

// ── DOM: encoding image files ───────────────────────────────────────────────

/** Lit / unlit export colours — white pixels on black, the LED-panel look. */
const LIT: [number, number, number] = [255, 255, 255]
const OFF: [number, number, number] = [0, 0, 0]

/** Draw one frame onto a fresh canvas at an integer scale. */
function drawFrame(frame: SpriteFrame, w: number, h: number, scale: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(w * scale, h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a canvas to render the sprite.')
  ctx.fillStyle = `rgb(${OFF.join(',')})`
  ctx.fillRect(0, 0, w * scale, h * scale)
  ctx.fillStyle = `rgb(${LIT.join(',')})`
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (frame.pixels[y]?.[x]) ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
  return canvas
}

async function canvasBytes(canvas: OffscreenCanvas, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Encode ONE frame as a PNG at an integer scale (1 = true size, round-trips). */
export function encodePngFrame(doc: SpriteDoc, i: number, scale = 1): Promise<Uint8Array> {
  return canvasBytes(drawFrame(doc.frames[i], doc.width, doc.height, scale), 'image/png')
}

/** Encode ONE frame as a JPEG at an integer scale. */
export function encodeJpegFrame(doc: SpriteDoc, i: number, scale = 1): Promise<Uint8Array> {
  return canvasBytes(drawFrame(doc.frames[i], doc.width, doc.height, scale), 'image/jpeg', 0.92)
}

/** Encode every frame side-by-side as a horizontal PNG sprite sheet. */
export async function encodePngSheet(doc: SpriteDoc, scale = 1): Promise<Uint8Array> {
  const w = doc.width * scale
  const canvas = new OffscreenCanvas(w * doc.frames.length, doc.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a canvas to render the sprite sheet.')
  doc.frames.forEach((frame, i) => {
    ctx.drawImage(drawFrame(frame, doc.width, doc.height, scale), i * w, 0)
  })
  return canvasBytes(canvas, 'image/png')
}

/** Encode the whole animation as a looping animated GIF at an integer scale. */
export function encodeGif(doc: SpriteDoc, scale = 1): Uint8Array {
  const gif = GIFEncoder()
  const w = doc.width * scale
  const h = doc.height * scale
  const delay = frameDurationMs(doc.fps)
  // A fixed 2-colour palette (off, lit) — quantise() on the first frame would
  // yield a 1-entry palette for an all-off frame and desync indices after it.
  const palette: number[][] = [OFF, LIT]
  for (const frame of doc.frames) {
    const index = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        index[y * w + x] = frame.pixels[Math.floor(y / scale)]?.[Math.floor(x / scale)] ? 1 : 0
      }
    }
    gif.writeFrame(index, w, h, { palette, delay, repeat: 0 })
  }
  gif.finish()
  return gif.bytes()
}
