import { describe, expect, it } from 'vitest'
import {
  capabilitiesFrom,
  chooseMipRoute,
  hostInstallNote,
  looksLikeMissingMip,
  mipInstallFailureMessage
} from '../src/shared/install-strategy'
import type { RuntimeInfo } from '../src/shared/dialect'

/**
 * DRIVER-INSTALL STRATEGY (#776).
 *
 * Two rules, both of which cost a hardware round-trip to learn: route on the
 * `mip` CAPABILITY rather than the dialect, and never hand the user a bare
 * board-level error when an install can't proceed. These test the properties
 * that keep them true — including the specific board that disproved the
 * dialect-based framing (a Pimoroni Tiny 2350 reporting `micropython` with no
 * `mip`).
 */

const TINY_2350: RuntimeInfo = {
  dialect: 'micropython',
  version: 'feature/psram-and-wifi',
  machine: 'Pimoroni Tiny 2350',
  hasMip: false
}

describe('chooseMipRoute', () => {
  it('takes the host route ONLY when the board said it has no mip', () => {
    expect(chooseMipRoute({ hasMip: false })).toBe('host')
  })

  it('keeps the on-board route when the board has mip', () => {
    expect(chooseMipRoute({ hasMip: true })).toBe('mip')
  })

  it('treats "not known" as "try the board" — never as "it has none"', () => {
    // The probe answers a moment after connect and can miss. Defaulting to the
    // fallback would push every board down the host route; the retry on a
    // missing-mip error covers this case instead.
    expect(chooseMipRoute({})).toBe('mip')
    expect(chooseMipRoute()).toBe('mip')
  })

  it('routes on the capability, not the dialect — the #776 board proves the difference', () => {
    // Same dialect, opposite routes. A dialect-based rule cannot express this.
    expect(chooseMipRoute(capabilitiesFrom(TINY_2350))).toBe('host')
    expect(chooseMipRoute(capabilitiesFrom({ dialect: 'micropython', hasMip: true }))).toBe('mip')
    // And CircuitPython is not special-cased: it takes the host route because
    // it ANSWERED that it has no mip, for exactly the same reason.
    expect(chooseMipRoute(capabilitiesFrom({ dialect: 'circuitpython', hasMip: false }))).toBe(
      'host'
    )
  })
})

describe('capabilitiesFrom', () => {
  it('carries a definite answer through, in both directions', () => {
    expect(capabilitiesFrom({ dialect: 'micropython', hasMip: false })).toEqual({ hasMip: false })
    expect(capabilitiesFrom({ dialect: 'micropython', hasMip: true })).toEqual({ hasMip: true })
  })

  it('reports nothing for a runtime that never answered, or none at all', () => {
    expect(capabilitiesFrom({ dialect: 'micropython' })).toEqual({})
    expect(capabilitiesFrom(null)).toEqual({})
    expect(capabilitiesFrom(undefined)).toEqual({})
  })
})

describe('looksLikeMissingMip', () => {
  it('recognises the exact error both #769 and #776 reported', () => {
    expect(looksLikeMissingMip(`ImportError("no module named 'mip'",)`)).toBe(true)
    expect(looksLikeMissingMip('ImportError: no module named mip')).toBe(true)
    expect(looksLikeMissingMip("ModuleNotFoundError: No module named 'mip'")).toBe(true)
  })

  it('does NOT fire for a different module going missing', () => {
    // The install of `ssd1306` failing because the DRIVER is unimportable is a
    // different problem; retrying it down the host route would hide it.
    expect(looksLikeMissingMip(`ImportError("no module named 'ssd1306'",)`)).toBe(false)
    expect(looksLikeMissingMip("ImportError: no module named 'requests'")).toBe(false)
  })

  it('does not fire on ordinary output or an empty log', () => {
    expect(looksLikeMissingMip('Installing github:owner/repo to /lib')).toBe(false)
    expect(looksLikeMissingMip('')).toBe(false)
  })
})

describe('mipInstallFailureMessage', () => {
  const message = (over: Partial<Parameters<typeof mipInstallFailureMessage>[0]> = {}): string =>
    mipInstallFailureMessage({
      moduleName: 'Arduino Modulino',
      spec: 'github:arduino/arduino-modulino-mpy',
      kind: 'network',
      detail: "couldn't reach https://raw.githubusercontent.com/… (fetch failed)",
      runtime: TINY_2350,
      ...over
    })

  it('explains all four things a user needs: what, why, what was tried, what to do', () => {
    const msg = message()
    expect(msg).toContain('Arduino Modulino') // what failed
    expect(msg).toMatch(/no mip/i) // why the board couldn't
    expect(msg).toMatch(/optional/i) // why that is normal
    expect(msg).toContain('github:arduino/arduino-modulino-mpy') // what was tried
    expect(msg).toContain('fetch failed') // how it failed
    expect(msg).toMatch(/internet connection/i) // what to do
  })

  it('never surfaces the bare board error this replaced', () => {
    // The whole point of #776: `ImportError("no module named 'mip'")` is
    // accurate and useless, and must not be what a user is left holding.
    for (const kind of ['network', 'not-found', 'malformed', 'unsupported', 'too-big'] as const) {
      expect(message({ kind })).not.toMatch(/ImportError/)
    }
  })

  it('is ONE line — the banners that show it render only the log’s last line', () => {
    expect(message()).not.toContain('\n')
    expect(message({ detail: 'a\nmulti\nline\nreason' })).not.toContain('\n')
  })

  it('names the firmware when it is known, and stays honest when it is not', () => {
    expect(message()).toContain('feature/psram-and-wifi')
    const unknown = message({ runtime: null })
    expect(unknown).toContain("this board's firmware")
    expect(unknown).not.toContain('undefined')
  })

  it('gives advice that fits the failure — retrying only helps some of them', () => {
    expect(message({ kind: 'network' })).toMatch(/try again/i)
    // A 404 will 404 again; the driver moved upstream, so say so instead.
    expect(message({ kind: 'not-found' })).not.toMatch(/try again/i)
    expect(message({ kind: 'not-found' })).toMatch(/moved|renamed|report/i)
    expect(message({ kind: 'unsupported' })).toMatch(/mip on the board|Files panel/i)
  })
})

describe('hostInstallNote', () => {
  it('says plainly that the computer did the work the board could not', () => {
    const note = hostInstallNote({
      moduleName: 'Arduino Modulino',
      spec: 'github:arduino/arduino-modulino-mpy',
      fileCount: 14,
      target: '/lib'
    })
    expect(note).toMatch(/no mip/i)
    expect(note).toContain('on your computer')
    expect(note).toContain('14 files')
    expect(note).toContain('/lib')
  })

  it('counts one file as one file', () => {
    const note = hostInstallNote({
      moduleName: 'SSD1306 OLED',
      spec: 'github:stlehmann/micropython-ssd1306/ssd1306.py',
      fileCount: 1,
      target: '/lib'
    })
    expect(note).toContain('1 file')
    expect(note).not.toContain('1 files')
  })
})
