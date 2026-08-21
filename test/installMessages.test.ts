import { describe, expect, it } from 'vitest'
import {
  hostInstallNote,
  resolveFailureMessage,
  writeFailureMessage
} from '../src/shared/install-messages'

/**
 * WHAT A FAILED INSTALL SAYS (#776).
 *
 * Three reports in a row surfaced a raw board-level error — the last being
 * `ImportError("no module named 'mip'")`, which is accurate and tells a user
 * nothing. Now that installs always resolve on the computer and write files,
 * there are exactly two places to fail, and these pin that each says which one
 * it was, in words that survive the banners' last-line-only rendering.
 */

const resolveMsg = (
  over: Partial<Parameters<typeof resolveFailureMessage>[0]> = {}
): string =>
  resolveFailureMessage({
    name: 'Arduino Modulino',
    spec: 'github:arduino/arduino-modulino-mpy',
    kind: 'network',
    detail: "couldn't reach https://raw.githubusercontent.com/… (fetch failed)",
    ...over
  })

describe('resolveFailureMessage', () => {
  it('explains all four things a user needs: what, how installs work, what broke, what to do', () => {
    const msg = resolveMsg()
    expect(msg).toContain('Arduino Modulino') // what failed
    expect(msg).toMatch(/on your computer/i) // how Snakie installs
    expect(msg).toMatch(/no internet connection of its own/i) // why it works that way
    expect(msg).toContain('github:arduino/arduino-modulino-mpy') // what it tried to fetch
    expect(msg).toContain('fetch failed') // how that went wrong
    expect(msg).toMatch(/internet connection/i) // what to do
  })

  it('never surfaces the board-level error this replaced, or blames mip', () => {
    // The point of #776: the user must never be handed `ImportError` again, and
    // "your board has no mip" was the wrong framing anyway — a board with mip
    // and no WiFi could not install either.
    for (const kind of ['network', 'not-found', 'malformed', 'unsupported', 'too-big'] as const) {
      const msg = resolveMsg({ kind })
      expect(msg).not.toMatch(/ImportError/)
      expect(msg).not.toMatch(/\bmip\b/)
    }
  })

  it('is ONE line — the banners that show it render only the log’s last line', () => {
    expect(resolveMsg()).not.toContain('\n')
    expect(resolveMsg({ detail: 'a\nmulti\nline\nreason' })).not.toContain('\n')
  })

  it('gives advice that fits the failure — retrying only helps some of them', () => {
    expect(resolveMsg({ kind: 'network' })).toMatch(/try again/i)
    // A 404 will 404 again; the package moved upstream, so say that instead.
    expect(resolveMsg({ kind: 'not-found' })).not.toMatch(/try again/i)
    expect(resolveMsg({ kind: 'not-found' })).toMatch(/moved|renamed|report/i)
    expect(resolveMsg({ kind: 'unsupported' })).toMatch(/Files panel/i)
  })
})

describe('writeFailureMessage', () => {
  it('says the download SUCCEEDED and the board refused — a different fix entirely', () => {
    const msg = writeFailureMessage({
      name: 'Arduino Modulino',
      path: '/lib/modulino/__init__.py',
      detail: 'no space left on the board — its filesystem is full'
    })
    expect(msg).toMatch(/downloaded/i)
    expect(msg).toContain('/lib/modulino/__init__.py')
    expect(msg).toContain('no space left on the board')
    expect(msg).not.toContain('\n')
  })

  it('still reads sensibly when the failing path is not known', () => {
    const msg = writeFailureMessage({ name: 'SSD1306 OLED', detail: 'Disconnected' })
    expect(msg).toMatch(/writing to the board/i)
    expect(msg).not.toContain('undefined')
  })

  it('passes the device layer’s own explanation through rather than re-wording it', () => {
    // `readOnlyFsError` already turns OSError 30 into something readable; this
    // must not bury it behind a generic phrase.
    const detail = "the board's filesystem is read-only while CIRCUITPY is mounted"
    expect(writeFailureMessage({ name: 'x', detail })).toContain(detail)
  })
})

describe('hostInstallNote', () => {
  it('says where the files came from and where they went', () => {
    const note = hostInstallNote({
      name: 'Arduino Modulino',
      spec: 'github:arduino/arduino-modulino-mpy',
      fileCount: 25,
      target: '/lib'
    })
    expect(note).toContain('on your computer')
    expect(note).toContain('25 files')
    expect(note).toContain('/lib')
  })

  it('counts one file as one file', () => {
    const note = hostInstallNote({
      name: 'SSD1306 OLED',
      spec: 'github:stlehmann/micropython-ssd1306/ssd1306.py',
      fileCount: 1,
      target: '/lib'
    })
    expect(note).toContain('1 file')
    expect(note).not.toContain('1 files')
  })

  it('names the dependencies that came with it, so the install is not silent', () => {
    // Four Modulino parts work only because these three arrive too, at the
    // install root. A user who suspects they are missing should be able to read
    // the answer off the install log instead of listing /lib on the board (#785).
    const note = hostInstallNote({
      name: 'Arduino Modulino',
      spec: 'github:arduino/arduino-modulino-mpy',
      fileCount: 25,
      target: '/lib',
      dependencies: [
        'lsm6dsox',
        'github:arduino/micropython-ltr-381rgb-01',
        'github:jposada202020/MicroPython_HS3003'
      ]
    })
    expect(note).toContain('its dependencies')
    expect(note).toContain('lsm6dsox')
    expect(note).toContain('github:arduino/micropython-ltr-381rgb-01')
    expect(note).toContain('github:jposada202020/MicroPython_HS3003')
  })

  it('says "its dependency" for one, and nothing at all for none', () => {
    const one = hostInstallNote({
      name: 'x',
      spec: 'github:o/r',
      fileCount: 2,
      target: '/lib',
      dependencies: ['github:o/dep']
    })
    expect(one).toContain('its dependency github:o/dep')
    const none = hostInstallNote({ name: 'x', spec: 'github:o/r', fileCount: 1, target: '/lib' })
    expect(none).not.toContain('dependenc')
  })
})
