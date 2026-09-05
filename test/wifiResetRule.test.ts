import { describe, expect, it } from 'vitest'
import { createContext, detectAll } from '../src/shared/refactor/engine'
import { safeRules, ruleByCatalogue } from '../src/shared/refactor/rules'
import { wifiResetBeforeConnectRule } from '../src/shared/refactor/rules/wifi-reset-before-connect'

/**
 * Rule 91 — reset the WiFi interface before connecting (#871).
 *
 * The golden fixtures already prove the rewrite and the four cases that must
 * stay quiet. What they cannot express is the things a reader of the Problems
 * panel actually experiences: whether the message names *their* variable, and
 * whether "Tidy this file" is allowed to make this change without being asked.
 */

/** Matches this rule produces for `src`. */
function matches(src: string): { start: number; message: string }[] {
  const ctx = createContext(src, { fileName: 'boot.py' })
  if (!ctx) throw new Error('fixture does not parse')
  // Through the engine rather than calling `detect` directly, so the rule is
  // exercised the way the editor exercises it.
  return detectAll(ctx, [wifiResetBeforeConnectRule]).map((o) => ({
    start: o.match.start,
    // Every match this rule makes carries a message; the type is optional
    // because other rules fall back to the rule's default.
    message: o.match.message ?? ''
  }))
}

const TRAP = `import network

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect("workshop", "hunter2")
`

describe('what the user is told', () => {
  it('fires once on the line that brings the interface up', () => {
    const found = matches(TRAP)
    expect(found).toHaveLength(1)
    expect(TRAP.slice(found[0].start, found[0].start + 17)).toBe('wlan.active(True)')
  })

  it('names the reader’s own variable, not a made-up one', () => {
    // `wlan` is conventional but not universal; a message about `wlan` in a file
    // that says `sta` is a message the reader has to translate.
    expect(matches(TRAP.replace(/wlan/g, 'sta'))[0].message).toContain('sta.active(False)')
  })

  it('says WHY, because the line it asks for looks pointless otherwise', () => {
    const message = matches(TRAP)[0].message
    expect(message).toMatch(/soft reboot/i)
    expect(message).toContain('Wifi Internal State Error')
  })
})

describe('when it stays quiet', () => {
  it('says nothing when the file already deinits first', () => {
    expect(matches(TRAP.replace('wlan.active(True)', 'wlan.active(False)\nwlan.active(True)'))).toHaveLength(0)
  })

  it('says nothing about an access point, which never connects out', () => {
    expect(
      matches(`import network

ap = network.WLAN(network.AP_IF)
ap.active(True)
ap.config(essid="snakie")
`)
    ).toHaveLength(0)
  })

  it('says nothing about other things with an active() method', () => {
    // Anchoring on the WLAN constructor is what keeps this off every Timer,
    // display driver and home-made class in the wild.
    expect(
      matches(`from machine import Timer

t = Timer(0)
t.active(True)
t.connect("nonsense")
`)
    ).toHaveLength(0)
  })

  it('fires only on the FIRST active(True), not every one', () => {
    const found = matches(`import network

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect("a", "b")
wlan.active(True)
`)
    expect(found).toHaveLength(1)
  })
})

describe('how it is classified', () => {
  it('is not batched by "Tidy this file"', () => {
    // Bringing the interface down drops a live connection on purpose. Right
    // here, but not something to do to someone's file unasked.
    expect(safeRules().map((r) => r.id)).not.toContain(wifiResetBeforeConnectRule.id)
  })

  it('is registered under its catalogue number', () => {
    expect(ruleByCatalogue(91)?.id).toBe(wifiResetBeforeConnectRule.id)
  })

  it('is a warning, not a hint — this one is a crash, not a preference', () => {
    expect(wifiResetBeforeConnectRule.severity).toBe('warning')
  })
})
