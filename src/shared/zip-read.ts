/**
 * READING A ZIP, WITHOUT A DEPENDENCY (#758, epic #209).
 * =============================================================================
 *
 * The Adafruit CircuitPython Library Bundle ships as ZIP archives — that is the
 * only form its `.mpy` libraries are published in — so installing a
 * CircuitPython library means opening one. Snakie has no archive library and
 * this file exists so it doesn't need one: ZIP's central directory is a fixed
 * binary layout that takes about a hundred lines to walk, and every byte of it
 * is testable against archives built in the test itself.
 *
 * DECOMPRESSION IS INJECTED as {@link Inflate}, for the same reason
 * `mip-resolve.ts` injects its fetcher: it is the one part that differs per
 * host. Node has `zlib.inflateRaw`; a browser has `DecompressionStream`; a unit
 * test can hand over either, or use a STORED archive and never inflate at all.
 * That keeps this module dependency-free so main, the web build and the tests
 * can all import it.
 *
 * DELIBERATELY PARTIAL — this reads the ZIPs Adafruit's build tools produce, not
 * every ZIP in the world:
 *   - **Central-directory driven.** The directory at the end is the archive's
 *     index; scanning for local headers instead would happily read a file the
 *     archive has deleted, and would be fooled by a stored file whose contents
 *     happen to contain a header signature.
 *   - **ZIP64 is refused**, loudly. Its sizes live in an extra field this does
 *     not parse, and a 4 GB `.mpy` is not a thing — so an archive that needs it
 *     is a sign something else is wrong.
 *   - **Encrypted entries are refused.** Same reasoning: never a bundle.
 *   - **Store (0) and Deflate (8)** are the only methods, which is what the
 *     format's own baseline requires and all the bundle uses.
 */

/**
 * Raw-deflate decompression, injected. `uncompressedSize` is what the archive
 * says the result should be — a caller can use it to pre-size a buffer, and
 * {@link readZipEntry} checks the answer against it either way.
 */
export type Inflate = (deflated: Uint8Array, uncompressedSize: number) => Promise<Uint8Array>

/** Why an archive could not be read. Always this class, never a bare RangeError. */
export class ZipReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipReadError'
  }
}

