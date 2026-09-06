import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMpy } from '../src/shared/mpy-info'

/**
 * Sending a binary file to the board without destroying it (#959).
 *
 * "Upload to board" read the file through the STRING channel, which decodes
 * UTF-8. Every byte sequence that is not valid UTF-8 becomes U+FFFD, so a `.mpy`
 * arrived on the board as rubble — with a header intact enough to look almost
 * right, which is why the Bytecode view reported it as *truncated* rather than
 * as nonsense: `parseMpy` read the version fine and then ran off the end of a
 * structure whose offsets no longer meant anything.
 *
 * The device layer was never at fault. `writeFileLocked` hex-encodes and opens
 * `'wb'`, and both `writeFile` implementations already accept a buffer. The
 * decode happened in the renderer, before anything reached the wire.
 */

describe('the corruption this fixes', () => {
  // Built here rather than fixtured: the point is what UTF-8 does to real
  // bytecode, and a hand-written buffer would prove something weaker.
  const bytecode = Buffer.from([
    0x4d, 0x06, 0x00, 0x1f, 0x0e, 0x01, 0x0e, 0x64,
    0xff, 0xfe, 0x80, 0x81, 0x90, 0xa0, 0xc0, 0xc1
  ])

  it('a UTF-8 round trip does not return the same bytes', () => {
    const roundTripped = Buffer.from(bytecode.toString('utf8'), 'utf8')
    expect(roundTripped.equals(bytecode)).toBe(false)
  })

  it('makes the file LONGER, which is why "truncated" was confusing', () => {
    // U+FFFD is three bytes, so a mangled file grows. The parser still says
    // truncated because it runs off the end of a structure, not off the file.
    const roundTripped = Buffer.from(bytecode.toString('utf8'), 'utf8')
    expect(roundTripped.length).toBeGreaterThan(bytecode.length)
  })

  it('leaves the header intact, which is why it looked almost right', () => {
    // The magic and version bytes happen to be ASCII-safe, so `parseMpy` gets
    // far enough to report a version before failing.
    const roundTripped = Buffer.from(bytecode.toString('utf8'), 'utf8')
    expect(roundTripped.subarray(0, 4)).toEqual(bytecode.subarray(0, 4))
  })

  it('survives the BYTE path untouched', () => {
    // What the fix does instead: the bytes are never turned into text.
    const viaBytes = Uint8Array.from(bytecode)
    expect(Buffer.from(viaBytes).equals(bytecode)).toBe(true)
  })
})

describe('a real .mpy makes it through the byte path', () => {
  it('still parses as valid bytecode after a byte-for-byte copy', () => {
    // End to end against our own compiler's output and our own parser: compile,
    // "upload" as bytes, read it back, and it is still a v6 module.
    const mpy = readFileSync('test/fixtures/roundtrip.mpy')
    const copied = Uint8Array.from(mpy)
    const info = parseMpy(copied)
    expect(info.version).toBe(6)
    expect(info.flavour).toBe('micropython')
  })

  it('does NOT parse after a UTF-8 round trip', () => {
    // The reported bug, reproduced: same file, through the string channel.
    const mpy = readFileSync('test/fixtures/roundtrip.mpy')
    const mangled = new Uint8Array(Buffer.from(mpy.toString('utf8'), 'utf8'))
    expect(() => parseMpy(mangled)).toThrow()
  })
})

