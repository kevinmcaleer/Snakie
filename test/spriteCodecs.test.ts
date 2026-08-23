import { describe, expect, it } from 'vitest'
import {
  SPR_FLAG_DURATIONS,
  SPR_FLAG_LOOP,
  decodePbm,
  decodeSpr,
  docFromJson,
  docToJson,
  encodePbm,
  encodePbmAscii,
  encodeSpr,
  frameDurationMs,
  packFrame,
  rowStride,
  sprToDoc,
  unpackFrame
} from '../src/renderer/src/components/sprite-codecs'
import { newSprite, setPixel, type SpriteDoc } from '../src/renderer/src/components/sprite-model'
import { seedSprite } from '../src/renderer/src/components/sprite-seed'

/** A little 12×8 doc with an asymmetric pattern (non-multiple-of-8 width). */
function sampleDoc(): SpriteDoc {
  let doc = newSprite('sample', 12, 8, 10)
  doc = setPixel(doc, 0, 0, 0, true)
  doc = setPixel(doc, 0, 11, 0, true) // last pixel of the padded row
  doc = setPixel(doc, 0, 5, 3, true)
  doc = setPixel(doc, 0, 8, 7, true) // second byte of the row
  return doc
}

describe('MONO_HLSB packing', () => {
  it('strides rows to whole bytes, MSB = leftmost', () => {
    expect(rowStride(8)).toBe(1)
    expect(rowStride(12)).toBe(2)
    expect(rowStride(128)).toBe(16)
    const doc = sampleDoc()
    const packed = packFrame(doc.frames[0], 12, 8)
    expect(packed).toHaveLength(16)
    expect(packed[0]).toBe(0x80) // (0,0) → bit 7 of byte 0
    expect(packed[1]).toBe(0x10) // (11,0) → bit 4 of byte 1
    const back = unpackFrame(packed, 12, 8)
    expect(back.pixels).toEqual(doc.frames[0].pixels)
  })
})

describe('PBM codec', () => {
  it('round-trips P4 (binary) exactly', () => {
    const doc = sampleDoc()
    const pbm = encodePbm(doc.frames[0], 12, 8)
    const text = new TextDecoder().decode(pbm.subarray(0, 8))
    expect(text.startsWith('P4\n')).toBe(true)
    const { width, height, frame } = decodePbm(pbm)
    expect(width).toBe(12)
    expect(height).toBe(8)
    expect(frame.pixels).toEqual(doc.frames[0].pixels)
  })

  it('round-trips P1 (ASCII) and tolerates comments/whitespace', () => {
    const doc = sampleDoc()
    const { frame } = decodePbm(encodePbmAscii(doc.frames[0], 12, 8))
    expect(frame.pixels).toEqual(doc.frames[0].pixels)
    const wild = new TextEncoder().encode('P1 # c\n# another\n 2 \t2\n1 0\n0 1\n')
    const parsed = decodePbm(wild)
    expect(parsed.width).toBe(2)
    expect(parsed.frame.pixels).toEqual([
      [true, false],
      [false, true]
    ])
  })

  it('rejects malformed and oversized files with readable errors', () => {
    expect(() => decodePbm(new TextEncoder().encode('P5 2 2 255 '))).toThrow(/P1 or P4/)
    expect(() => decodePbm(new TextEncoder().encode('P4\n0 4\n'))).toThrow(/width\/height/)
    expect(() => decodePbm(new TextEncoder().encode('P4\n999 999\n'))).toThrow(/supports up to/)
    expect(() => decodePbm(new TextEncoder().encode('P4\n8 8\nab'))).toThrow(/truncated/)
    expect(() => decodePbm(new TextEncoder().encode('P1\n2 2\n1 0 0 x'))).toThrow(/non-0\/1/)
  })
})

describe('.spr (SNKS) codec', () => {
  it('writes a 16-byte LE header and round-trips the seed animation', () => {
    const doc = seedSprite()
    const spr = encodeSpr(doc)
    expect(new TextDecoder().decode(spr.subarray(0, 4))).toBe('SNKS')
    expect(spr[4]).toBe(1) // version
    expect(spr[5] & SPR_FLAG_LOOP).toBe(SPR_FLAG_LOOP)
    expect(spr[6]).toBe(0) // MONO_HLSB
    expect(spr.length).toBe(16 + rowStride(doc.width) * doc.height * doc.frames.length)
    const decoded = decodeSpr(spr)
    expect(decoded.width).toBe(doc.width)
    expect(decoded.height).toBe(doc.height)
    expect(decoded.loop).toBe(true)
    expect(decoded.frames.map((f) => f.pixels)).toEqual(doc.frames.map((f) => f.pixels))
    expect(decoded.durations).toEqual(doc.frames.map(() => frameDurationMs(doc.fps)))
    const back = sprToDoc('eyes', decoded)
    expect(back.fps).toBe(doc.fps)
  })

  it('reads a per-frame duration table when flag bit0 is set', () => {
    const doc = newSprite('t', 8, 4, 10)
    const base = encodeSpr({ ...doc, frames: [doc.frames[0], doc.frames[0]] })
    // Rebuild with a durations table: header + [50, 250] + the frame data.
    const withTable = new Uint8Array(base.length + 4)
    withTable.set(base.subarray(0, 16), 0)
    withTable[5] |= SPR_FLAG_DURATIONS
    const dv = new DataView(withTable.buffer)
    dv.setUint16(16, 50, true)
    dv.setUint16(18, 250, true)
    withTable.set(base.subarray(16), 20)
    const decoded = decodeSpr(withTable)
    expect(decoded.durations).toEqual([50, 250])
    // sprToDoc folds the average (150 ms) to ~7 fps.
    expect(sprToDoc('t', decoded).fps).toBe(7)
  })

  it('rejects bad magic, versions, formats and truncation', () => {
    const good = encodeSpr(seedSprite())
    expect(() => decodeSpr(good.subarray(0, 10))).toThrow(/Not a Snakie sprite/)
    const badMagic = good.slice()
    badMagic[0] = 0x58
    expect(() => decodeSpr(badMagic)).toThrow(/Not a Snakie sprite/)
    const badVersion = good.slice()
    badVersion[4] = 9
    expect(() => decodeSpr(badVersion)).toThrow(/version 9/)
    const badFormat = good.slice()
    badFormat[6] = 7
    expect(() => decodeSpr(badFormat)).toThrow(/pixel format 7/)
    expect(() => decodeSpr(good.subarray(0, good.length - 4))).toThrow(/truncated/)
  })

  it('decodes from a non-zero byteOffset view (header ints stay correct)', () => {
    const good = encodeSpr(seedSprite())
    const shifted = new Uint8Array(good.length + 3)
    shifted.set(good, 3)
    const view = shifted.subarray(3)
    expect(decodeSpr(view).width).toBe(12)
  })
})

describe('draft JSON form', () => {
  it('round-trips a doc and rejects malformed drafts', () => {
    const doc = seedSprite()
    const json = docToJson(doc)
    expect(typeof json.frames[0][0]).toBe('string')
    const back = docFromJson(JSON.parse(JSON.stringify(json)))
    expect(back).not.toBeNull()
    expect(back?.frames.map((f) => f.pixels)).toEqual(doc.frames.map((f) => f.pixels))
    expect(docFromJson(null)).toBeNull()
    expect(docFromJson({})).toBeNull()
    expect(docFromJson({ ...json, frames: [] })).toBeNull()
    expect(docFromJson({ ...json, frames: [['10']] })).toBeNull() // wrong row count
    expect(docFromJson({ ...json, width: 9999 })).toBeNull()
  })
})
