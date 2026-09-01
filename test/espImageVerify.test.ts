import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  describeEspImageCheck,
  espImageBases,
  verifyEspImage
} from '../src/main/firmware/esp-image'

/**
 * Build a minimal but REAL ESP image: header, one segment, pad + checksum byte,
 * then the appended SHA-256 over everything before it. Built rather than
 * fixtured so the test states the format it is asserting about (#840).
 */
function buildImage(segmentData: Buffer, hashAppended = true): Buffer {
  const header = Buffer.alloc(24)
  header[0] = 0xe9
  header[1] = 1
  header[23] = hashAppended ? 1 : 0
  const seg = Buffer.alloc(8)
  seg.writeUInt32LE(0x3f400020, 0)
  seg.writeUInt32LE(segmentData.length, 4)

  let body = Buffer.concat([header, seg, segmentData])
  body = Buffer.concat([body, Buffer.alloc(15 - (body.length % 16)), Buffer.from([0xef])])
  if (!hashAppended) return body
  return Buffer.concat([body, createHash('sha256').update(body).digest()])
}

describe('verifyEspImage (#840)', () => {
  it('accepts an image whose appended digest matches', () => {
    const check = verifyEspImage(buildImage(Buffer.alloc(64, 0xa5)), 0x1000)
    expect(check.kind).toBe('ok')
    expect(check.images[0].hashOk).toBe(true)
  })

  it('rejects a corrupted image of the SAME LENGTH', () => {
    // The exact failure this exists for: length is right, bytes are not, so
    // esptool would flash and verify it happily.
    const good = buildImage(Buffer.alloc(64, 0xa5))
    const bad = Buffer.from(good)
    bad[40] ^= 0x01
    expect(bad.length).toBe(good.length)

    const check = verifyEspImage(bad, 0x1000)
    expect(check.kind).toBe('bad')
    expect(check.reason).toContain('SHA-256')
  })

  it('rejects a truncated image rather than walking off the end', () => {
    const good = buildImage(Buffer.alloc(64, 0xa5))
    const check = verifyEspImage(good.subarray(0, 40), 0x1000)
    expect(check.kind).toBe('bad')
  })

  it('rejects a header claiming an absurd segment length without throwing', () => {
    const img = buildImage(Buffer.alloc(64, 0xa5))
    img.writeUInt32LE(0xfffffff0, 24 + 4)
    expect(() => verifyEspImage(img, 0x1000)).not.toThrow()
    expect(verifyEspImage(img, 0x1000).kind).toBe('bad')
  })

  it('stays out of the way of files it does not recognise', () => {
    // A UF2, an NVS blob, a partial image: none of its business, and refusing
    // them would be a worse bug than the one it catches.
    expect(verifyEspImage(Buffer.from('UF2\n' + 'x'.repeat(64)), 0x0).kind).toBe('unknown')
  })

  it('treats an empty file as bad', () => {
    expect(verifyEspImage(Buffer.alloc(0), 0x1000).kind).toBe('bad')
  })

  it('does not fail a file whose image carries no digest', () => {
    const check = verifyEspImage(buildImage(Buffer.alloc(32, 7), false), 0x1000)
    expect(check.kind).toBe('unknown')
  })

  it('locates the application image from the flash offset', () => {
    // MicroPython/ESP32 writes at 0x1000, so the app (flash 0x10000) is 0xF000
    // into the file; an S3 or CircuitPython image written at 0x0 puts it at
    // 0x10000. Getting this wrong silently skips the app image entirely.
    expect(espImageBases(0x1000)).toEqual([0, 0xf000])
    expect(espImageBases(0x0)).toEqual([0, 0x10000])
    expect(espImageBases(0x10000)).toEqual([0])
  })

  it('describes each verdict in words', () => {
    expect(describeEspImageCheck(verifyEspImage(buildImage(Buffer.alloc(8)), 0x1000))).toContain(
      'integrity verified'
    )
    expect(describeEspImageCheck({ kind: 'bad', images: [], reason: 'it is empty' })).toContain(
      'corrupt'
    )
  })
})

describe('downloadVerified retries a damaged download (#840)', () => {
  it('names the two kinds of broken differently', async () => {
    // Identical hashes and differing hashes point at completely different
    // things to go and look at, so the message must not merge them.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/main/firmware/download.ts', 'utf8')
    )
    expect(src).toMatch(/byte-for-byte identical/)
    expect(src).toMatch(/corrupted in transit/)
    // And nothing may be written to the board in either case.
    expect(src).toMatch(/nothing has been written to your/)
  })

  it('retries before giving up, and only once', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/main/firmware/download.ts', 'utf8')
    )
    expect(src).toMatch(/attempt <= 2/)
  })
})
