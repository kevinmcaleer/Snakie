import { describe, it, expect } from 'vitest'
import { matchEspBridge } from '../src/main/firmware/detect'

/**
 * #821 — an Adafruit ESP32 Feather V2 could not be flashed.
 *
 * The board enumerated perfectly well (it was listed in the Console panel's
 * device dropdown, and Adafruit's own web flasher saw it), but the flasher's
 * Serial port dropdown never offered it, because that dropdown was built purely
 * from VID/PID matches and the board's bridge chip was not in the table:
 *
 *     /dev/tty.usbserial-51850332091   vendorId: 1a86   productId: 55d4
 *
 * `1a86:55d4` is a WCH CH9102F — what Adafruit moved the Feather V2 onto once
 * the CP2104 went obsolete, and what a good many current ESP32 boards now use.
 * The table knew `1a86:7523` (CH340) and `1a86:5523` (CH341) and nothing else
 * with that vendor id, so the match came back undefined and the port was
 * dropped.
 */
describe('the reported board (#821)', () => {
  it('matches the CH9102F the Feather V2 actually enumerates as', () => {
    const m = matchEspBridge('1a86', '55d4')
    expect(m, 'the exact VID/PID read off the reported board').toBeDefined()
    expect(m?.chip).toBe('CH9102F')
  })

  it('calls it an esp32, not an esp8266 like its older CH340 sibling', () => {
    // Getting this wrong would pre-select the wrong chip and the wrong offset.
    expect(matchEspBridge('1a86', '55d4')?.board).toBe('esp32')
  })

  it('handles the uppercase VID/PID some platforms report', () => {
    expect(matchEspBridge('1A86', '55D4')?.chip).toBe('CH9102F')
  })
})

describe('the rest of the bridge table still resolves', () => {
  it.each([
    ['10c4', 'ea60', 'CP210x', 'esp32'],
    ['1a86', '7523', 'CH340', 'esp8266'],
    ['1a86', '5523', 'CH341', 'esp8266'],
    ['1a86', '55d3', 'CH343', 'esp32'],
    ['0403', '6001', 'FT232R', 'esp32']
  ])('%s:%s is the %s', (vid, pid, chip, board) => {
    const m = matchEspBridge(vid, pid)
    expect(m?.chip).toBe(chip)
    expect(m?.board).toBe(board)
  })

  it('still matches Espressif native USB on the vendor id alone', () => {
    // 303a is a vid-only entry, so any product id under it should match.
    expect(matchEspBridge('303a', '1001')?.chip).toBe('Espressif native USB')
    expect(matchEspBridge('303a', '4001')?.chip).toBe('Espressif native USB')
  })

  it('does not invent a match for an unrelated device', () => {
    // A vid-only fallback must not swallow every WCH part: 1a86 has no
    // pid-less entry, so an unknown WCH pid stays unknown rather than being
    // silently mapped to whichever 1a86 row happens to be first.
    expect(matchEspBridge('1a86', '9999')).toBeUndefined()
    expect(matchEspBridge('05ac', '8103')).toBeUndefined()   // an Apple device
    expect(matchEspBridge(undefined, undefined)).toBeUndefined()
  })
})
