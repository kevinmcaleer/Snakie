import { describe, it, expect } from 'vitest'
import { TEMP_SUFFIX, tempPathFor, writeAtomically, type AtomicOps } from '../src/shared/atomic-write'

/**
 * All-or-nothing device writes (#864).
 *
 * The bug these pin: a driver install wrote each file straight to its final
 * path, so interrupting it left a TRUNCATED file under its real name. A user's
 * board ended up with a 12 KB `lsm6dsox.py` cut off mid-way, and the symptom
 * was `SyntaxError` at line 159 of a vendor library that parses perfectly —
 * a report that points at the wrong thing entirely.
 *
 * So the property under test is: after any failure, the target is either
 * untouched or complete, and never a prefix. The tests drive a fake board so
 * every failure mode — a dead port mid-write, a filesystem that refuses to
 * rename onto an existing name, a short write that did not throw — is
 * reachable without hardware.
 */

/** A board that records what was asked of it, and can be made to fail. */
function fakeBoard(opts: {
  /** Fail the write to the temp path with this message. */
  failWrite?: string
  /** Refuse `rename` onto a name that already exists (FAT does; littlefs does not). */
  renameRefusesOverwrite?: boolean
  /** Report this size from `stat` instead of what was written. */
  reportSize?: number
  /** Make `stat` unavailable, as a mounted drive or a resetting board can be. */
  statThrows?: boolean
  /** Make cleanup fail too — the port is usually gone by then. */
  removeThrows?: boolean
  /** Seed the board with an existing file at this path. */
  existing?: Record<string, number>
}) {
  const files: Record<string, number> = { ...(opts.existing ?? {}) }
  const log: string[] = []

  const ops: AtomicOps = {
    stat: async (path) => {
      log.push(`stat ${path}`)
      if (opts.statThrows) throw new Error('cannot stat')
      if (!(path in files)) throw new Error(`ENOENT ${path}`)
      return { size: opts.reportSize ?? files[path] }
    },
    rename: async (from, to) => {
      log.push(`rename ${from} -> ${to}`)
      if (opts.renameRefusesOverwrite && to in files) throw new Error('EEXIST')
      if (!(from in files)) throw new Error(`ENOENT ${from}`)
      files[to] = files[from]
      delete files[from]
    },
    remove: async (path) => {
      log.push(`remove ${path}`)
      if (opts.removeThrows) throw new Error('port closed')
      delete files[path]
    }
  }

  const write = async (path: string, bytes: number): Promise<void> => {
    log.push(`write ${path}`)
    if (opts.failWrite) throw new Error(opts.failWrite)
    files[path] = bytes
  }

  return { ops, files, log, write }
}

const TARGET = '/lib/lsm6dsox.py'

describe('tempPathFor', () => {
  it('keeps the temporary beside its target', () => {
    // Same directory, or the rename is a copy across filesystems and stops
    // being the cheap atomic move this depends on.
    expect(tempPathFor(TARGET)).toBe(`/lib/lsm6dsox.py${TEMP_SUFFIX}`)
    expect(tempPathFor(TARGET).lastIndexOf('/')).toBe(TARGET.lastIndexOf('/'))
  })
})

describe('a write that completes', () => {
  it('lands under a temporary name and is moved into place', async () => {
    const b = fakeBoard({})
    await writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))

    expect(b.files[TARGET]).toBe(12039)
    expect(b.files[tempPathFor(TARGET)]).toBeUndefined()
    // The real name is never written directly — that is the whole point.
    expect(b.log).not.toContain(`write ${TARGET}`)
    expect(b.log).toContain(`rename ${tempPathFor(TARGET)} -> ${TARGET}`)
  })

  it('replaces an existing file', async () => {
    const b = fakeBoard({ existing: { [TARGET]: 999 } })
    await writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    expect(b.files[TARGET]).toBe(12039)
  })
})

