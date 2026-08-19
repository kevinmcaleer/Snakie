import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CIRCUITPY_READ_ONLY,
  driveListDir,
  driveMkdir,
  driveReadFileBytes,
  driveReadFileLine,
  driveRemove,
  driveRename,
  driveStat,
  driveUsage,
  driveWriteFile,
  isReadOnlyFsError,
  readOnlyFsError,
  resolveOnDrive
} from '../src/main/device/circuitpy-fs'

/**
 * FILE I/O AGAINST A MOUNTED CIRCUITPY DRIVE (#754, epic #209).
 *
 * Everything here runs against a real temp directory standing in for the drive,
 * because the operations ARE filesystem operations — mocking `fs` would only
 * test that the mocks were called. The two properties that matter beyond "it
 * works": a device path can never escape the mount, and the shapes match what
 * the REPL implementations return, since callers must not be able to tell which
 * path served them.
 */

let mount: string

beforeEach(async () => {
  mount = await mkdtemp(join(tmpdir(), 'snakie-cpfs-'))
  await mkdir(join(mount, 'lib'))
  await writeFile(join(mount, 'code.py'), 'print("hello")\n')
  await writeFile(join(mount, 'lib', 'bme280.py'), '__version__ = "1.2.0"\nclass BME280: pass\n')
})

afterEach(async () => {
  await rm(mount, { recursive: true, force: true })
})

describe('resolveOnDrive', () => {
  it('maps a rooted device path onto the mount', () => {
    expect(resolveOnDrive('/mnt/CIRCUITPY', '/lib/foo.py')).toBe('/mnt/CIRCUITPY/lib/foo.py')
    expect(resolveOnDrive('/mnt/CIRCUITPY', 'lib/foo.py')).toBe('/mnt/CIRCUITPY/lib/foo.py')
    expect(resolveOnDrive('/mnt/CIRCUITPY', '/')).toBe('/mnt/CIRCUITPY')
  })

  it('REFUSES to escape the mount — a part declares its own driver target, not just the user', () => {
    for (const evil of ['../secrets', '/../secrets', 'lib/../../etc/passwd', '/lib/../../..']) {
      expect(() => resolveOnDrive('/mnt/CIRCUITPY', evil)).toThrow(/outside the board/i)
    }
  })

  it('allows a `..` that stays inside', () => {
    expect(resolveOnDrive('/mnt/CIRCUITPY', '/lib/../code.py')).toBe('/mnt/CIRCUITPY/code.py')
  })
})

describe('reads', () => {
  it('lists a directory in the same shape the REPL listDir returns', async () => {
    const entries = await driveListDir(mount, '/')
    expect(entries).toContainEqual({ name: 'code.py', isDir: false, size: 15 })
    expect(entries).toContainEqual({ name: 'lib', isDir: true, size: 0 })
  })

  it('hides the host bookkeeping the BOARD never sees', async () => {
    await writeFile(join(mount, '.metadata_never_index'), '')
    await writeFile(join(mount, '._code.py'), '')
    await mkdir(join(mount, '.fseventsd'))
    const names = (await driveListDir(mount, '/')).map((e) => e.name)
    expect(names.sort()).toEqual(['code.py', 'lib'])
  })

  it('reads bytes', async () => {
    expect((await driveReadFileBytes(mount, '/code.py')).toString()).toBe('print("hello")\n')
  })

  it('finds a prefixed line — the drive twin of the on-board search (#700)', async () => {
    expect(await driveReadFileLine(mount, '/lib/bme280.py', '__version__')).toBe('__version__ = "1.2.0"')
  })

  it('returns empty for a missing file, matching the REPL version that swallows OSError', async () => {
    expect(await driveReadFileLine(mount, '/lib/nope.py', '__version__')).toBe('')
  })

  it('stats in seconds, not milliseconds — the board reports seconds', async () => {
    const st = await driveStat(mount, '/code.py')
    expect(st.isDir).toBe(false)
    expect(st.size).toBe(15)
    const onDisk = await stat(join(mount, 'code.py'))
    expect(st.mtime).toBe(Math.floor(onDisk.mtimeMs / 1000))
  })
})

