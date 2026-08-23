import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { listVolumes, readVolumeFile, volumeHasFile } from '../src/main/fs/volumes'
import {
  annotatePortsWithDrives,
  findCircuitPyDrives,
  pairDriveToPort,
  type CircuitPyDrive
} from '../src/main/device/circuitpy'
import { VIRTUAL_PORT_PATH } from '../src/shared/virtual-device'
import type { PortInfo } from '../src/main/device/types'

/**
 * CIRCUITPY DRIVE DETECTION (#753, epic #209).
 *
 * The scanning half runs against REAL directories in a temp dir — the volume
 * roots are injectable precisely so this is possible, and the machinery it
 * shares with the UF2/micro:bit detectors in `firmware/detect.ts` had no test
 * at all before. The pairing half is pure, and is where the care is: writing a
 * file to the wrong board is a silent failure, so "refuses to guess" is the
 * property under test.
 */

const bootOut = (version: string, board: string, uid?: string): string =>
  [
    `Adafruit CircuitPython ${version} on 2026-08-18; ${board} with rp2040`,
    `Board ID:${board.toLowerCase().replace(/\s+/g, '_')}`,
    ...(uid ? [`UID:${uid}`] : []),
    ''
  ].join('\r\n')

let root: string

/**
 * A temp "mount root" holding several volumes:
 *   CIRCUITPY   — a modern board, with a UID
 *   FEATHERBOOT — a UF2 bootloader volume (not CircuitPython)
 *   MY_STUFF    — a renamed CircuitPython drive, no UID (an older board)
 *   Untitled    — an ordinary USB stick
 */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'snakie-vol-'))
  const vol = async (name: string, files: Record<string, string>): Promise<void> => {
    await mkdir(join(root, name), { recursive: true })
    for (const [f, body] of Object.entries(files)) await writeFile(join(root, name, f), body)
  }
  await vol('CIRCUITPY', {
    'boot_out.txt': bootOut('10.2.1', 'Adafruit Feather RP2040', 'E661640843373E2A'),
    'code.py': 'print("hi")\n'
  })
  await vol('FEATHERBOOT', { 'INFO_UF2.TXT': 'UF2 Bootloader\n' })
  // Renamed drive, older CircuitPython: no UID line. Also spelt in the other
  // case, which a vfat mount can do.
  await vol('MY_STUFF', { 'BOOT_OUT.TXT': bootOut('6.3.0', 'Raspberry Pi Pico') })
  await vol('Untitled', { 'notes.txt': 'shopping list' })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('listVolumes', () => {
  it('lists each mounted volume under a root, carrying its label', async () => {
    const vols = await listVolumes([root])
    expect(vols.map((v) => v.name).sort()).toEqual(['CIRCUITPY', 'FEATHERBOOT', 'MY_STUFF', 'Untitled'])
    expect(vols.every((v) => v.mountPath.startsWith(root))).toBe(true)
  })

  it('ignores roots that do not exist, which is the normal case for most of them', async () => {
    const vols = await listVolumes([join(root, 'nope'), root, '/definitely/not/here'])
    expect(vols).toHaveLength(4)
  })

  it('de-duplicates, so a repeated root costs nothing but a readdir', async () => {
    expect(await listVolumes([root, root])).toHaveLength(4)
  })

  it('is empty, not thrown, for no roots at all', async () => {
    expect(await listVolumes([])).toEqual([])
  })

  it('marks entries under a mount root as worth reading', async () => {
    const vols = await listVolumes([root])
    expect(vols.every((v) => v.probeContents)).toBe(true)
  })

  it('does NOT mark the home directory, whose entries are folders, not volumes', async () => {
    // `listPorts` refreshes on every dropdown focus and now scans volumes with
    // it; content-probing each folder in $HOME would mean a readdir apiece.
    // A board mounted there is still found by its LABEL — only the probe is off.
    const vols = await listVolumes([homedir()])
    expect(vols.length).toBeGreaterThan(0)
    expect(vols.every((v) => v.probeContents === false)).toBe(true)
  })
})

describe('volume file helpers', () => {
  it('finds a marker file case-insensitively — vfat mounts vary', async () => {
    expect(await volumeHasFile(join(root, 'MY_STUFF'), ['boot_out.txt'])).toBe(true)
    expect(await volumeHasFile(join(root, 'CIRCUITPY'), ['BOOT_OUT.TXT'])).toBe(true)
    expect(await volumeHasFile(join(root, 'Untitled'), ['boot_out.txt'])).toBe(false)
  })

  it('matches any of several markers', async () => {
    expect(await volumeHasFile(join(root, 'FEATHERBOOT'), ['INDEX.HTM', 'INFO_UF2.TXT'])).toBe(true)
  })

  it('reads a marker file, and is null rather than throwing when it is absent', async () => {
    expect(await readVolumeFile(join(root, 'CIRCUITPY'), 'boot_out.txt')).toContain('CircuitPython')
    expect(await readVolumeFile(join(root, 'Untitled'), 'boot_out.txt')).toBeNull()
    expect(await readVolumeFile(join(root, 'gone'), 'boot_out.txt')).toBeNull()
  })
})

