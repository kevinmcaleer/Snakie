/**
 * SPRITE FILE CODECS — pure, DOM-free encoders/decoders for the Sprite editor.
 * Everything here works on {@link SpriteDoc}/{@link SpriteFrame} plus plain
 * `Uint8Array`s, so it is unit-testable in node (mirrors `font-export`).
 * =============================================================================
 *
 * ── Why these formats ────────────────────────────────────────────────────────
 * **PBM (P4 binary / P1 ASCII)** is the single-frame interchange format: every
 * image tool reads it, and — the decisive property — a P4 raster is
 * byte-for-byte identical to MicroPython's `framebuf.MONO_HLSB` layout
 * (row-major, MSB = leftmost pixel, each row padded to a byte boundary). A P4
 * file is therefore loadable on-device with one `readinto()` + a `FrameBuffer`
 * wrap and ZERO per-pixel work. Polarity follows the PBM spec (1 = black ink);
 * we treat ink as "lit", which is also what existing MicroPython PBM loaders
 * do when they feed the raster straight into a mono framebuffer.
 *
 * **`.spr` (magic `SNKS`)** is the animation container. Prior art either ships
 * raw headerless dumps with the geometry hardcoded in code (PicoGraphics v1
 * `.rgb332`, Thumby `.bin`, Badger images) or full PNG/GIF needing C decoders
 * (PicoGraphics 2 / Badgeware). `.spr` fills the gap: a fixed 16-byte
 * little-endian header + Thumby-style concatenated frames, so an animation is
 * self-describing yet parseable in ~20 lines of MicroPython, streaming frames
 * from flash through ONE reusable frame buffer (RAM cost = a single frame,
 * however long the animation).
 *
 *   offset size  field
 *   0      4     magic       "SNKS"
 *   4      1     version     1
 *   5      1     flags       bit0: per-frame duration table follows the header
 *                            bit2: loop
 *   6      1     format      0 = MONO_HLSB (1-bit; the only format written
 *                            today — the byte exists so 2/4/8/16-bit formats
 *                            mirroring framebuf's constants can arrive without
 *                            a version break)
 *   7      1     reserved    0
 *   8      2     width       u16 LE
 *   10     2     height      u16 LE
 *   12     2     frame_count u16 LE
 *   14     2     duration_ms u16 LE (per frame; the default when bit0 is set)
 *   16     …     [durations] u16 LE × frame_count   (only if flags bit0)
 *          …     frames      frame_count × stride·height bytes, MONO_HLSB,
 *                            stride = ceil(width / 8) (PBM-style padded rows)
 */

import {
  MAX_SIZE,
  clampFps,
  blankFrame,
  type SpriteDoc,
  type SpriteFrame
} from './sprite-model'

/** The `.spr` magic bytes — "SNKS" (Snakie Sprite). */
export const SPR_MAGIC = 'SNKS'
/** The `.spr` version this codec reads and writes. */
export const SPR_VERSION = 1
/** `flags` bit0 — a u16 per-frame duration table follows the header. */
export const SPR_FLAG_DURATIONS = 0x01
/** `flags` bit2 — the animation is meant to loop. */
export const SPR_FLAG_LOOP = 0x04
/** `format` 0 — 1-bit MONO_HLSB (the only format written today). */
export const SPR_FORMAT_MONO_HLSB = 0

/** Bytes per packed row: width bits padded up to a whole byte (PBM/HLSB rule). */
export const rowStride = (width: number): number => Math.ceil(width / 8)

// ── Bit packing (MONO_HLSB ⇄ boolean grid) ──────────────────────────────────

/** Pack one frame to MONO_HLSB bytes (MSB = leftmost pixel, padded rows). */
export function packFrame(frame: SpriteFrame, width: number, height: number): Uint8Array {
  const stride = rowStride(width)
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (frame.pixels[y]?.[x]) out[y * stride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}

/** Unpack MONO_HLSB bytes back to a frame. `bytes` must hold stride·height. */
export function unpackFrame(bytes: Uint8Array, width: number, height: number): SpriteFrame {
  const stride = rowStride(width)
  const frame = blankFrame(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      frame.pixels[y][x] = (bytes[y * stride + (x >> 3)] & (0x80 >> (x & 7))) !== 0
    }
  }
  return frame
}

// ── PBM ─────────────────────────────────────────────────────────────────────

