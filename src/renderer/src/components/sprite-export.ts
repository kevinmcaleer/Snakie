/**
 * SPRITE → MICROPYTHON MODULE EXPORT — pure, DOM-free (mirrors `font-export`).
 * =============================================================================
 *
 * Emits a plain `.py` module carrying the animation as `bytes` literals in
 * `framebuf.MONO_HLSB` layout (row-major, MSB = leftmost pixel, rows padded to
 * whole bytes — the same raster PBM P4 and `.spr` use), plus two tiny helpers:
 *
 *  - `frame(i)` wraps frame `i` in a `framebuf.FrameBuffer`, so any framebuf
 *    display (SSD1306 OLED etc.) can `display.blit(frame(i), x, y)`.
 *  - `play(display)` loops the animation on such a display at the sprite's fps.
 *
 * The data is also directly usable pixel-by-pixel (see `pixel(i, x, y)`) for
 * non-framebuf targets like the Arduino Modulino LED Matrix.
 */
import { packFrame, rowStride } from './sprite-codecs'
import { safeStem, type SpriteDoc } from './sprite-model'

/** Python-identifier module name from the sprite's name (e.g. `blinking_eyes`). */
export function pyModuleName(doc: SpriteDoc): string {
  const stem = safeStem(doc.name).replace(/-/g, '_')
  return /^[0-9]/.test(stem) ? `sprite_${stem}` : stem
}

/** The exported file's name, e.g. `blinking_eyes.py`. */
export function pyFilename(doc: SpriteDoc): string {
  return `${pyModuleName(doc)}.py`
}

/** One frame as a Python bytes literal (`b'\x00\x7e…'`). */
function bytesLiteral(bytes: Uint8Array): string {
  let out = "b'"
  for (const b of bytes) out += `\\x${b.toString(16).padStart(2, '0')}`
  return `${out}'`
}

/** Emit the whole animation as a MicroPython module. */
export function exportSpritePy(doc: SpriteDoc): string {
  const stride = rowStride(doc.width)
  const frames = doc.frames
    .map((f) => `    ${bytesLiteral(packFrame(f, doc.width, doc.height))},`)
    .join('\n')
  return `"""${pyModuleName(doc)} — a 1-bit sprite animation drawn in Snakie's Sprite editor.

${doc.width}x${doc.height}, ${doc.frames.length} frame${doc.frames.length === 1 ? '' : 's'} at ${doc.fps} fps.
Each frame is framebuf.MONO_HLSB: row-major, most-significant bit = leftmost
pixel, each row padded to a whole byte (${stride} byte${stride === 1 ? '' : 's'} per row).
"""

import framebuf
import time

WIDTH = ${doc.width}
HEIGHT = ${doc.height}
FPS = ${doc.fps}

FRAMES = (
${frames}
)


def frame(i):
    """Frame i wrapped in a FrameBuffer (blit it onto any framebuf display)."""
    return framebuf.FrameBuffer(bytearray(FRAMES[i]), WIDTH, HEIGHT, framebuf.MONO_HLSB)


def pixel(i, x, y):
    """True when pixel (x, y) of frame i is lit — for non-framebuf displays."""
    row_bytes = (WIDTH + 7) // 8
    return bool(FRAMES[i][y * row_bytes + (x >> 3)] & (0x80 >> (x & 7)))


def play(display, x=0, y=0, loops=None):
    """Loop the animation on a framebuf display (e.g. SSD1306). loops=None = forever."""
    n = 0
    while loops is None or n < loops:
        for i in range(len(FRAMES)):
            display.blit(frame(i), x, y)
            display.show()
            time.sleep_ms(1000 // FPS)
        n += 1
`
}