describe('writes', () => {
  it('writes a file', async () => {
    await driveWriteFile(mount, '/lib/new.py', 'x = 1\n')
    expect(await readFile(join(mount, 'lib', 'new.py'), 'utf8')).toBe('x = 1\n')
  })

  it('creates missing parent folders — a driver target names a folder that may not exist', async () => {
    await driveWriteFile(mount, '/lib/vendor/deep/thing.py', 'ok')
    expect(await readFile(join(mount, 'lib', 'vendor', 'deep', 'thing.py'), 'utf8')).toBe('ok')
  })

  it('writes to the drive ROOT, where the parent is the mount itself', async () => {
    // The Windows shape: the mount is a drive root, so deriving the parent by
    // slicing at the last separator would produce `E:` rather than `E:\`.
    await driveWriteFile(mount, '/main.py', 'root file')
    expect(await readFile(join(mount, 'main.py'), 'utf8')).toBe('root file')
  })

  it('overwrites rather than appending', async () => {
    await driveWriteFile(mount, '/code.py', 'first')
    await driveWriteFile(mount, '/code.py', 'second')
    expect(await readFile(join(mount, 'code.py'), 'utf8')).toBe('second')
  })

  it('writes binary content intact', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x1a])
    await driveWriteFile(mount, '/blob.bin', bytes)
    expect(await readFile(join(mount, 'blob.bin'))).toEqual(bytes)
  })

  it('will not write outside the mount', async () => {
    await expect(driveWriteFile(mount, '../escaped.py', 'x')).rejects.toThrow(/outside the board/i)
  })

  it('makes and renames directories', async () => {
    await driveMkdir(mount, '/data')
    expect((await driveStat(mount, '/data')).isDir).toBe(true)
    await driveRename(mount, '/data', '/logs')
    expect((await driveStat(mount, '/logs')).isDir).toBe(true)
  })

  it('removes a whole tree, as the REPL version does (#219)', async () => {
    await driveWriteFile(mount, '/lib/pkg/a.py', 'a')
    await driveWriteFile(mount, '/lib/pkg/sub/b.py', 'b')
    await driveRemove(mount, '/lib/pkg')
    expect((await driveListDir(mount, '/lib')).map((e) => e.name)).toEqual(['bme280.py'])
  })

  it('removing something absent is not an error, matching `force`', async () => {
    await expect(driveRemove(mount, '/not/here')).resolves.toBeUndefined()
  })
})

describe('driveUsage', () => {
  it('measures the host filesystem the drive is on', async () => {
    const usage = await driveUsage(mount)
    expect(usage).not.toBeNull()
    expect(usage!.total).toBeGreaterThan(0)
    expect(usage!.used + usage!.free).toBe(usage!.total)
    expect(usage!.free).toBeLessThanOrEqual(usage!.total)
  })

  it('is null rather than throwing for a path that is gone', async () => {
    expect(await driveUsage(join(mount, 'nope'))).toBeNull()
  })
})

describe('read-only filesystem errors', () => {
  it('recognises how the runtimes actually render errno 30', () => {
    for (const raw of [
      'OSError: 30',
      'OSError: [Errno 30] Read-only filesystem',
      "OSError: [Errno 30] EROFS",
      'Traceback (most recent call last):\n  File "<stdin>", line 1\nOSError: 30'
    ]) {
      expect(isReadOnlyFsError(raw)).toBe(true)
    }
  })

  it('does not mistake other errors for it', () => {
    for (const raw of ['OSError: 28', 'OSError: 2', 'OSError: 300', 'ValueError: 30']) {
      expect(isReadOnlyFsError(raw)).toBe(false)
    }
  })

  it('rewrites it into something a user can act on, and leaves everything else alone', () => {
    const rewritten = readOnlyFsError(new Error('OSError: [Errno 30] Read-only filesystem'))
    expect((rewritten as Error).message).toBe(CIRCUITPY_READ_ONLY)
    expect(CIRCUITPY_READ_ONLY).toMatch(/CIRCUITPY drive/)
    // It names the deliberate case too, so a `storage.remount` user isn't sent
    // hunting for a drive they hid on purpose.
    expect(CIRCUITPY_READ_ONLY).toMatch(/storage\.remount/)

    const other = new Error('OSError: 28')
    expect(readOnlyFsError(other)).toBe(other)
  })
})