/** One file recorded in the archive's central directory. */
export interface ZipEntry {
  /** The full in-archive path, e.g. `bundle-9.x-mpy-1.2.3/lib/mod.mpy`. */
  name: string
  /** Compression method: 0 = stored, 8 = deflated. */
  method: number
  /** Bytes on disk. */
  compressedSize: number
  /** Bytes once expanded. */
  uncompressedSize: number
  /** Where this entry's LOCAL header starts, from the archive's first byte. */
  localHeaderOffset: number
  /** A directory marker rather than a file (its name ends with `/`). */
  isDirectory: boolean
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
/** A size/offset field that means "the real value is in the ZIP64 extra field". */
const ZIP64_SENTINEL = 0xffffffff
/** The EOCD record is 22 bytes plus a comment of up to 64 KiB. */
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

const decoder = new TextDecoder('utf-8')

/** A DataView over the whole archive, so every read is bounds-checked once. */
function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Read a little-endian u32, turning an out-of-range read into a ZipReadError. */
function u32(view: DataView, at: number): number {
  if (at < 0 || at + 4 > view.byteLength) throw new ZipReadError('the archive is truncated')
  return view.getUint32(at, true)
}

/** Read a little-endian u16, turning an out-of-range read into a ZipReadError. */
function u16(view: DataView, at: number): number {
  if (at < 0 || at + 2 > view.byteLength) throw new ZipReadError('the archive is truncated')
  return view.getUint16(at, true)
}

/**
 * Find the End Of Central Directory record by scanning BACKWARDS from the end.
 *
 * Backwards because the EOCD is last but not at a fixed offset: a trailing
 * comment of up to 64 KiB may follow it. Scanning forwards for the signature
 * would match the first compressed byte-pair that happened to look like one.
 */
function findEocd(view: DataView): number {
  const start = Math.max(0, view.byteLength - EOCD_MIN - MAX_COMMENT)
  for (let at = view.byteLength - EOCD_MIN; at >= start; at--) {
    if (view.getUint32(at, true) === SIG_EOCD) return at
  }
  throw new ZipReadError('not a ZIP archive (no end-of-central-directory record)')
}

/**
 * Every file the archive's central directory lists, in directory order.
 *
 * Throws {@link ZipReadError} for anything that isn't a plain, readable ZIP —
 * truncated, ZIP64, or encrypted — rather than returning a short list that would
 * silently install half a library.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength < EOCD_MIN) throw new ZipReadError('the archive is truncated')
  const view = viewOf(bytes)
  const eocd = findEocd(view)

  const count = u16(view, eocd + 10)
  const dirSize = u32(view, eocd + 12)
  const dirOffset = u32(view, eocd + 16)
  if (dirOffset === ZIP64_SENTINEL || dirSize === ZIP64_SENTINEL || count === 0xffff) {
    throw new ZipReadError('the archive is ZIP64, which Snakie does not read')
  }
  if (dirOffset + dirSize > view.byteLength) {
    throw new ZipReadError('the archive is truncated (its index runs past the end)')
  }

  const entries: ZipEntry[] = []
  let at = dirOffset
  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== SIG_CENTRAL) {
      throw new ZipReadError(`the archive's index is corrupt at entry ${i + 1}`)
    }
    const flags = u16(view, at + 8)
    // Bit 0 is the "encrypted" flag; a bundle is never encrypted, so this means
    // we are looking at something other than what we think we are.
    if ((flags & 0x1) !== 0) throw new ZipReadError('the archive is encrypted')
    const method = u16(view, at + 10)
    const compressedSize = u32(view, at + 20)
    const uncompressedSize = u32(view, at + 24)
    const nameLen = u16(view, at + 28)
    const extraLen = u16(view, at + 30)
    const commentLen = u16(view, at + 32)
    const localHeaderOffset = u32(view, at + 42)
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw new ZipReadError('the archive is ZIP64, which Snakie does not read')
    }
    const nameAt = at + 46
    if (nameAt + nameLen > view.byteLength) throw new ZipReadError('the archive is truncated')
    const name = decoder.decode(bytes.subarray(nameAt, nameAt + nameLen))
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/')
    })
    at = nameAt + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Expand one entry's bytes.
 *
 * The local header is re-read rather than trusted from the central directory:
 * its name and extra fields have their own lengths (an archiver may write extra
 * data in one and not the other), and the file's bytes begin after them. The
 * SIZES, though, come from the central directory — an entry written with a data
 * descriptor leaves them zero in the local header.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  inflate: Inflate
): Promise<Uint8Array> {
  const view = viewOf(bytes)
  const head = entry.localHeaderOffset
  if (u32(view, head) !== SIG_LOCAL) {
    throw new ZipReadError(`the archive's copy of ${entry.name} is corrupt`)
  }
  const dataAt = head + 30 + u16(view, head + 26) + u16(view, head + 28)
  const end = dataAt + entry.compressedSize
  if (end > bytes.byteLength) {
    throw new ZipReadError(`the archive is truncated inside ${entry.name}`)
  }
  const raw = bytes.subarray(dataAt, end)

  if (entry.method === 0) {
    if (raw.byteLength !== entry.uncompressedSize) {
      throw new ZipReadError(`${entry.name} is not the size the archive claims`)
    }
    // A copy, not the subarray: callers keep these past the archive's lifetime,
    // and a view would pin the whole 17 MB buffer in memory for one 1 KB file.
    return raw.slice()
  }
  if (entry.method !== 8) {
    throw new ZipReadError(
      `${entry.name} uses compression method ${entry.method}, which Snakie does not read`
    )
  }
  const out = await inflate(raw, entry.uncompressedSize)
  if (out.byteLength !== entry.uncompressedSize) {
    throw new ZipReadError(`${entry.name} did not expand to the size the archive claims`)
  }
  return out
}

/** One file read out of an archive. */
export interface ZipFile {
  /** The full in-archive path. */
  name: string
  /** Its expanded bytes. */
  bytes: Uint8Array
}

/**
 * Read every file the archive holds, optionally narrowed by `keep`.
 *
 * `keep` is applied BEFORE decompression, which is the point of it: the bundle's
 * per-library archives carry examples and requirements alongside the `lib/`
 * folder, and only `lib/` is ever installed. Directory entries are skipped —
 * they carry no bytes, and the writer creates directories from the file paths.
 */
export async function readZipFiles(
  bytes: Uint8Array,
  inflate: Inflate,
  keep: (entry: ZipEntry) => boolean = () => true
): Promise<ZipFile[]> {
  const out: ZipFile[] = []
  for (const entry of listZipEntries(bytes)) {
    if (entry.isDirectory || !keep(entry)) continue
    out.push({ name: entry.name, bytes: await readZipEntry(bytes, entry, inflate) })
  }
  return out
}
