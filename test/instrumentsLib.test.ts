import { describe, expect, it } from 'vitest'
import {
  INSTRUMENTS_LIB_PATH,
  INSTRUMENTS_ROOT_PATH,
  INSTRUMENTS_LIB_DIR,
  installStateFromProbe,
  classifyPresentCopy,
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

  it('reads the ASSIGNMENT, not a `__version__ = "X.Y.Z"` example in a comment', () => {
    // The real instruments.py has a doc comment above the assignment. The example
    // must NOT win (that made every copy read as "X.Y.Z" → never outdated).
    const src =
      '# Bump this. Keep the `__version__ = "X.Y.Z"` literal form so the IDE parses it.\n' +
      '__version__ = "0.7.0"\n'
    expect(parseLibVersion(src)).toBe('0.7.0')
  })

  it('is null for empty/missing source', () => {
    expect(parseLibVersion('')).toBeNull()
    expect(parseLibVersion(null)).toBeNull()
    expect(parseLibVersion(undefined)).toBeNull()
  })
})

describe('classifyPresentCopy', () => {
  const BUNDLED = '# hdr\n__version__ = "0.6.0"\nSENTINEL = "SNK"'

  it('is present when the board matches the bundled version', () => {
    expect(classifyPresentCopy('__version__ = "0.6.0"', BUNDLED)).toBe('present')
  })

  it('is outdated when the board version differs from the bundled one', () => {
    expect(classifyPresentCopy('__version__ = "0.5.0"', BUNDLED)).toBe('outdated')
  })

  it('is outdated for a legacy board copy with no __version__', () => {
    expect(classifyPresentCopy('# a pre-versioning copy', BUNDLED)).toBe('outdated')
  })

  it('is outdated when the board copy could not be read (busy → offer, do not miss)', () => {
    expect(classifyPresentCopy(null, BUNDLED)).toBe('outdated')
  })

  it('is INDETERMINATE (null) when our OWN bundled library is unreadable — never a silent present', () => {
    // The old installStateFromVersions returned 'present' here, hiding a stale board.
    expect(classifyPresentCopy('__version__ = "0.5.0"', null)).toBeNull()
    expect(classifyPresentCopy('__version__ = "0.5.0"', '')).toBeNull()
    expect(classifyPresentCopy(null, '')).toBeNull()
  })
})

describe('shouldShowBanner', () => {
  const base = {
    connected: true,
    installState: 'absent' as const,
    dismissed: false
  }

  it('shows when connected + absent + not dismissed (NOT tied to the dock)', () => {
    expect(shouldShowBanner(base)).toBe(true)
  })

  it('shows when the library is outdated (offer update)', () => {
    expect(shouldShowBanner({ ...base, installState: 'outdated' })).toBe(true)
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
