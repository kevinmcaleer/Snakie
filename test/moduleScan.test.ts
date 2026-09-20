import { describe, it, expect, vi } from 'vitest'
import {
  MAX_SCAN_BYTES,
  memberCount,
  scanDeviceModules,
  scanProjectModules,
  unscannedDeviceNames,
  type DetectedModule,
  type ScanEntry,
  type ScanReaders
} from '../src/renderer/src/lib/module-scan'
import { readModuleApi } from '../src/renderer/src/lib/blocks/module-api'

/**
 * WHAT IS ACTUALLY THERE — the Modules shelf's detected section.
 * =============================================================================
 *
 * The scanner is pure: it is handed a lister and a reader and turns `.py`
 * files into parsed rows. These pin what it picks (only `.py`, only files),
 * where it looks on a board (`/` then `/lib`, `/` winning a clash), and that
 * nothing it meets — a vanished file, a dead board — ever throws.
 */

const SERVO = `
from machine import PWM

MIN_US = 500
MAX_US = 2500
default_pin = 15

class Servo:
    def __init__(self, pin, freq=50):
        pass

    def write_angle(self, degrees):
        pass

def sweep(servo, start, end, step=1):
    pass
`

const fsOf = (files: Record<string, string>, dirs: Record<string, ScanEntry[]>): ScanReaders => ({
  list: async (path) => {
    if (!(path in dirs)) throw new Error(`no such dir ${path}`)
    return dirs[path]
  },
  read: async (path) => {
    if (!(path in files)) throw new Error(`no such file ${path}`)
    return files[path]
  }
})

describe('the folder beside the program', () => {
  it('parses every top-level .py and nothing else', async () => {
    const readers = fsOf(
      { '/home/kev/robot/servo.py': SERVO, '/home/kev/robot/main.py': 'x = 1\n' },
      {
        '/home/kev/robot': [
          { name: 'servo.py', isDir: false, size: SERVO.length },
          { name: 'main.py', isDir: false, size: 6 },
          { name: 'README.md', isDir: false, size: 10 },
          { name: 'lib', isDir: true }
        ]
      }
    )
    const rows = await scanProjectModules('/home/kev/robot', readers)
    expect(rows.map((r) => [r.name, r.origin, r.path])).toEqual([
      ['main', 'project', '/home/kev/robot/main.py'],
      ['servo', 'project', '/home/kev/robot/servo.py']
    ])
    const servo = rows[1].api!
    expect(servo.classes.map((c) => c.name)).toEqual(['Servo'])
    expect(servo.classes[0].methods.map((m) => m.name)).toEqual(['write_angle'])
    expect(servo.functions.map((f) => f.name)).toEqual(['sweep'])
    expect(servo.constants).toEqual(['MIN_US', 'MAX_US'])
    expect(servo.variables).toEqual(['default_pin'])
    expect(memberCount(servo)).toBe(5)
  })

  it('is empty with no folder, and with one that cannot be listed', async () => {
    const readers = fsOf({}, {})
    expect(await scanProjectModules(null, readers)).toEqual([])
    expect(await scanProjectModules('/gone', readers)).toEqual([])
  })

  it('marks a file that vanished between the listing and the read', async () => {
    const readers = fsOf({}, { '/p': [{ name: 'ghost.py', isDir: false, size: 3 }] })
    const [row] = await scanProjectModules('/p', readers)
    expect(row.skipped).toBe('unreadable')
    expect(row.api).toBeUndefined()
  })

  it('does not read a file too big to be a driver', async () => {
    const read = vi.fn(async () => SERVO)
    const rows = await scanProjectModules('/p', {
      list: async () => [{ name: 'font.py', isDir: false, size: MAX_SCAN_BYTES + 1 }],
      read
    })
    expect(rows[0].skipped).toBe('too-large')
    expect(read).not.toHaveBeenCalled()
  })

  it('uses the folder separator the folder already uses', async () => {
    const rows = await scanProjectModules('C:\\robot', {
      list: async () => [{ name: 'a.py', isDir: false }],
      read: async () => ''
    })
    expect(rows[0].path).toBe('C:\\robot\\a.py')
  })
})

