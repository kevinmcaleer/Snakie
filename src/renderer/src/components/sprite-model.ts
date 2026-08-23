/**
 * SPRITE / ANIMATION MODEL — pure, DOM-free frame + pixel logic for the Sprite
 * editor (launched from the Display instrument). NOTHING here imports React or
 * touches the DOM, so the whole editing model is unit-testable in plain node
 * (mirrors `font-model`, `display-logic`, `buzzer-logic`, …).
 * =============================================================================
 *
 * The model is deliberately plain and predictable — every operation is a PURE
 * function that returns a NEW {@link SpriteDoc}; nothing mutates in place, so
 * undo/redo and React state stay trivial and the invariants below always hold.
 *
 * ── The shape of a sprite ────────────────────────────────────────────────────
 * A {@link SpriteDoc} is ONE pixel size (`width` × `height`) shared by every
 * frame, plus an ordered list of {@link SpriteFrame}s and a global playback
 * rate (`fps`). Today every pixel is 1-bit (`true` = lit); the `depth` field is
 * carried through save/load so higher bit depths can arrive later without a
 * file-format break.
 *
 * Invariants held by every function here:
 *   - `frames.length >= 1` (deleting the last frame leaves one blank frame)
 *   - `frame.pixels.length === height`, `frame.pixels[y].length === width`
 *   - `MIN_SIZE <= width, height <= MAX_SIZE`
 *
 * ── Out-of-range is a no-op, never a throw ───────────────────────────────────
 * The editor pokes at pixels from pointer drags, so every coordinate-taking
 * function CLAMPS or IGNORES rather than throwing; an out-of-range `setPixel`
 * returns the doc unchanged (by reference, so React skips the re-render).
 */

/** One animation frame: a row-major boolean grid, `pixels[y][x]` true = lit. */
export interface SpriteFrame {
  pixels: boolean[][]
}

/** A complete editable sprite animation. */
export interface SpriteDoc {
  /** File-name stem (e.g. `blinking-eyes`). */
  name: string
  /** Pixel width shared by every frame. */
  width: number
  /** Pixel height shared by every frame. */
  height: number
  /** Bits per pixel. Always 1 today; carried for forward compatibility. */
  depth: 1
  /** Playback rate for the whole animation, frames per second. */
  fps: number
  /** The frames, in playback order. Never empty. */
  frames: SpriteFrame[]
}

/** The largest edge the editor will accept (keeps the grid renderable + fast). */
export const MAX_SIZE = 128
/** The smallest edge that still draws something. */
export const MIN_SIZE = 1
/** Playback-rate bounds offered by the editor. */
export const MIN_FPS = 1
export const MAX_FPS = 50

/** Common display sizes offered by the size picker. */
export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '12×8 · Modulino / UNO R4 LED matrix', w: 12, h: 8 },
  { label: '8×8 · LED matrix (MAX7219, HT16K33)', w: 8, h: 8 },
  { label: '16×8 · dual LED matrix', w: 16, h: 8 },
  { label: '16×16 · quad LED matrix', w: 16, h: 16 },
  { label: '5×5 · micro:bit LEDs', w: 5, h: 5 },
  { label: '32×16 · small OLED sprite', w: 32, h: 16 },
  { label: '64×32 · half OLED', w: 64, h: 32 },
  { label: '128×64 · full SSD1306 OLED', w: 128, h: 64 }
]

const clampInt = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)))

/** Clamp an edge to the editor's supported range. */
export const clampSize = (n: number): number => clampInt(n, MIN_SIZE, MAX_SIZE)
/** Clamp a playback rate to the editor's supported range. */
export const clampFps = (n: number): number => clampInt(n, MIN_FPS, MAX_FPS)

/** A blank (all-off) frame of the given size. */
export function blankFrame(width: number, height: number): SpriteFrame {
  return { pixels: Array.from({ length: height }, () => Array<boolean>(width).fill(false)) }
}

/** Deep-copy a frame (rows are cloned so edits can't alias). */
export function cloneFrame(frame: SpriteFrame): SpriteFrame {
  return { pixels: frame.pixels.map((row) => row.slice()) }
}

/** A fresh single-frame document at the given size. */
export function newSprite(name = 'sprite', width = 8, height = 8, fps = 8): SpriteDoc {
  const w = clampSize(width)
  const h = clampSize(height)
  return { name, width: w, height: h, depth: 1, fps: clampFps(fps), frames: [blankFrame(w, h)] }
}

/** True when any pixel in the frame is lit. */
export function frameHasInk(frame: SpriteFrame): boolean {
  return frame.pixels.some((row) => row.some(Boolean))
}

// ── Pixel edits (all scoped to one frame index) ─────────────────────────────

/** Set/clear one pixel of frame `i`. Out-of-range coordinates are a no-op. */
export function setPixel(doc: SpriteDoc, i: number, x: number, y: number, lit: boolean): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return doc
  if (frame.pixels[y][x] === lit) return doc
  const next = cloneFrame(frame)
  next.pixels[y][x] = lit
  return replaceFrame(doc, i, next)
}

