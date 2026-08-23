import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyBundledCopy,
  probeOutdatedModules
} from '../src/renderer/src/lib/moduleFreshness'
import { moduleById } from '../src/shared/modules-catalog'

/**
 * Unit tests for the bundled-driver freshness probe (#707): how a board's /lib
 * copy classifies against the catalog-declared version, and that the device
 * probe only ever claims staleness for the /lib copy Snakie manages.
 */

/** Stub `window.api.device` with canned stat/readFileLine outcomes. */
function stubDevice(opts: {
  stat: (path: string) => Promise<unknown>
  readFileLine: (path: string, prefix: string) => Promise<string>
}): { stat: ReturnType<typeof vi.fn>; readFileLine: ReturnType<typeof vi.fn> } {
  const stat = vi.fn(opts.stat)
  const readFileLine = vi.fn(opts.readFileLine)
  vi.stubGlobal('window', { api: { device: { stat, readFileLine } } })
  return { stat, readFileLine }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classifyBundledCopy', () => {
  it('a /lib copy declaring exactly the shipped version is current', () => {
    expect(classifyBundledCopy(true, '__version__ = "1.0.0"', '1.0.0')).toBe('current')
  })

  it('a differing version is outdated', () => {
    expect(classifyBundledCopy(true, '__version__ = "0.9.0"', '1.0.0')).toBe('outdated')
  })

  it('a legacy copy with no version line is outdated', () => {
    // readFileLine returns '' when no line matches — the pre-#707 installs.
    expect(classifyBundledCopy(true, '', '1.0.0')).toBe('outdated')
  })

  it('an unreadable copy is outdated (differs from the known shipped version)', () => {
    expect(classifyBundledCopy(true, null, '1.0.0')).toBe('outdated')
  })

  it('no /lib copy at all is unmanaged — never claimed stale', () => {
    // The import resolved from somewhere we do not own (a root shadow, frozen
    // firmware); nagging would offer an update that cannot clear.
    expect(classifyBundledCopy(false, null, '1.0.0')).toBe('unmanaged')
  })
})

describe('probeOutdatedModules', () => {
  const lsm6ds3 = moduleById('lsm6ds3')!
  const shipped = lsm6ds3.source.kind === 'bundled' ? lsm6ds3.source.version : ''
  const mipModule = moduleById('ssd1306')!

  it('flags a /lib copy whose version line differs', async () => {
    stubDevice({
      stat: async () => ({}),
      readFileLine: async () => '__version__ = "0.0.1"'
    })
    const out = await probeOutdatedModules([lsm6ds3])
    expect(out.has('lsm6ds3')).toBe(true)
  })

  it('passes a /lib copy declaring the shipped version', async () => {
    stubDevice({
      stat: async () => ({}),
      readFileLine: async () => `__version__ = "${shipped}"`
    })
    const out = await probeOutdatedModules([lsm6ds3])
    expect(out.size).toBe(0)
  })

  it('flags a legacy /lib copy with no version line', async () => {
    stubDevice({
      stat: async () => ({}),
      readFileLine: async () => ''
    })
    const out = await probeOutdatedModules([lsm6ds3])
    expect(out.has('lsm6ds3')).toBe(true)
  })

  it('skips a module with no /lib copy (imported from somewhere unmanaged)', async () => {
    const { readFileLine } = stubDevice({
      stat: async () => {
        throw new Error('ENOENT')
      },
      readFileLine: async () => ''
    })
    const out = await probeOutdatedModules([lsm6ds3])
    expect(out.size).toBe(0)
    // And the version read is never attempted — the stat already answered.
    expect(readFileLine).not.toHaveBeenCalled()
  })

  it('skips mip modules entirely (upstream owns their versions)', async () => {
    const { stat } = stubDevice({
      stat: async () => ({}),
      readFileLine: async () => ''
    })
    const out = await probeOutdatedModules([mipModule])
    expect(out.size).toBe(0)
    expect(stat).not.toHaveBeenCalled()
  })

  it('a failed line-read on an existing copy reads outdated, not a crash', async () => {
    stubDevice({
      stat: async () => ({}),
      readFileLine: async () => {
        throw new Error('board busy')
      }
    })
    const out = await probeOutdatedModules([lsm6ds3])
    expect(out.has('lsm6ds3')).toBe(true)
  })
})
