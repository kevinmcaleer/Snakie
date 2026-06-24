import { describe, expect, it } from 'vitest'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  installStateFromProbe,
  installStateFromVersions,
  parseLibVersion,
  shouldShowBanner
} from '../src/renderer/src/lib/instrumentsLib'

/**
 * Unit tests for the pure install-state logic behind the "offer to install the
 * instrument library" banner (issue #108) — the path constants, the stat-probe
 * → installed/absent decision, and the banner visibility gate.
 */
describe('instrumentsLib paths', () => {
  it('installs to /lib/instruments.py (the standard import path)', () => {
    expect(INSTRUMENTS_LIB_PATH).toBe('/lib/instruments.py')
    expect(INSTRUMENTS_LIB_DIR).toBe('/lib')
    expect(INSTRUMENTS_ROOT_PATH).toBe('/instruments.py')
  })
})

describe('installStateFromProbe', () => {
  it('is present when the /lib path is found', () => {
    expect(installStateFromProbe(true, false)).toBe('present')
  })

  it('is present when only the root fallback is found', () => {
    expect(installStateFromProbe(false, true)).toBe('present')
  })

  it('is present when both are found', () => {
    expect(installStateFromProbe(true, true)).toBe('present')
  })

  it('is absent when neither path is found (all probes errored/empty)', () => {
    expect(installStateFromProbe(false, false)).toBe('absent')
  })
})

describe('parseLibVersion', () => {
  it('reads a double-quoted __version__', () => {
    expect(parseLibVersion('# x\n__version__ = "0.3.0"\nSENTINEL = "SNK"')).toBe('0.3.0')
  })

  it('reads a single-quoted __version__', () => {
    expect(parseLibVersion("__version__ = '1.2.3'")).toBe('1.2.3')
  })

  it('is null for a legacy copy with no __version__', () => {
    expect(parseLibVersion('SENTINEL = "SNK"\ndef scope(v):\n  pass')).toBeNull()
  })

  it('is null for empty/missing source', () => {
    expect(parseLibVersion('')).toBeNull()
    expect(parseLibVersion(null)).toBeNull()
    expect(parseLibVersion(undefined)).toBeNull()
  })
})

describe('installStateFromVersions', () => {
  it('is absent when not found', () => {
    expect(installStateFromVersions(false, null, '0.3.0')).toBe('absent')
  })

  it('is present when versions match', () => {
    expect(installStateFromVersions(true, '0.3.0', '0.3.0')).toBe('present')
  })

  it('is outdated when the board version differs from the bundled one', () => {
    expect(installStateFromVersions(true, '0.2.0', '0.3.0')).toBe('outdated')
  })

  it('is outdated when a legacy board copy has no version (null)', () => {
    expect(installStateFromVersions(true, null, '0.3.0')).toBe('outdated')
  })

  it('stays present when the bundled version is unknown (no false nag)', () => {
    expect(installStateFromVersions(true, '0.2.0', null)).toBe('present')
  })
})

describe('shouldShowBanner', () => {
  const base = {
    dockOpen: true,
    connected: true,
    installState: 'absent' as const,
    dismissed: false
  }

  it('shows when dock open + connected + absent + not dismissed', () => {
    expect(shouldShowBanner(base)).toBe(true)
  })

  it('shows when the library is outdated (offer update)', () => {
    expect(shouldShowBanner({ ...base, installState: 'outdated' })).toBe(true)
  })

  it('hides when the dock is closed', () => {
    expect(shouldShowBanner({ ...base, dockOpen: false })).toBe(false)
  })

  it('hides when no device is connected', () => {
    expect(shouldShowBanner({ ...base, connected: false })).toBe(false)
  })

  it('hides when the library is already installed (present)', () => {
    expect(shouldShowBanner({ ...base, installState: 'present' })).toBe(false)
  })

  it('hides while the install state is still unknown (not yet probed)', () => {
    expect(shouldShowBanner({ ...base, installState: 'unknown' })).toBe(false)
  })

  it('hides once dismissed this session', () => {
    expect(shouldShowBanner({ ...base, dismissed: true })).toBe(false)
  })
})