/** Flood-fill from `(x, y)` in frame `i` with `lit` (4-connected). */
export function floodFill(
  doc: SpriteDoc,
  i: number,
  x: number,
  y: number,
  lit: boolean
): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return doc
  const target = frame.pixels[y][x]
  if (target === lit) return doc
  const next = cloneFrame(frame)
  const stack: [number, number][] = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop() as [number, number]
    if (cx < 0 || cy < 0 || cx >= doc.width || cy >= doc.height) continue
    if (next.pixels[cy][cx] !== target) continue
    next.pixels[cy][cx] = lit
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  return replaceFrame(doc, i, next)
}

/** Swap lit and unlit across frame `i`. */
export function invertFrame(doc: SpriteDoc, i: number): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame) return doc
  return replaceFrame(doc, i, { pixels: frame.pixels.map((row) => row.map((p) => !p)) })
}

/** Erase frame `i` to all-off. */
export function clearFrame(doc: SpriteDoc, i: number): SpriteDoc {
  if (!doc.frames[i]) return doc
  return replaceFrame(doc, i, blankFrame(doc.width, doc.height))
}

/** Shift frame `i` by (dx, dy); pixels that leave the edge are dropped. */
export function shiftFrame(doc: SpriteDoc, i: number, dx: number, dy: number): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame || (dx === 0 && dy === 0)) return doc
  const next = blankFrame(doc.width, doc.height)
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      const sx = x - dx
      const sy = y - dy
      if (sx >= 0 && sy >= 0 && sx < doc.width && sy < doc.height) {
        next.pixels[y][x] = frame.pixels[sy][sx]
      }
    }
  }
  return replaceFrame(doc, i, next)
}

/** Mirror frame `i` left↔right. */
export function flipFrameH(doc: SpriteDoc, i: number): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame) return doc
  return replaceFrame(doc, i, { pixels: frame.pixels.map((row) => row.slice().reverse()) })
}

/** Mirror frame `i` top↕bottom. */
export function flipFrameV(doc: SpriteDoc, i: number): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame) return doc
  return replaceFrame(doc, i, { pixels: frame.pixels.slice().reverse().map((row) => row.slice()) })
}

function replaceFrame(doc: SpriteDoc, i: number, frame: SpriteFrame): SpriteDoc {
  const frames = doc.frames.slice()
  frames[i] = frame
  return { ...doc, frames }
}

// ── Frame list operations ───────────────────────────────────────────────────

/** Insert a blank frame after index `i` (or at the end for `i` out of range). */
export function addFrame(doc: SpriteDoc, i: number): SpriteDoc {
  const at = doc.frames[i] ? i + 1 : doc.frames.length
  const frames = doc.frames.slice()
  frames.splice(at, 0, blankFrame(doc.width, doc.height))
  return { ...doc, frames }
}

/** Insert a copy of frame `i` right after it. */
export function duplicateFrame(doc: SpriteDoc, i: number): SpriteDoc {
  const frame = doc.frames[i]
  if (!frame) return doc
  const frames = doc.frames.slice()
  frames.splice(i + 1, 0, cloneFrame(frame))
  return { ...doc, frames }
}

/** Remove frame `i`; deleting the only frame leaves one blank frame instead. */
export function deleteFrame(doc: SpriteDoc, i: number): SpriteDoc {
  if (!doc.frames[i]) return doc
  if (doc.frames.length === 1) return clearFrame(doc, 0)
  const frames = doc.frames.slice()
  frames.splice(i, 1)
  return { ...doc, frames }
}

/** Move frame `i` to position `j` (both clamped into range). */
export function moveFrame(doc: SpriteDoc, i: number, j: number): SpriteDoc {
  const from = clampInt(i, 0, doc.frames.length - 1)
  const to = clampInt(j, 0, doc.frames.length - 1)
  if (from === to || !doc.frames[from]) return doc
  const frames = doc.frames.slice()
  const [frame] = frames.splice(from, 1)
  frames.splice(to, 0, frame)
  return { ...doc, frames }
}

// ── Document operations ─────────────────────────────────────────────────────

/**
 * Resize every frame to `width` × `height`, anchored at the top-left: existing
 * pixels keep their coordinates, growth adds unlit pixels, shrink crops.
 */
export function resizeSprite(doc: SpriteDoc, width: number, height: number): SpriteDoc {
  const w = clampSize(width)
  const h = clampSize(height)
  if (w === doc.width && h === doc.height) return doc
  const frames = doc.frames.map((frame) => {
    const next = blankFrame(w, h)
    for (let y = 0; y < Math.min(h, doc.height); y++) {
      for (let x = 0; x < Math.min(w, doc.width); x++) {
        next.pixels[y][x] = frame.pixels[y][x]
      }
    }
    return next
  })
  return { ...doc, width: w, height: h, frames }
}

/** Set the playback rate (clamped). */
export function setFps(doc: SpriteDoc, fps: number): SpriteDoc {
  const next = clampFps(fps)
  return next === doc.fps ? doc : { ...doc, fps: next }
}

/**
 * File-name-safe stem from the sprite's name: lower-case, runs of anything
 * outside `[a-z0-9_-]` collapsed to `-`. Falls back to `sprite`.
 */
export function safeStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stem || 'sprite'
}
