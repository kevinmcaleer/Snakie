import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectMicrobitDrive,
  detectRp2040Drive,
  microbitVersionFromDetails,
  microbitMaintenanceFromDetails
} from '../src/main/firmware/detect'
import { listVolumes } from '../src/main/fs/volumes'

/**
 * `microbitVersionFromDetails` reads the BBC micro:bit generation from the
 * `Board ID` line DAPLink writes into DETAILS.TXT on the MICROBIT drive:
 * 9900/9901 = v1 (nRF51), 9903–9906 = v2 (nRF52833). Used to pre-select the
 * matching firmware family in the flash dialog.
 */
describe('microbitVersionFromDetails', () => {
  const details = (boardId: string): string =>
    ['# DAPLink Firmware - see https://daplink.io', 'Unique ID: 99040000abcd', `Board ID: ${boardId}`, 'Family ID: 0x0000'].join('\n')

  it('maps 9900 / 9901 to v1', () => {
    expect(microbitVersionFromDetails(details('9900'))).toBe('v1')
    expect(microbitVersionFromDetails(details('9901'))).toBe('v1')
  })

  it('maps 9903–9906 to v2', () => {
    for (const id of ['9903', '9904', '9905', '9906']) {
      expect(microbitVersionFromDetails(details(id))).toBe('v2')
    }
  })

  it('is case-insensitive on the field name', () => {
    expect(microbitVersionFromDetails('board id: 9904')).toBe('v2')
  })

  it('returns undefined when there is no Board ID or it is unrecognised', () => {
    expect(microbitVersionFromDetails('no board id here')).toBeUndefined()
    expect(microbitVersionFromDetails(details('1234'))).toBeUndefined()
  })
})

describe('microbitMaintenanceFromDetails', () => {
  it('detects bootloader / maintenance mode', () => {
    expect(microbitMaintenanceFromDetails('DAPLink Mode: Bootloader')).toBe(true)
    expect(microbitMaintenanceFromDetails('daplink mode: maintenance')).toBe(true)
  })

  it('treats interface mode (and a missing line) as NOT maintenance', () => {
    expect(microbitMaintenanceFromDetails('DAPLink Mode: Interface')).toBe(false)
    expect(microbitMaintenanceFromDetails('Board ID: 9904')).toBe(false)
  })
})

/**
 * The DRIVE SCANNING behind those parsers, against real fixture directories.
 *
 * `detect.ts` used to hand-roll the per-platform mount walk twice; #753 needed a
 * third copy for CIRCUITPY, so the walk moved to `fs/volumes.ts` and both
 * detectors now take the volume list. This pins that the marker/label rules
 * survived that move — they had no test before it.
 */
describe('drive detection over a volume list', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'snakie-boards-'))
    const vol = async (name: string, files: Record<string, string>): Promise<void> => {
      await mkdir(join(root, name), { recursive: true })
      for (const [f, body] of Object.entries(files)) await writeFile(join(root, name, f), body)
    }
    await vol('RPI-RP2', { 'INFO_UF2.TXT': 'Model: Raspberry Pi RP2\n', 'INDEX.HTM': '' })
    await vol('MICROBIT', { 'DETAILS.TXT': 'Board ID: 9903\nDAPLink Mode: Interface\n' })
    await vol('MAINTENANCE', { 'DETAILS.TXT': 'Board ID: 9903\nDAPLink Mode: Bootloader\n' })
    // A drive with the marker but NO recognisable label — the Windows case,
    // where a volume is a bare letter.
    await vol('E', { 'info_uf2.txt': 'Model: Raspberry Pi RP2\n' })
    await vol('Untitled', { 'holiday.jpg': '' })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds a BOOTSEL drive by label and by marker file alone', async () => {
    const found = await detectRp2040Drive(await listVolumes([root]))
    const names = found.map((c) => c.mountPath.split(/[/\\]/).pop())
    expect(names).toContain('RPI-RP2')
    expect(names).toContain('E') // no label, found by INFO_UF2.TXT
    expect(names).not.toContain('Untitled')
    expect(found[0].board).toBe('rp2040')
    expect(found[0].source).toBe('uf2-drive')
  })

  it('finds a micro:bit and reads its generation from DETAILS.TXT', async () => {
    const found = await detectMicrobitDrive(await listVolumes([root]))
    const normal = found.find((c) => c.mountPath.endsWith('MICROBIT'))
    expect(normal?.microbitVersion).toBe('v2')
    expect(normal?.maintenance).toBe(false)
  })

  it('flags maintenance mode, which cannot be flashed', async () => {
    const found = await detectMicrobitDrive(await listVolumes([root]))
    const maint = found.find((c) => c.mountPath.endsWith('MAINTENANCE'))
    expect(maint?.maintenance).toBe(true)
    expect(maint?.label).toContain('reconnect to flash')
  })

  it('finds nothing in an empty volume list, rather than throwing', async () => {
    expect(await detectRp2040Drive([])).toEqual([])
    expect(await detectMicrobitDrive([])).toEqual([])
  })
})
