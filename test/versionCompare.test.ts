import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '../src/shared/version-compare'

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
})