describe('findCircuitPyDrives', () => {
  it('finds CircuitPython volumes and reads their identity from boot_out.txt', async () => {
    const drives = await findCircuitPyDrives([root])
    expect(drives).toHaveLength(2)
    const feather = drives.find((d) => d.mountPath.endsWith('CIRCUITPY'))
    expect(feather?.runtime).toMatchObject({
      dialect: 'circuitpython',
      version: '10.2.1',
      boardId: 'adafruit_feather_rp2040'
    })
    expect(feather?.uid).toBe('E661640843373E2A')
  })

  it('finds a RENAMED drive — the marker file decides, not the label', async () => {
    const drives = await findCircuitPyDrives([root])
    const renamed = drives.find((d) => d.mountPath.endsWith('MY_STUFF'))
    expect(renamed?.runtime.version).toBe('6.3.0')
    // An older CircuitPython writes no UID line, which is why pairing has a fallback.
    expect(renamed?.uid).toBeUndefined()
  })

  it('ignores a UF2 bootloader volume and an ordinary USB stick', async () => {
    const paths = (await findCircuitPyDrives([root])).map((d) => d.mountPath)
    expect(paths.some((p) => p.endsWith('FEATHERBOOT'))).toBe(false)
    expect(paths.some((p) => p.endsWith('Untitled'))).toBe(false)
  })

  it('is empty when nothing is mounted, rather than throwing', async () => {
    expect(await findCircuitPyDrives(['/no/such/root'])).toEqual([])
  })
})

describe('pairDriveToPort', () => {
  const drive = (mountPath: string, uid?: string): CircuitPyDrive => ({
    mountPath,
    runtime: { dialect: 'circuitpython', version: '10.2.1' },
    ...(uid ? { uid } : {})
  })
  const port = (path: string, serialNumber?: string): PortInfo => ({ path, ...(serialNumber ? { serialNumber } : {}) })

  it('matches a drive to its port by the board id, with no connection needed', () => {
    const drives = [drive('/A', 'AAAA1111'), drive('/B', 'BBBB2222')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM1', 'BBBB2222'), [
      port('/dev/ttyACM0', 'AAAA1111'),
      port('/dev/ttyACM1', 'BBBB2222')
    ])
    expect(got).toEqual({ drive: drives[1], confidence: 'uid' })
  })

  it('normalises case and separators — the OS does not report the id verbatim', () => {
    const drives = [drive('/A', 'E661640843373E2A')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0', 'e66164:08-43373e2a'), [])
    expect(got).toMatchObject({ confidence: 'uid' })
  })

  it('falls back to one-drive-one-board when the board is too old to write a UID', () => {
    const drives = [drive('/A')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0'), [port('/dev/ttyACM0')])
    expect(got).toEqual({ drive: drives[0], confidence: 'sole' })
  })

  it('does not count the simulated device as a rival board — it has no drive', () => {
    const drives = [drive('/A')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0'), [
      port('/dev/ttyACM0'),
      port(VIRTUAL_PORT_PATH)
    ])
    expect(got).toEqual({ drive: drives[0], confidence: 'sole' })
  })

  it('REFUSES to pair two boards and one unidentified drive — the drive may be the other one\'s', () => {
    const drives = [drive('/A')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0'), [
      port('/dev/ttyACM0'),
      port('/dev/ttyACM1')
    ])
    expect(got).toEqual({ drive: null, why: 'ambiguous' })
  })

  it('REFUSES to pair one board with two unidentified drives', () => {
    const drives = [drive('/A'), drive('/B')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0'), [port('/dev/ttyACM0')])
    expect(got).toEqual({ drive: null, why: 'ambiguous' })
  })

  it('says no-drives rather than ambiguous when there is simply nothing mounted', () => {
    expect(pairDriveToPort([], port('/dev/ttyACM0'))).toEqual({ drive: null, why: 'no-drives' })
  })

  it('still matches by id when a second board would otherwise make it ambiguous', () => {
    const drives = [drive('/A', 'AAAA1111'), drive('/B')]
    const got = pairDriveToPort(drives, port('/dev/ttyACM0', 'AAAA1111'), [
      port('/dev/ttyACM0', 'AAAA1111'),
      port('/dev/ttyACM1')
    ])
    expect(got).toEqual({ drive: drives[0], confidence: 'uid' })
  })
})

describe('annotatePortsWithDrives', () => {
  it('names the board on the port it belongs to, before anything is connected', async () => {
    const ports: PortInfo[] = [{ path: '/dev/ttyACM0', serialNumber: 'E661640843373E2A' }]
    const [annotated] = await annotatePortsWithDrives(ports, [root])
    expect(annotated.circuitpy).toMatchObject({
      version: '10.2.1',
      boardId: 'adafruit_feather_rp2040',
      confidence: 'uid'
    })
    expect(annotated.circuitpy?.mountPath).toContain('CIRCUITPY')
  })

  it('leaves a port it cannot tie to a drive untouched', async () => {
    // Two drives are mounted and this port matches neither by id.
    const ports: PortInfo[] = [{ path: '/dev/ttyACM0', serialNumber: 'FFFF9999' }]
    const [annotated] = await annotatePortsWithDrives(ports, [root])
    expect(annotated.circuitpy).toBeUndefined()
  })

  it('never annotates the simulated device', async () => {
    const ports: PortInfo[] = [{ path: VIRTUAL_PORT_PATH, friendlyName: 'Simulated device' }]
    const [annotated] = await annotatePortsWithDrives(ports, [root])
    expect(annotated.circuitpy).toBeUndefined()
  })

  it('returns the ports unchanged when nothing is mounted', async () => {
    const ports: PortInfo[] = [{ path: '/dev/ttyACM0' }]
    expect(await annotatePortsWithDrives(ports, ['/no/such/root'])).toEqual(ports)
  })
})
