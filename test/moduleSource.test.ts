import { describe, it, expect, vi } from 'vitest'
import {
  findModuleSource,
  joinPath,
  type ModuleSourceReaders
} from '../src/renderer/src/lib/blocks/module-source'

/**
 * WHERE A MODULE'S SOURCE LIVES (#1048).
 * =============================================================================
 *
 * The ORDER is the design, so the order is what these pin: nearest copy first,
 * because the nearest copy is the one that wins at runtime. A board's stale
 * `/lib/ssd1306.py` must not describe the newer file sitting beside the program.
 */

const readers = (over: Partial<ModuleSourceReaders> = {}): ModuleSourceReaders => ({
  folder: '/home/kev/robot',
  readLocal: vi.fn(async () => {
    throw new Error('no such file')
  }),
  readDevice: vi.fn(async () => {
    throw new Error('no such file')
  }),
  readBundled: vi.fn(async () => ''),
  ...over
})

describe('the order it looks in', () => {
  it('prefers the copy beside the program', async () => {
    const r = readers({
      readLocal: async () => 'project copy',
      readDevice: async () => 'board copy',
      readBundled: async () => 'bundled copy'
    })
    expect(await findModuleSource('ssd1306', r)).toEqual({
      module: 'ssd1306',
      origin: 'project',
      text: 'project copy'
    })
  })

  it('falls back to the board, /lib first', async () => {
    const seen: string[] = []
    const r = readers({
      readDevice: async (p) => {
        seen.push(p)
        if (p === '/lib/ssd1306.py') return 'board copy'
        throw new Error('no')
      }
    })
    expect((await findModuleSource('ssd1306', r))?.origin).toBe('device')
    expect(seen).toEqual(['/lib/ssd1306.py'])
  })

  it('then the board root, where a hand-copied driver lands', async () => {
    const seen: string[] = []
    const r = readers({
      readDevice: async (p) => {
        seen.push(p)
        if (p === '/ssd1306.py') return 'board root copy'
        throw new Error('no')
      }
    })
    expect((await findModuleSource('ssd1306', r))?.text).toBe('board root copy')
    expect(seen).toEqual(['/lib/ssd1306.py', '/ssd1306.py'])
  })

  it('then the modules Snakie ships', async () => {
    const r = readers({ readBundled: async () => 'bundled copy' })
    expect((await findModuleSource('hcsr04', r))?.origin).toBe('bundled')
  })

  it('and gives up quietly when nothing has it', async () => {
    // Not an error condition: a module we cannot read is one whose blocks come
    // from the curated tables, or from the board-side probe, or not at all.
    expect(await findModuleSource('nowhere', readers())).toBeNull()
  })
})

describe('what counts as "not here"', () => {
  it('a reader that throws', async () => {
    const r = readers({
      readLocal: async () => {
        throw new Error('EACCES')
      },
      readBundled: async () => 'bundled'
    })
    expect((await findModuleSource('m', r))?.origin).toBe('bundled')
  })

  it('an empty file, which describes nothing', async () => {
    const r = readers({ readLocal: async () => '   \n', readBundled: async () => 'bundled' })
    expect((await findModuleSource('m', r))?.origin).toBe('bundled')
  })

  it('no folder open, and no board connected', async () => {
    const r = readers({ folder: null, readDevice: null, readBundled: async () => 'bundled' })
    expect((await findModuleSource('m', r))?.origin).toBe('bundled')
  })
})

describe('what it refuses to look for', () => {
  it('anything that is not a module name', async () => {
    // A path traversal dressed as an import is the reason this is a whitelist
    // rather than an escape.
    const readLocal = vi.fn(async () => 'nope')
    for (const bad of ['../secrets', 'a/b', 'a.b', '', 'has space']) {
      expect(await findModuleSource(bad, readers({ readLocal }))).toBeNull()
    }
    expect(readLocal).not.toHaveBeenCalled()
  })
})

describe('joining a folder to a file', () => {
  it('uses the separator the folder already uses', () => {
    expect(joinPath('/home/kev/robot', 'a.py')).toBe('/home/kev/robot/a.py')
    expect(joinPath('C:\\Users\\kev', 'a.py')).toBe('C:\\Users\\kev\\a.py')
  })

  it('does not double a trailing separator', () => {
    expect(joinPath('/home/kev/', 'a.py')).toBe('/home/kev/a.py')
    expect(joinPath('C:\\Users\\kev\\', 'a.py')).toBe('C:\\Users\\kev\\a.py')
  })
})
