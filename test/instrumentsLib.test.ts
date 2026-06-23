import { describe, expect, it } from 'vitest'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  installStateFromProbe,
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
