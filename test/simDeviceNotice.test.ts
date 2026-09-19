import { describe, it, expect } from 'vitest'
import { VIRTUAL_PORT_PATH } from '../src/shared/virtual-device'
import { SIM_NOTICE_KEY, shouldShowSimNotice } from '../src/renderer/src/components/sim-notice'

/**
 * The simulated-device notice (#1163). The web build auto-connects the sim
 * (#267) and the port dropdown is disabled while anything is connected, so a
 * user who plugs in a real board finds a greyed-out list naming a device they
 * never chose. These are the rules for when we say so.
 */
describe('the simulated-device notice (#1163)', () => {
  it('shows while the simulator is connected and nothing has been dismissed', () => {
    expect(
      shouldShowSimNotice({ state: 'connected', path: VIRTUAL_PORT_PATH, dismissed: false })
    ).toBe(true)
  })

  it('stays away once dismissed — it explains a default, once', () => {
    expect(
      shouldShowSimNotice({ state: 'connected', path: VIRTUAL_PORT_PATH, dismissed: true })
    ).toBe(false)
  })

  it('says nothing about a REAL board — the message would be a lie', () => {
    expect(shouldShowSimNotice({ state: 'connected', path: '/dev/ttyACM0', dismissed: false })).toBe(
      false
    )
    expect(
      shouldShowSimNotice({ state: 'connected', path: 'webserial://0', dismissed: false })
    ).toBe(false)
  })

  it('waits for the connection: selecting the sim is not the stuck state', () => {
    // Nothing is connected, so the dropdown is still the user's to change —
    // and on the desktop build that is every launch.
    for (const state of ['disconnected', 'connecting', 'error']) {
      expect(shouldShowSimNotice({ state, path: VIRTUAL_PORT_PATH, dismissed: false })).toBe(false)
    }
  })

  it('survives a status with no path at all', () => {
    expect(shouldShowSimNotice({ state: 'connected', dismissed: false })).toBe(false)
    expect(shouldShowSimNotice({ state: 'connected', path: null, dismissed: false })).toBe(false)
  })

  it('persists its dismissal under a namespaced key', () => {
    expect(SIM_NOTICE_KEY.startsWith('snakie.')).toBe(true)
  })
})
