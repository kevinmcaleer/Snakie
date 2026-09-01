/**
 * Integrity checking for ESP firmware images, BEFORE they are written (#840).
 *
 * esptool's `Hash of data verified` is a weaker claim than it reads as: it
 * proves the flash now matches THE FILE IT WAS GIVEN. It says nothing about
 * whether that file is the firmware the vendor built. A download that arrives
 * with the right length and the wrong bytes therefore flashes perfectly, passes
 * verification, and leaves a board that will not boot — the ESP32's own
 * bootloader is the first thing in the chain to notice, and all it can say is:
 *
 *     E (579) esp_image: Image hash failed - image is corrupt
 *
 * That is the same check implemented here, run a minute earlier and on the host,
 * where it can still be acted on. ESP images carry a SHA-256 of themselves in
 * their last 32 bytes; recomputing it catches any corruption, including the
 * length-preserving kind that a `content-length` check cannot see.
 *
 * Deliberately conservative: this may only ever report a file BAD when it is
 * certain. Anything it does not recognise is reported as `unknown`, never as a
 * failure — users flash partial images, NVS blobs and vendor binaries that are
 * none of its business, and refusing those would be a worse bug than the one it
 * exists to catch.
 */
import { createHash } from 'crypto'

/** First byte of every ESP image header. */
const IMAGE_MAGIC = 0xe9

/** `esp_image_header_t` is 24 bytes; `hash_appended` is its last one. */
const HEADER_LEN = 24
const HASH_APPENDED_OFFSET = 23

/** Length of the appended SHA-256 digest. */
const DIGEST_LEN = 32

/** Where the application image lives in flash, on every standard layout. */
const APP_FLASH_ADDRESS = 0x10000

/** What one sub-image inside a firmware file turned out to be. */
export interface EspSubImage {
  /** Byte offset within the file. */
  offset: number
  /** Number of segments its header declared. */
  segments: number
  /** True/false when a digest was present and checked; null when absent. */
  hashOk: boolean | null
}

/** The verdict on a whole firmware file. */
export interface EspImageCheck {
  /** `bad` is the only value that may block a flash. */
  kind: 'ok' | 'bad' | 'unknown'
  /** Every sub-image that parsed, for the log. */
  images: EspSubImage[]
  /** Set when `kind` is `bad`: what is wrong, in words the user can act on. */
  reason?: string
}

/**
 * Walk one image at `offset`, returning where it ends and whether its own
 * appended digest matches. Returns null when the bytes there are not a
 * well-formed image — including when walking them would run off the end, which
 * is what a truncated download looks like.
 */
function walkImage(buf: Buffer, offset: number): EspSubImage & { end: number } | null {
  if (offset + HEADER_LEN > buf.length) return null
  if (buf[offset] !== IMAGE_MAGIC) return null

  const segments = buf[offset + 1]
  const hashAppended = buf[offset + HASH_APPENDED_OFFSET] === 1

  let p = offset + HEADER_LEN
  for (let i = 0; i < segments; i++) {
    if (p + 8 > buf.length) return null
    const len = buf.readUInt32LE(p + 4)
    // A plausible segment length. A corrupt header can claim gigabytes, and
    // walking that is how a parser turns a bad file into a crash.
    if (len > buf.length) return null
    p += 8 + len
    if (p > buf.length) return null
  }

  // The image is padded so that its length INCLUDING a trailing one-byte
  // checksum is a multiple of 16; the checksum is that block's last byte.
  p += 15 - ((p - offset) % 16)
  p += 1
  if (p > buf.length) return null

  if (!hashAppended) return { offset, segments, hashOk: null, end: p }
  if (p + DIGEST_LEN > buf.length) return null

  const actual = createHash('sha256').update(buf.subarray(offset, p)).digest()
  const hashOk = actual.equals(buf.subarray(p, p + DIGEST_LEN))
  return { offset, segments, hashOk, end: p + DIGEST_LEN }
}

/**
 * Where the sub-images sit INSIDE a file that will be written at `flashOffset`.
 *
 * A vendor `.bin` is a slice of the flash map, so a file's own offsets are the
 * flash addresses minus the address it gets written at. The bootloader is
 * always first; the application is at 0x10000 in flash, which lands at 0xF000
 * in a file flashed at 0x1000 (MicroPython on the original ESP32) and at
 * 0x10000 in one flashed at 0x0 (S3, and CircuitPython everywhere).
 */
export function espImageBases(flashOffset: number): number[] {
  const app = APP_FLASH_ADDRESS - flashOffset
  return app > 0 ? [0, app] : [0]
}

/**
 * Check a firmware file's internal integrity.
 *
 * Only ever returns `bad` for a file that IS an ESP image and whose own digest
 * disagrees with its contents — a fact about the file alone, independent of the
 * board, the port and the flash settings. Everything else is `unknown`.
 */
export function verifyEspImage(buf: Buffer, flashOffset: number): EspImageCheck {
  if (buf.length === 0) {
    return { kind: 'bad', images: [], reason: 'the file is empty' }
  }
  // Not an ESP image at all: a UF2, a raw blob, a partial image the user means
  // to write at some address of their own. None of our business.
  if (buf[0] !== IMAGE_MAGIC) return { kind: 'unknown', images: [] }

  const images: EspSubImage[] = []
  for (const base of espImageBases(flashOffset)) {
    if (base >= buf.length) continue
    if (buf[base] !== IMAGE_MAGIC) continue
    const walked = walkImage(buf, base)
    // The FIRST image failing to parse means the file is not what it claims —
    // it started with the magic byte and then did not hold together, which is
    // what a truncated or interleaved download looks like.
    if (!walked) {
      if (base === 0) {
        return {
          kind: 'bad',
          images,
          reason: 'it starts like an ESP firmware image but does not hold together'
        }
      }
      continue
    }
    images.push({ offset: walked.offset, segments: walked.segments, hashOk: walked.hashOk })
  }

  const failed = images.find((i) => i.hashOk === false)
  if (failed) {
    return {
      kind: 'bad',
      images,
      reason:
        `the ${failed.offset === 0 ? 'bootloader' : 'application'} image at ` +
        `0x${failed.offset.toString(16)} fails its own SHA-256 check`
    }
  }
  if (images.some((i) => i.hashOk === true)) return { kind: 'ok', images }
  return { kind: 'unknown', images }
}

/** One line describing a check, for the flash log. */
export function describeEspImageCheck(check: EspImageCheck): string {
  if (check.kind === 'ok') {
    const n = check.images.filter((i) => i.hashOk === true).length
    return `Firmware integrity verified (${n} image${n === 1 ? '' : 's'} passed their own SHA-256).`
  }
  if (check.kind === 'bad') return `Firmware file is corrupt: ${check.reason}.`
  return 'Firmware integrity not checked (not a recognised ESP image).'
}