/** Encode one frame as binary PBM (P4). Lit pixels are PBM ink (1/black). */
export function encodePbm(frame: SpriteFrame, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P4\n# Snakie sprite frame\n${width} ${height}\n`)
  const raster = packFrame(frame, width, height)
  const out = new Uint8Array(header.length + raster.length)
  out.set(header, 0)
  out.set(raster, header.length)
  return out
}

/** Encode one frame as ASCII PBM (P1) — handy for putting a frame in a doc. */
export function encodePbmAscii(frame: SpriteFrame, width: number, height: number): Uint8Array {
  const rows = frame.pixels
    .slice(0, height)
    .map((row) =>
      row
        .slice(0, width)
        .map((p) => (p ? '1' : '0'))
        .join(' ')
    )
    .join('\n')
  return new TextEncoder().encode(`P1\n${width} ${height}\n${rows}\n`)
}

/**
 * Decode a PBM file (P1 or P4) to a single frame. Throws with a readable
 * message on anything malformed or larger than the editor supports.
 */
export function decodePbm(bytes: Uint8Array): { width: number; height: number; frame: SpriteFrame } {
  // Parse the header byte-wise: magic, then two ASCII decimals, `#` comments
  // allowed between tokens, a single whitespace after the height, then raster.
  let pos = 0
  const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12
  const skip = (): void => {
    for (;;) {
      while (pos < bytes.length && isSpace(bytes[pos])) pos++
      if (bytes[pos] === 35 /* # */) {
        while (pos < bytes.length && bytes[pos] !== 10) pos++
      } else {
        return
      }
    }
  }
  const token = (): string => {
    skip()
    const start = pos
    while (pos < bytes.length && !isSpace(bytes[pos]) && bytes[pos] !== 35) pos++
    return new TextDecoder().decode(bytes.subarray(start, pos))
  }

  const magic = token()
  if (magic !== 'P1' && magic !== 'P4') throw new Error('Not a PBM file (expected P1 or P4).')
  const width = Number(token())
  const height = Number(token())
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('PBM header has an invalid width/height.')
  }
  if (width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`PBM is ${width}×${height} — the editor supports up to ${MAX_SIZE}×${MAX_SIZE}.`)
  }

  if (magic === 'P4') {
    pos++ // exactly ONE whitespace separates the header from the raster
    const stride = rowStride(width)
    const raster = bytes.subarray(pos, pos + stride * height)
    if (raster.length < stride * height) throw new Error('PBM raster is truncated.')
    return { width, height, frame: unpackFrame(raster, width, height) }
  }

  // P1: ASCII 1/0 per pixel, whitespace (and comments) anywhere between digits.
  const frame = blankFrame(width, height)
  for (let i = 0; i < width * height; i++) {
    skip()
    const c = bytes[pos++]
    if (c !== 48 && c !== 49) throw new Error('PBM (P1) raster has a non-0/1 character.')
    frame.pixels[Math.floor(i / width)][i % width] = c === 49
  }
  return { width, height, frame }
}

// ── .spr (SNKS) container ───────────────────────────────────────────────────

/** Per-frame duration for the doc's global fps, clamped into u16. */
export const frameDurationMs = (fps: number): number =>
  Math.max(1, Math.min(0xffff, Math.round(1000 / clampFps(fps))))

/** Encode a whole animation as a `.spr` (SNKS v1, MONO_HLSB, looping). */
export function encodeSpr(doc: SpriteDoc): Uint8Array {
  const stride = rowStride(doc.width)
  const frameSize = stride * doc.height
  const out = new Uint8Array(16 + frameSize * doc.frames.length)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode(SPR_MAGIC), 0)
  out[4] = SPR_VERSION
  out[5] = SPR_FLAG_LOOP
  out[6] = SPR_FORMAT_MONO_HLSB
  out[7] = 0
  view.setUint16(8, doc.width, true)
  view.setUint16(10, doc.height, true)
  view.setUint16(12, doc.frames.length, true)
  view.setUint16(14, frameDurationMs(doc.fps), true)
  doc.frames.forEach((frame, i) => {
    out.set(packFrame(frame, doc.width, doc.height), 16 + i * frameSize)
  })
  return out
}