describe('the board', () => {
  it('looks in / and /lib, and / wins a name present in both', async () => {
    const readers = fsOf(
      {
        '/main.py': 'x = 1\n',
        '/ssd1306.py': 'class Root:\n    pass\n',
        '/lib/ssd1306.py': 'class Lib:\n    pass\n',
        '/lib/servo.py': SERVO
      },
      {
        '/': [
          { name: 'main.py', isDir: false, size: 6 },
          { name: 'ssd1306.py', isDir: false, size: 20 },
          { name: 'lib', isDir: true, size: 0 },
          { name: 'data.json', isDir: false, size: 2 }
        ],
        '/lib': [
          { name: 'ssd1306.py', isDir: false, size: 20 },
          { name: 'servo.py', isDir: false, size: SERVO.length }
        ]
      }
    )
    const rows = await scanDeviceModules(readers)
    expect(rows.map((r) => [r.name, r.path])).toEqual([
      ['main', '/main.py'],
      ['servo', '/lib/servo.py'],
      ['ssd1306', '/ssd1306.py']
    ])
    expect(rows[2].api!.classes[0].name).toBe('Root')
  })

  it('survives a board with no /lib', async () => {
    const readers = fsOf({ '/main.py': '' }, { '/': [{ name: 'main.py', isDir: false }] })
    expect((await scanDeviceModules(readers)).map((r) => r.name)).toEqual(['main'])
  })

  it('is empty when nothing can be listed', async () => {
    expect(await scanDeviceModules(fsOf({}, {}))).toEqual([])
  })

  it('reads sequentially, because there is one serial port', async () => {
    let inFlight = 0
    let peak = 0
    const readers: ScanReaders = {
      list: async () => [
        { name: 'a.py', isDir: false },
        { name: 'b.py', isDir: false }
      ],
      read: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        inFlight -= 1
        return ''
      }
    }
    await scanDeviceModules(readers)
    expect(peak).toBe(1)
  })
})

describe('module-level variables', () => {
  it('are the public lower-case assignments, constants aside', () => {
    const api = readModuleApi('m', [
      'i2c = I2C(0)',
      'width: int = 128',
      'a, b = 1, 2',
      'RATE = 50',
      '_cache = {}',
      'x == 1',
      'x += 1',
      'if y == 2:',
      '    z = 3'
    ].join('\n'))
    expect(api.variables).toEqual(['i2c', 'width', 'a', 'b'])
    expect(api.constants).toEqual(['RATE'])
  })
})

/**
 * The gap between what the FILE scan can read and what the board can actually
 * import (#1254) — the bug an Arduino Alvik exposed: its whole vendor library
 * is a `/lib` PACKAGE, so a scan that lists `.py` files in two directories saw
 * nothing and the panel reported an empty board.
 */
describe('unscannedDeviceNames', () => {
  const row = (name: string): DetectedModule => ({
    name,
    origin: 'device',
    path: `/lib/${name}.py`
  })

  it('names the importable modules the file scan could not account for', () => {
    // `arduino_alvik` is a package directory, `ucPack` a .mpy — neither is a
    // `.py` file in / or /lib, so neither can appear in the scanned rows.
    expect(
      unscannedDeviceNames(['arduino_alvik', 'ssd1306', 'ucPack'], [row('ssd1306')])
    ).toEqual(['arduino_alvik', 'ucPack'])
  })

  it('says nothing about a module the scan already read', () => {
    expect(unscannedDeviceNames(['ssd1306'], [row('ssd1306')])).toEqual([])
  })

  it('de-duplicates and sorts, so a re-scan never shuffles the list', () => {
    expect(unscannedDeviceNames(['b', 'a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('is empty when the probe found nothing — never invents a row', () => {
    expect(unscannedDeviceNames([], [row('ssd1306')])).toEqual([])
  })
})