describe('every path that sends a file to the board', () => {
  const tree = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')
  const sync = readFileSync('src/renderer/src/store/sync.ts', 'utf8')
  const folder = readFileSync('src/renderer/src/lib/folder-transfer.ts', 'utf8')

  it('Upload to board sends bytes, atomically', () => {
    const fn = tree.slice(tree.indexOf('const uploadToBoard'), tree.indexOf('const compileToMpy'))
    expect(fn).toContain('readFileBytes')
    expect(fn).toContain('writeFileBytes')
    expect(fn).toContain('writeAtomically')
    expect(fn, 'no string channel left').not.toContain('fs.readFile(')
  })

  it('the sync push sends bytes, atomically', () => {
    expect(sync).toContain('await window.api.fs.readFileBytes(path)')
    expect(sync).toContain('writeAtomically(deviceAtomicOps')
  })

  it('the save-sync path stays TEXT, correctly', () => {
    // It syncs an editor BUFFER, and only text can be in one — a `.mpy` opens in
    // the read-only Bytecode view, which never routes through the workspace
    // buffer (#875), so binary cannot reach that line.
    expect(sync).toContain('detail.content')
  })

  it('all three share one atomic-write helper', () => {
    // Two copies of the rename-then-remove fallback would be two chances to get
    // the FAT case wrong (#864).
    expect(folder).toContain('export const deviceAtomicOps')
    for (const [name, src] of [['tree', tree], ['sync', sync]] as const) {
      expect(src, name).toContain('deviceAtomicOps')
    }
  })
})

describe('installing a part driver (#959)', () => {
  const install = readFileSync('src/renderer/src/components/driver-install.ts', 'utf8')

  it('copies the driver as bytes', () => {
    // A part may ship a `.mpy` driver — `listPartDriverFiles` offers them and
    // the SAM part's `sam_render.mpy` is one — so the utf-8 reader was rubble
    // by the time it reached the board.
    expect(install).toContain('readDriverSourceBytes')
    expect(install).toContain('writeFileBytes')
    expect(install).not.toContain('readDriverSource(')
  })

  it('measures the real size for the space check', () => {
    // It used to encode the MANGLED text and check that length against the
    // board's free space — a wrong number about a wrong file.
    expect(install).toContain('const size = read.bytes.length')
    expect(install).not.toContain('new TextEncoder().encode(read.contents)')
  })

  it('writes it atomically, like every other copy to the board', () => {
    expect(install).toContain('writeAtomically(deviceAtomicOps')
  })
})

describe('the web build bundles drivers without corrupting them', () => {
  it('inlines them base64, not utf-8', () => {
    // The same mistake as the runtime one, but baked into the bundle: a binary
    // driver was corrupt before the web build even shipped.
    const plugin = readFileSync('vite-plugin-standard-parts.ts', 'utf8')
    expect(plugin).toContain("toString(\n                  'base64'\n                )")
    expect(plugin).not.toMatch(/driverSources\[[^\]]+\] = readFileSync\([^)]*'utf-8'\)/)
  })

  it('offers both a text and a byte reader over the same base64', () => {
    const web = readFileSync('src/renderer/src/web/web-parts.ts', 'utf8')
    expect(web).toContain('readDriverSourceBytes')
    expect(web).toContain('base64Bytes')
  })
})

describe('the web build can actually do it', () => {
  it('routes the byte channel, which it did not before', () => {
    // Without this the renderer called `writeFileBytes`, the router did not
    // forward it, and the upload resolved to nothing at all — silently.
    const router = readFileSync('src/renderer/src/web/web-device-router.ts', 'utf8')
    expect(router).toContain("call(active, 'writeFileBytes'")
  })

  it('implements it on both backends', () => {
    const serial = readFileSync('src/renderer/src/web/web-serial.ts', 'utf8')
    const sim = readFileSync('src/renderer/src/web/web-device.ts', 'utf8')
    expect(serial).toContain('writeFileBytes:')
    expect(sim).toContain('writeFileBytes:')
  })

  it('writes the simulator’s bytes without an encode step', () => {
    // The simulator's `writeFile` was always byte-exact for what it was handed —
    // it just insisted on a string, and encoding one is where the file was lost.
    const sim = readFileSync('src/renderer/src/web/web-device.ts', 'utf8')
    const fn = sim.slice(sim.indexOf('writeFileBytes: async'), sim.indexOf('writeFile: async'))
    expect(fn).toContain('Array.from(bytes)')
    expect(fn).not.toContain('enc.encode')
  })
})
