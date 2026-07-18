import { describe, it, expect } from 'vitest'
import { INSTRUMENTS_PY, SNAKIE_PY } from '../src/renderer/src/web/web-lib-sources'

/**
 * Guards the `?raw` inlining of the MicroPython library into the web bundle
 * (#267). If these silently resolved to '' the web sim's "Install library" would
 * fail with "library source unavailable" and `from snakie import Servo` would
 * ImportError — so assert they carry the real classes.
 */
describe('web lib sources (?raw inlined for the web sim)', () => {
  it('bundles the real instruments.py (has the hardware classes)', () => {
    expect(INSTRUMENTS_PY.length).toBeGreaterThan(1000)
    expect(INSTRUMENTS_PY).toContain('class Servo')
  })
  it('bundles the snakie umbrella that re-exports Servo', () => {
    expect(SNAKIE_PY.length).toBeGreaterThan(20)
    expect(SNAKIE_PY).toContain('Servo')
  })
})