/** Everything a decoded `.spr` carries (durations normalised to per-frame ms). */
export interface DecodedSpr {
  width: number
  height: number
  loop: boolean
  /** Per-frame durations in ms (the global default expanded when no table). */
  durations: number[]
  frames: SpriteFrame[]
}

/** Decode a `.spr` (SNKS v1) animation. Throws readable errors on bad input. */
export function decodeSpr(bytes: Uint8Array): DecodedSpr {
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 4)) !== SPR_MAGIC) {
    throw new Error('Not a Snakie sprite (.spr) file.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = bytes[4]
  if (version !== SPR_VERSION) throw new Error(`Unsupported .spr version ${version}.`)
  const flags = bytes[5]
  const format = bytes[6]
  if (format !== SPR_FORMAT_MONO_HLSB) {
    throw new Error(`Unsupported .spr pixel format ${format} (only 1-bit is supported today).`)
  }
  const width = view.getUint16(8, true)
  const height = view.getUint16(10, true)
  const count = view.getUint16(12, true)
  const defaultMs = view.getUint16(14, true)
  if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error(`.spr is ${width}×${height} — the editor supports up to ${MAX_SIZE}×${MAX_SIZE}.`)
  }
  if (count < 1) throw new Error('.spr has no frames.')

  let pos = 16
  const durations: number[] = []
  if (flags & SPR_FLAG_DURATIONS) {
    if (bytes.length < pos + count * 2) throw new Error('.spr duration table is truncated.')
    for (let i = 0; i < count; i++) {
      durations.push(view.getUint16(pos, true) || defaultMs || 100)
      pos += 2
    }
  } else {
    for (let i = 0; i < count; i++) durations.push(defaultMs || 100)
  }

  const stride = rowStride(width)
  const frameSize = stride * height
  if (bytes.length < pos + frameSize * count) throw new Error('.spr frame data is truncated.')
  const frames: SpriteFrame[] = []
  for (let i = 0; i < count; i++) {
    frames.push(unpackFrame(bytes.subarray(pos + i * frameSize), width, height))
  }
  return { width, height, loop: (flags & SPR_FLAG_LOOP) !== 0, durations, frames }
}

// ── JSON draft form ─────────────────────────────────────────────────────────
// Compact, human-diffable serialisation used for the editor's parked draft
// (localStorage): frames as row-strings of `1`/`0`. Not a device format.

/** Serialisable draft shape (rows as `"0110…"` strings). */
export interface SpriteJson {
  name: string
  width: number
  height: number
  depth: 1
  fps: number
  frames: string[][]
}

/** Doc → compact JSON-safe object. */
export function docToJson(doc: SpriteDoc): SpriteJson {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    depth: 1,
    fps: doc.fps,
    frames: doc.frames.map((f) => f.pixels.map((row) => row.map((p) => (p ? '1' : '0')).join('')))
  }
}

/** Parse a draft back to a doc; null on anything malformed (draft = best effort). */
export function docFromJson(raw: unknown): SpriteDoc | null {
  const j = raw as Partial<SpriteJson> | null
  if (!j || typeof j !== 'object') return null
  const { name, width, height, fps, frames } = j
  if (
    typeof name !== 'string' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    typeof fps !== 'number' ||
    !Array.isArray(frames) ||
    frames.length < 1 ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > MAX_SIZE ||
    (height as number) > MAX_SIZE
  ) {
    return null
  }
  const w = width as number
  const h = height as number
  const out: SpriteFrame[] = []
  for (const rows of frames) {
    if (!Array.isArray(rows) || rows.length !== h) return null
    const frame = blankFrame(w, h)
    for (let y = 0; y < h; y++) {
      if (typeof rows[y] !== 'string' || rows[y].length !== w) return null
      for (let x = 0; x < w; x++) frame.pixels[y][x] = rows[y][x] === '1'
    }
    out.push(frame)
  }
  return { name, width: w, height: h, depth: 1, fps: clampFps(fps), frames: out }
}

/** Fold a decoded `.spr` into an editable doc (durations → one global fps). */
export function sprToDoc(name: string, spr: DecodedSpr): SpriteDoc {
  const avg = spr.durations.reduce((a, b) => a + b, 0) / spr.durations.length
  return {
    name,
    width: spr.width,
    height: spr.height,
    depth: 1,
    fps: clampFps(Math.round(1000 / Math.max(1, avg))),
    frames: spr.frames
  }
}
