import { describe, expect, it, vi } from 'vitest'
import {
  ZipReadError,
  listZipEntries,
  readZipEntry,
  readZipFiles,
  type Inflate
} from '../src/shared/zip-read'
import { makeZip, testInflate } from './helpers/zip-fixture'

/**
 * READING A ZIP WITHOUT A DEPENDENCY (#758).
 *
 * The Adafruit CircuitPython bundle only ships as ZIP archives, so this reader
 * stands between Snakie and every CircuitPython library. These tests build real
 * archives — real headers, real deflate — and pin the properties that make the
 * reader trustworthy rather than merely working: that it reads the archive's
 * INDEX rather than scanning for headers, that bytes survive it exactly, and
 * that a damaged archive fails loudly instead of returning a short list.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('listZipEntries', () => {
  it('reads the central directory, not the file body', async () => {
    // An entry whose data and local header are still in the archive but which
    // the index no longer lists has been DELETED. Scanning for local-header
    // signatures would resurrect it — and, on a bundle, install a library
    // Adafruit withdrew.
    const zip = makeZip([
      { name: 'pkg/lib/keep.mpy', bytes: bytesOf('keep') },
      { name: 'pkg/lib/deleted.mpy', bytes: bytesOf('gone'), omitFromIndex: true }
    ])
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(['pkg/lib/keep.mpy'])
  })

  it('marks directory entries as directories, so nothing tries to read them', () => {
    const zip = makeZip([
      { name: 'pkg/lib/', bytes: new Uint8Array(), store: true },
      { name: 'pkg/lib/mod.mpy', bytes: bytesOf('x') }
    ])
    expect(listZipEntries(zip).map((e) => e.isDirectory)).toEqual([true, false])
  })

  it('refuses anything that is not a ZIP', () => {
    expect(() => listZipEntries(bytesOf('<!doctype html>rate limited'))).toThrow(ZipReadError)
  })

  it('refuses a truncated archive rather than reading a short list', () => {
    const zip = makeZip([{ name: 'a.mpy', bytes: bytesOf('a') }])
    // Cutting the tail removes the index; cutting the middle keeps it but loses
    // the data. Both are corruption and neither may pass silently.
    expect(() => listZipEntries(zip.subarray(0, zip.length - 4))).toThrow(ZipReadError)
  })

  it('refuses an encrypted entry — a bundle is never encrypted', () => {
    const zip = makeZip([{ name: 'a.mpy', bytes: bytesOf('a'), flags: 0x1 }])
    expect(() => listZipEntries(zip)).toThrow(/encrypted/)
  })
})

describe('readZipEntry', () => {
  it('returns deflated and stored entries identically', async () => {
    // The bundle uses deflate; empty files (an `__init__.py`) come back stored.
    // Which one an archiver chose must not be visible to the caller.
    const payload = bytesOf('a'.repeat(500))
    for (const store of [true, false]) {
      const zip = makeZip([{ name: 'lib/mod.mpy', bytes: payload, store }])
      const [entry] = listZipEntries(zip)
      expect(await readZipEntry(zip, entry, testInflate)).toEqual(payload)
    }
  })

  it('preserves arbitrary BYTES — the whole reason .mpy can be installed', async () => {
    // 0xFF and a lone continuation byte are not valid UTF-8. If anything in the
    // path decoded to text and back, this comes out as replacement characters —
    // which is exactly the corrupt-.mpy failure `mip-resolve.ts` refuses to risk.
    const mpy = new Uint8Array([0x43, 0x06, 0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x00, 0x7f])
    const zip = makeZip([{ name: 'lib/mod.mpy', bytes: mpy }])
    const [entry] = listZipEntries(zip)
    expect(Array.from(await readZipEntry(zip, entry, testInflate))).toEqual(Array.from(mpy))
  })

  it('copies the bytes out, so the caller does not pin the whole archive', async () => {
    const zip = makeZip([{ name: 'lib/mod.mpy', bytes: bytesOf('hello'), store: true }])
    const [entry] = listZipEntries(zip)
    const out = await readZipEntry(zip, entry, testInflate)
    zip.fill(0)
    expect(new TextDecoder().decode(out)).toBe('hello')
  })

  it('refuses a compression method it does not implement', async () => {
    const zip = makeZip([{ name: 'a.mpy', bytes: bytesOf('a'), store: true, methodOverride: 14 }])
    const [entry] = listZipEntries(zip)
    await expect(readZipEntry(zip, entry, testInflate)).rejects.toThrow(/method 14/)
  })

  it('refuses an entry whose expansion is not the size the index promised', async () => {
    // A decompressor that returns the wrong length means the archive and its
    // index disagree; installing that would put a half-file on the board.
    const zip = makeZip([{ name: 'a.mpy', bytes: bytesOf('abcdef') }])
    const [entry] = listZipEntries(zip)
    const short: Inflate = async () => bytesOf('ab')
    await expect(readZipEntry(zip, entry, short)).rejects.toThrow(ZipReadError)
  })
})

describe('readZipFiles', () => {
  it('filters BEFORE decompressing, so the ignored 90% costs nothing', async () => {
    // A per-library bundle archive carries examples/ and requirements/ beside
    // lib/. Only lib/ is device code; inflating the rest would be pure waste.
    const zip = makeZip([
      { name: 'pkg/lib/mod.mpy', bytes: bytesOf('driver') },
      { name: 'pkg/examples/demo.py', bytes: bytesOf('demo') },
      { name: 'pkg/requirements/pyproject.toml', bytes: bytesOf('meta') }
    ])
    const spy = vi.fn(testInflate)
    const files = await readZipFiles(zip, spy, (e) => e.name.includes('/lib/'))
    expect(files.map((f) => f.name)).toEqual(['pkg/lib/mod.mpy'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('never returns a directory entry', async () => {
    const zip = makeZip([
      { name: 'pkg/lib/sub/', bytes: new Uint8Array(), store: true },
      { name: 'pkg/lib/sub/mod.mpy', bytes: bytesOf('x') }
    ])
    const files = await readZipFiles(zip, testInflate)
    expect(files.map((f) => f.name)).toEqual(['pkg/lib/sub/mod.mpy'])
  })
})
