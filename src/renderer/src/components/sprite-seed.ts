/**
 * SPRITE SEED — the bundled starter animation the Sprite editor opens with: a
 * pair of blinking eyes sized for the Arduino Modulino LED Matrix (12×8, the
 * same panel as the UNO R4 WiFi). Pure data + a tiny ASCII-art parser so the
 * seed is unit-testable and easy to redraw by hand (mirrors `font-seed`).
 */
import { clampFps, type SpriteDoc, type SpriteFrame } from './sprite-model'

/** Parse one ASCII-art frame: `#` = lit, anything else = off. */
export function parseFrameArt(art: string[], width: number): SpriteFrame {
  return {
    pixels: art.map((row) =>
      Array.from({ length: width }, (_, x) => row[x] === '#')
    )
  }
}

const EYES_OPEN = [
  '............',
  '.####..####.',
  '#....##....#',
  '#.##.##.##.#',
  '#.##.##.##.#',
  '#....##....#',
  '.####..####.',
  '............'
]

const EYES_HALF = [
  '............',
  '............',
  '.####..####.',
  '#....##....#',
  '#.##.##.##.#',
  '#....##....#',
  '.####..####.',
  '............'
]

const EYES_CLOSED = [
  '............',
  '............',
  '............',
  '............',
  '.####..####.',
  '............',
  '............',
  '............'
]

/**
 * The blinking-eyes starter: eyes held open for three frames, then a
 * half → closed → half blink. At 8 fps the eyes rest ~0.4 s between blinks.
 */
export function seedSprite(): SpriteDoc {
  const w = 12
  const arts = [EYES_OPEN, EYES_OPEN, EYES_OPEN, EYES_HALF, EYES_CLOSED, EYES_HALF]
  return {
    name: 'blinking-eyes',
    width: w,
    height: 8,
    depth: 1,
    fps: clampFps(8),
    frames: arts.map((a) => parseFrameArt(a, w))
  }
}
