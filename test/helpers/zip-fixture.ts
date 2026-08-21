import { deflateRawSync, inflateRaw } from 'zlib'
import type { Inflate } from '../../src/shared/zip-read'

/**
 * A minimal ZIP WRITER, for testing the reader (#758).
 *
 * The Adafruit bundle's archives are the thing under test, and checking a
 * binary fixture into the repo would test one frozen archive rather than the
 * format. So the tests BUILD archives — real local headers, a real central
 * directory, real deflate — which lets them ask questions a fixture can't:
 * what happens when the index disagrees with the file body, when an entry is
 * stored rather than deflated, when the archive is truncated mid-file.
 *
 * Deliberately writes the format by hand rather than shelling out to `zip`, so
 * the test can produce archives a well-behaved archiver never would.
 */

/** One file to put in a fixture archive. */
export interface ZipFixtureFile {
  /** Full in-archive path, e.g. `stem/lib/mod.mpy`. */
  name: string
  /** Its bytes. */
  bytes: Uint8Array
  /** Store uncompressed (method 0) instead of deflating (method 8). */
  store?: boolean
  /** Write this compression method into the headers instead of the real one. */
  methodOverride?: number
  /** Set general-purpose flag bits (bit 0 = encrypted). */
  flags?: number
  /** Leave this entry OUT of the central directory (still in the file body). */
  omitFromIndex?: boolean
}

/** Node's raw inflate, as the reader's injected {@link Inflate}. */
export const testInflate: Inflate = (deflated) =>
  new Promise((resolve, reject) =>
    inflateRaw(deflated, (err, out) =>
      err ? reject(err) : resolve(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
    )
  )

/** CRC-32, computed rather than faked so the archives are genuinely valid. */
function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** Build a ZIP archive from `files`. */
export function makeZip(files: ZipFixtureFile[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let indexed = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const raw = Buffer.from(file.bytes)
    const stored = file.store === true
    const body = stored ? raw : deflateRawSync(raw)
    const method = file.methodOverride ?? (stored ? 0 : 8)
    const flags = file.flags ?? 0
    const crc = crc32(file.bytes)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    Buffer.from(name).copy(local, 30)
    locals.push(local, body)

    if (!file.omitFromIndex) {
      const entry = Buffer.alloc(46 + name.length)
      entry.writeUInt32LE(0x02014b50, 0)
      entry.writeUInt16LE(20, 4)
      entry.writeUInt16LE(20, 6)
      entry.writeUInt16LE(flags, 8)
      entry.writeUInt16LE(method, 10)
      entry.writeUInt32LE(crc, 16)
      entry.writeUInt32LE(body.length, 20)
      entry.writeUInt32LE(raw.length, 24)
      entry.writeUInt16LE(name.length, 28)
      entry.writeUInt32LE(offset, 42)
      Buffer.from(name).copy(entry, 46)
      central.push(entry)
      indexed++
    }
    offset += local.length + body.length
  }

  const directory = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(indexed, 8)
  eocd.writeUInt16LE(indexed, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  const out = Buffer.concat([...locals, directory, eocd])
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}