describe('a write interrupted part-way', () => {
  it('leaves the old file untouched rather than a truncated new one', async () => {
    // This is the reported bug. Before the fix the half-written bytes WERE the
    // file, and the next import failed inside a vendor library.
    const b = fakeBoard({ existing: { [TARGET]: 12039 }, failWrite: 'port closed' })
    await expect(
      writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    ).rejects.toThrow('port closed')

    expect(b.files[TARGET]).toBe(12039) // the good one, still there
  })

  it('leaves no file at all when there was none before', async () => {
    const b = fakeBoard({ failWrite: 'port closed' })
    await expect(
      writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    ).rejects.toThrow()
    // An absent module raises ImportError, which names the problem. A truncated
    // one raises SyntaxError somewhere nobody thinks to look.
    expect(Object.keys(b.files)).toEqual([])
  })

  it('clears the temporary away', async () => {
    const b = fakeBoard({})
    await expect(
      writeAtomically(b.ops, TARGET, 12039, async (tmp) => {
        await b.write(tmp, 4096) // partial write, then the port dies
        throw new Error('port closed')
      })
    ).rejects.toThrow('port closed')
    expect(b.files[tempPathFor(TARGET)]).toBeUndefined()
    expect(b.log).toContain(`remove ${tempPathFor(TARGET)}`)
  })

  it('reports the REAL error even when the cleanup also fails', async () => {
    // The port being gone is exactly when cleanup runs, so it often cannot
    // succeed. "port closed" is the useful message; "cannot remove" is noise.
    const b = fakeBoard({ failWrite: 'port closed', removeThrows: true })
    await expect(
      writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    ).rejects.toThrow('port closed')
  })
})

describe('a filesystem that will not rename onto an existing name', () => {
  it('removes the target and retries, so the write still lands', async () => {
    // FAT refuses; littlefs does not. Snakie sees boards with both.
    const b = fakeBoard({ renameRefusesOverwrite: true, existing: { [TARGET]: 999 } })
    await writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))

    expect(b.files[TARGET]).toBe(12039)
    expect(b.log.filter((l) => l.startsWith('rename'))).toHaveLength(2)
    expect(b.log).toContain(`remove ${TARGET}`)
  })

  it('does not pay that cost when the target is new', async () => {
    const b = fakeBoard({ renameRefusesOverwrite: true })
    await writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    expect(b.log.filter((l) => l.startsWith('rename'))).toHaveLength(1)
    expect(b.log).not.toContain(`remove ${TARGET}`)
  })
})

describe('a short write that did not throw', () => {
  it('is caught before it can replace a good file', async () => {
    const b = fakeBoard({ existing: { [TARGET]: 12039 }, reportSize: 4096 })
    await expect(
      writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    ).rejects.toThrow(/short write: 4096 of 12039/)

    expect(b.files[TARGET]).toBe(12039) // untouched
    expect(b.files[tempPathFor(TARGET)]).toBeUndefined()
  })

  it('names the likeliest cause, because the board will not', async () => {
    const b = fakeBoard({ reportSize: 0 })
    await expect(
      writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    ).rejects.toThrow(/run out of space/)
  })
})

describe('a board that cannot answer stat', () => {
  it('still installs — an unavailable check must not become a failed install', async () => {
    // A mounted CIRCUITPY drive or a board mid-reset can refuse. Refusing to
    // install because the optional check was unavailable trades a rare bug for
    // a common one.
    const b = fakeBoard({ statThrows: true })
    await writeAtomically(b.ops, TARGET, 12039, (tmp) => b.write(tmp, 12039))
    expect(b.files[TARGET]).toBe(12039)
  })
})

describe('both write paths use it', () => {
  it('the driver installer writes through writeAtomically', () => {
    const src = readSrc('src/preload/index.ts')
    expect(src).toContain('writeAtomically(')
    // …and never straight at the destination.
    expect(src).not.toMatch(/invoke\('device:writeFile', file\.path/)
    expect(src).not.toMatch(/invoke\('device:writeFileBytes', file\.path/)
  })

  it('the folder transfer writes through writeAtomically', () => {
    const src = readSrc('src/renderer/src/lib/folder-transfer.ts')
    expect(src).toContain('writeAtomically(')
    expect(src).not.toMatch(/writeFileBytes\(file\.device/)
  })
})

function readSrc(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readFileSync(path, 'utf8')
}
