import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { MicroPythonDevice } from '../src/main/device/MicroPythonDevice'

/**
 * ROUTING: does a CircuitPython board's file I/O actually reach its drive (#754)?
 *
 * `circuitpyFs.test.ts` proves the drive operations work; this proves
 * `MicroPythonDevice` USES them — that every filesystem method checks for a
 * mount, and that none was missed. A missed one is not a visible bug, it is a
 * silent `OSError: 30` in whichever feature happens to call it.
 *
 * The device is driven with no serial port at all. Reaching into `mount` is
 * deliberate: it is the one piece of state `connect()` would set from real
 * hardware, and faking a board over a mock serial port would test the raw-REPL
 * protocol (which `rawRepl.test.ts` already covers) rather than the routing.
 * Every REPL path throws "Not connected" here, which is exactly what makes the
 * assertions meaningful — a method that failed to route would throw.
 *
 * WHY THE VOLUME SCAN IS STUBBED (#773)
 * -------------------------------------
 * One case here — the ejected drive — makes the device RE-RESOLVE its mount,
 * and re-resolution is the one step that leaves this test's temp directory and
 * reads the DEVELOPER'S MACHINE: `listVolumes()` walks the real mount root
 * (`/Volumes`, `/media/$USER`, every drive letter) and, if it finds a CIRCUITPY
 * drive, enumerates the real serial ports to pair it. That is unbounded,
 * environment-dependent I/O — a network Time Machine or SMB mount under
 * `/Volumes` can make a single `readdir` block for seconds — and it is why this
 * one case, alone in a file where all sixteen do real filesystem work, timed
 * out repeatedly under full-suite load while always passing in isolation.
 *
 * Stubbing the scan is not stubbing the behaviour under test. The question is
 * "when the marker file is gone, does the device stop trusting the mount and
 * fall back to the REPL" — and the stub is the ANSWER to "what drives are
 * plugged in", which is exactly the part a unit test must not ask the machine.
 * `findCircuitPyDrives` and `pairDriveToPort` stay real, and the spy lets the
 * cases assert something they could not before: that re-resolution happened at
 * all, and that a drive still present does NOT trigger one.
 */
const listVolumes = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../src/main/fs/volumes', async (importActual) => ({
  ...(await importActual<typeof import('../src/main/fs/volumes')>()),
  listVolumes
}))

/** The private field `connect()` sets once the runtime probe says CircuitPython. */
type WithMount = { mount: string | null }

let mount: string
let device: MicroPythonDevice

beforeEach(async () => {
  listVolumes.mockClear()
  mount = await mkdtemp(join(tmpdir(), 'snakie-route-'))
  await writeFile(join(mount, 'boot_out.txt'), 'Adafruit CircuitPython 10.2.1 on 2026-08-18; Feather\n')
  await mkdir(join(mount, 'lib'))
  await writeFile(join(mount, 'code.py'), 'print("hi")\n')
  device = new MicroPythonDevice()
  ;(device as unknown as WithMount).mount = mount
})

afterEach(async () => {
  await device.dispose()
  await rm(mount, { recursive: true, force: true })
})

describe('with a CIRCUITPY drive, every filesystem method uses it', () => {
  it('listDir', async () => {
    const names = (await device.listDir('/')).map((e) => e.name).sort()
    expect(names).toEqual(['boot_out.txt', 'code.py', 'lib'])
  })

  it('readFile', async () => {
    expect(await device.readFile('/code.py')).toBe('print("hi")\n')
  })

  it('readFileBytes', async () => {
    expect((await device.readFileBytes('/code.py')).toString()).toBe('print("hi")\n')
  })

  it('readFileLine', async () => {
    await writeFile(join(mount, 'lib', 'drv.py'), 'x = 1\n__version__ = "2.0.0"\n')
    expect(await device.readFileLine('/lib/drv.py', '__version__')).toBe('__version__ = "2.0.0"')
  })

  it('writeFile', async () => {
    await device.writeFile('/lib/new.py', 'y = 2\n')
    expect(await readFile(join(mount, 'lib', 'new.py'), 'utf8')).toBe('y = 2\n')
  })

  it('writeFile with binary content', async () => {
    const bytes = Buffer.from([0, 255, 10, 13])
    await device.writeFile('/blob.bin', bytes)
    expect(await readFile(join(mount, 'blob.bin'))).toEqual(bytes)
  })

  it('mkdir', async () => {
    await device.mkdir('/data')
    expect((await device.stat('/data')).isDir).toBe(true)
  })

  it('rename', async () => {
    await device.rename('/code.py', '/main.py')
    expect(await device.readFile('/main.py')).toBe('print("hi")\n')
  })

  it('remove', async () => {
    await device.remove('/code.py')
    expect((await device.listDir('/')).map((e) => e.name)).not.toContain('code.py')
  })

  it('stat', async () => {
    const st = await device.stat('/code.py')
    expect(st).toMatchObject({ isDir: false, size: 'print("hi")\n'.length })
  })

  it('driveUsage, for the flash gauge (#211)', async () => {
    const usage = await device.driveUsage()
    expect(usage?.total).toBeGreaterThan(0)
  })
})

describe('without a drive, everything falls back to the REPL', () => {
  beforeEach(() => {
    ;(device as unknown as WithMount).mount = null
  })

  it('does not silently succeed — a MicroPython board must still go over the wire', async () => {
    // "Not connected" IS the pass: it proves the call reached the REPL path
    // rather than being served by a stale mount.
    await expect(device.readFile('/code.py')).rejects.toThrow(/not connected/i)
    await expect(device.writeFile('/code.py', 'x')).rejects.toThrow(/not connected/i)
    await expect(device.listDir('/')).rejects.toThrow(/not connected/i)
  })

  it('reports no drive usage, so the gauge asks the board instead', async () => {
    expect(await device.driveUsage()).toBeNull()
  })
})

describe('a drive that ejected', () => {
  it('is not trusted — a soft reboot unmounts it, and the path stops existing', async () => {
    // The board rebooted and the OS tore the mount down.
    await rm(mount, { recursive: true, force: true })
    // Re-resolution finds nothing (the stub reports no volumes mounted), so the
    // call falls back to the REPL rather than throwing ENOENT from a dead path.
    await expect(device.readFile('/code.py')).rejects.toThrow(/not connected/i)
    expect((device as unknown as WithMount).mount).toBeNull()
    // It genuinely went looking again, rather than just forgetting the mount.
    expect(listVolumes).toHaveBeenCalled()
  })

  it('keeps using a drive that is still there', async () => {
    expect(await device.readFile('/code.py')).toBe('print("hi")\n')
    expect((device as unknown as WithMount).mount).toBe(mount)
    // One `stat` of the marker file settled it: a live drive must not cost a
    // rescan of every volume on the machine, on every file operation.
    expect(listVolumes).not.toHaveBeenCalled()
  })
})

describe('path safety', () => {
  it('refuses a device path that would escape onto the user\'s computer', async () => {
    await expect(device.writeFile('../../evil.py', 'x')).rejects.toThrow(/outside the board/i)
    await expect(device.readFile('/lib/../../../etc/passwd')).rejects.toThrow(/outside the board/i)
  })
})
