import { describe, expect, it } from 'vitest'
import {
  MAX_SIZE,
  addFrame,
  blankFrame,
  clampFps,
  clampSize,
  clearFrame,
  cloneFrame,
  deleteFrame,
  duplicateFrame,
  flipFrameH,
  flipFrameV,
  floodFill,
  frameHasInk,
  invertFrame,
  moveFrame,
  newSprite,
  resizeSprite,
  safeStem,
  setFps,
  setPixel,
  shiftFrame,
  type SpriteDoc
} from '../src/renderer/src/components/sprite-model'
import { parseFrameArt, seedSprite } from '../src/renderer/src/components/sprite-seed'

const lit = (doc: SpriteDoc, i: number): number =>
  doc.frames[i].pixels.flat().filter(Boolean).length

describe('sprite model', () => {
  it('creates a clamped blank document with one frame', () => {
    const doc = newSprite('Eyes!', 12, 8, 8)
    expect(doc.width).toBe(12)
    expect(doc.height).toBe(8)
    expect(doc.frames).toHaveLength(1)
    expect(frameHasInk(doc.frames[0])).toBe(false)
    expect(newSprite('x', 9999, 0, 999).width).toBe(MAX_SIZE)
    expect(clampSize(0)).toBe(1)
    expect(clampFps(0)).toBe(1)
    expect(clampFps(999)).toBe(50)
  })

  it('setPixel is pure, clamps out-of-range to a no-op, and dedups', () => {
    const doc = newSprite('s', 4, 4)
    const next = setPixel(doc, 0, 1, 2, true)
    expect(next).not.toBe(doc)
    expect(next.frames[0].pixels[2][1]).toBe(true)
    expect(doc.frames[0].pixels[2][1]).toBe(false) // original untouched
    expect(setPixel(next, 0, 1, 2, true)).toBe(next) // same value → same ref
    expect(setPixel(doc, 0, -1, 0, true)).toBe(doc)
    expect(setPixel(doc, 0, 0, 4, true)).toBe(doc)
    expect(setPixel(doc, 5, 0, 0, true)).toBe(doc) // no such frame
  })

  it('floodFill fills 4-connected regions only', () => {
    // A 4×4 with a vertical wall at x=1 dividing left/right.
    let doc = newSprite('s', 4, 4)
    for (let y = 0; y < 4; y++) doc = setPixel(doc, 0, 1, y, true)
    const filled = floodFill(doc, 0, 3, 0, true)
    // Right side (x=2,3) filled; left column x=0 untouched.
    expect(filled.frames[0].pixels[3][3]).toBe(true)
    expect(filled.frames[0].pixels[0][0]).toBe(false)
    // Filling with the value already there is a no-op by reference.
    expect(floodFill(filled, 0, 3, 0, true)).toBe(filled)
  })

  it('shift, flips, invert and clear behave and stay in-bounds', () => {
    let doc = newSprite('s', 3, 3)
    doc = setPixel(doc, 0, 0, 0, true)
    const right = shiftFrame(doc, 0, 1, 0)
    expect(right.frames[0].pixels[0][1]).toBe(true)
    expect(right.frames[0].pixels[0][0]).toBe(false)
    // Shifting off the edge drops the pixel.
    const gone = shiftFrame(right, 0, 2, 0)
    expect(lit(gone, 0)).toBe(0)
    const flipped = flipFrameH(doc, 0)
    expect(flipped.frames[0].pixels[0][2]).toBe(true)
    const vflipped = flipFrameV(doc, 0)
    expect(vflipped.frames[0].pixels[2][0]).toBe(true)
    const inverted = invertFrame(doc, 0)
    expect(lit(inverted, 0)).toBe(8)
    expect(lit(clearFrame(inverted, 0), 0)).toBe(0)
  })

  it('frame list ops: add, duplicate, delete, move — never empty', () => {
    let doc = newSprite('s', 2, 2)
    doc = setPixel(doc, 0, 0, 0, true)
    doc = addFrame(doc, 0) // blank inserted after frame 0
    expect(doc.frames).toHaveLength(2)
    expect(lit(doc, 1)).toBe(0)
    doc = duplicateFrame(doc, 0)
    expect(doc.frames).toHaveLength(3)
    expect(lit(doc, 1)).toBe(1) // the copy lands right after
    doc = moveFrame(doc, 0, 2)
    expect(lit(doc, 2)).toBe(1)
    doc = deleteFrame(doc, 2)
    expect(doc.frames).toHaveLength(2)
    // Deleting the last remaining frame leaves one blank frame.
    doc = deleteFrame(deleteFrame(doc, 0), 0)
    expect(doc.frames).toHaveLength(1)
    expect(lit(doc, 0)).toBe(0)
  })

  it('resize crops/grows anchored top-left across every frame', () => {
    let doc = newSprite('s', 4, 4)
    doc = duplicateFrame(setPixel(doc, 0, 3, 3, true), 0)
    const grown = resizeSprite(doc, 6, 6)
    expect(grown.frames[1].pixels[3][3]).toBe(true)
    const cropped = resizeSprite(grown, 3, 3)
    expect(lit(cropped, 0)).toBe(0)
    expect(cropped.frames.every((f) => f.pixels.length === 3)).toBe(true)
  })

  it('setFps clamps and dedups; cloneFrame does not alias', () => {
    const doc = newSprite('s', 2, 2, 8)
    expect(setFps(doc, 8)).toBe(doc)
    expect(setFps(doc, 500).fps).toBe(50)
    const frame = blankFrame(2, 2)
    const copy = cloneFrame(frame)
    copy.pixels[0][0] = true
    expect(frame.pixels[0][0]).toBe(false)
  })

  it('safeStem produces file-name-safe stems', () => {
    expect(safeStem('Blinking Eyes!')).toBe('blinking-eyes')
    expect(safeStem('   ')).toBe('sprite')
    expect(safeStem('éyès')).toBe('y-s')
  })
})

describe('sprite seed (blinking eyes)', () => {
  it('is a 12×8 Modulino-sized animation with a blink', () => {
    const doc = seedSprite()
    expect(doc.width).toBe(12)
    expect(doc.height).toBe(8)
    expect(doc.frames.length).toBeGreaterThanOrEqual(4)
    expect(doc.frames.every((f) => frameHasInk(f))).toBe(true)
    // The blink actually changes the picture.
    expect(lit(doc, 0)).not.toBe(lit(doc, doc.frames.length - 2))
  })

  it('parseFrameArt maps # to lit and pads short rows', () => {
    const f = parseFrameArt(['#.', '.#'], 2)
    expect(f.pixels).toEqual([
      [true, false],
      [false, true]
    ])
  })
})
