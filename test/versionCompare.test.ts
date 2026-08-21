import { describe, it, expect } from 'vitest'
import { isNewerVersion, isVersionLike } from '../src/shared/version-compare'

/** Updater downgrade guard (#507). */
describe('isNewerVersion', () => {
  it('only strictly-newer versions count', () => {
    expect(isNewerVersion('0.31.0', '0.30.0')).toBe(true)
    expect(isNewerVersion('0.30.0', '0.31.0')).toBe(false) // the old bug: != treated as newer
    expect(isNewerVersion('0.31.0', '0.31.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.99.9')).toBe(true)
    expect(isNewerVersion('0.31.10', '0.31.9')).toBe(true) // numeric, not lexicographic
    expect(isNewerVersion('0.31.0', '0.31.0-beta.1')).toBe(true)
    expect(isNewerVersion('0.31.0-beta.1', '0.31.0')).toBe(false)
  })

  // #757: the two runtimes spell their versions differently, and it copes with
  // both — including CircuitPython's two-digit major, which a lexicographic
  // compare would put BELOW 9.x.
  it('handles both runtimes’ version spellings', () => {
    expect(isNewerVersion('10.2.1', '9.2.9')).toBe(true) // CircuitPython, numeric
    expect(isNewerVersion('9.2.9', '10.2.1')).toBe(false)
    expect(isNewerVersion('v1.28.0', '1.27.0')).toBe(true) // MicroPython's leading v
    expect(isNewerVersion('10.2.1', '10.2.1')).toBe(false)
  })

  it('ranks a CircuitPython pre-release below its own release, above the last one', () => {
    // Semver ordering, which is what makes filtering pre-releases OUT (rather
    // than relying on this) the thing that stops an alpha being offered.
    expect(isNewerVersion('10.3.0-alpha.1', '10.3.0')).toBe(false)
    expect(isNewerVersion('10.3.0', '10.3.0-alpha.1')).toBe(true)
    expect(isNewerVersion('10.3.0-alpha.1', '10.2.1')).toBe(true)
  })
})

/**
 * The branch-name guard (#757).
 *
 * A vendor MicroPython build was seen reporting a BRANCH NAME where the version
 * goes. The parser turns anything non-numeric into 0, so that board read as
 * 0.0.0 and every catalog build looked like an upgrade from it.
 */
describe('isVersionLike', () => {
  it('accepts what both runtimes actually print', () => {
    for (const v of ['1.28.0', 'v1.28.0', '10.2.1', '10.3.0-alpha.1', '1.24.0-preview.42.gabcdef']) {
      expect(isVersionLike(v), v).toBe(true)
    }
  })

  it('rejects a name where a version should be', () => {
    for (const v of ['sherlock-v1.24', 'master', 'main', 'unknown', '', '   ']) {
      expect(isVersionLike(v), JSON.stringify(v)).toBe(false)
    }
  })

  it('makes an unidentifiable version compare as "no update", in EITHER position', () => {
    expect(isNewerVersion('1.28.0', 'sherlock-v1.24')).toBe(false)
    expect(isNewerVersion('sherlock-v1.24', '1.28.0')).toBe(false)
    expect(isNewerVersion('1.28.0', '')).toBe(false)
  })
})
