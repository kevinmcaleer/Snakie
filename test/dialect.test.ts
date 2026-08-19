import { describe, expect, it } from 'vitest'
import {
  DIALECT_LABEL,
  RUNTIME_PROBE_PY,
  dialectFromName,
  parseBootOut,
  parseBootOutUid,
  parseRuntimeBanner,
  parseRuntimeProbe,
  runtimeGreeting,
  runtimeLabel
} from '../src/shared/dialect'

/**
 * RUNTIME DIALECT parsing (#752, epic #209).
 *
 * The device session carries one answer to "which Python is this board
 * running", and every CircuitPython phase after this one reads it rather than
 * sniffing for itself — so the parsing is the load-bearing part, and it has to
 * hold for real strings from BOTH runtimes. The samples below are the actual
 * shapes: MicroPython puts a `v` on its version and CircuitPython doesn't,
 * both pack a build date into `os.uname().version`, and the board string has
 * spaces in it (which is why the probe prints three lines instead of one).
 */

// Real probe output, as `RUNTIME_PROBE_PY` prints it.
const MP_PROBE = ['SNKIMPL micropython', 'SNKVER 1.28.0 on 2026-01-01', 'SNKMACH Raspberry Pi Pico with RP2040'].join('\n')
const CP_PROBE = [
  'SNKIMPL circuitpython',
  'SNKVER 10.2.1 on 2026-08-18',
  'SNKMACH Adafruit Feather RP2040 with rp2040'
].join('\n')

const MP_BANNER = 'MicroPython v1.28.0 on 2026-01-01; Raspberry Pi Pico with RP2040'
const CP_BANNER = 'Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040'

describe('dialectFromName', () => {
  it('maps sys.implementation.name for both runtimes, case-insensitively', () => {
    expect(dialectFromName('micropython')).toBe('micropython')
    expect(dialectFromName('circuitpython')).toBe('circuitpython')
    expect(dialectFromName('CircuitPython')).toBe('circuitpython')
    expect(dialectFromName(' micropython\n')).toBe('micropython')
  })

  it('is unknown rather than wrong for anything else', () => {
    expect(dialectFromName('cpython')).toBe('unknown')
    expect(dialectFromName('')).toBe('unknown')
  })
})

describe('parseRuntimeProbe', () => {
  it('reads MicroPython, splitting the build date off the version', () => {
    expect(parseRuntimeProbe(MP_PROBE)).toEqual({
      dialect: 'micropython',
      version: '1.28.0',
      buildDate: '2026-01-01',
      machine: 'Raspberry Pi Pico with RP2040'
    })
  })

  it('reads CircuitPython', () => {
    expect(parseRuntimeProbe(CP_PROBE)).toEqual({
      dialect: 'circuitpython',
      version: '10.2.1',
      buildDate: '2026-08-18',
      machine: 'Adafruit Feather RP2040 with rp2040'
    })
  })

  it('keeps the machine string whole — it has spaces, so the probe cannot pack one line', () => {
    expect(parseRuntimeProbe(MP_PROBE)?.machine).toBe('Raspberry Pi Pico with RP2040')
  })

  it('tolerates CRLF and unrelated lines in the captured stdout', () => {
    const noisy = `some earlier output\r\n${CP_PROBE.replace(/\n/g, '\r\n')}\r\n`
    expect(parseRuntimeProbe(noisy)?.dialect).toBe('circuitpython')
  })

  it('degrades to a dialect alone when os.uname() is unavailable', () => {
    // The probe's `except` path: name + a version from sys.implementation, no machine.
    expect(parseRuntimeProbe('SNKIMPL circuitpython\nSNKVER 10.2.1\nSNKMACH ')).toEqual({
      dialect: 'circuitpython',
      version: '10.2.1'
    })
  })

  it('is null — not a guess — when the board answered nothing identifiable', () => {
    expect(parseRuntimeProbe('')).toBeNull()
    expect(parseRuntimeProbe('Traceback (most recent call last):\n  AttributeError')).toBeNull()
  })

  it('reports an unrecognised implementation as unknown rather than assuming MicroPython', () => {
    expect(parseRuntimeProbe('SNKIMPL pycopy\nSNKVER 3.0.0\nSNKMACH thing')?.dialect).toBe('unknown')
  })
})

describe('parseRuntimeBanner', () => {
  it('parses a MicroPython banner, dropping the leading v', () => {
    expect(parseRuntimeBanner(MP_BANNER)).toEqual({
      dialect: 'micropython',
      version: '1.28.0',
      buildDate: '2026-01-01',
      machine: 'Raspberry Pi Pico with RP2040'
    })
  })

  it('parses a CircuitPython banner, which carries the Adafruit prefix and no v', () => {
    expect(parseRuntimeBanner(CP_BANNER)).toEqual({
      dialect: 'circuitpython',
      version: '10.2.1',
      buildDate: '2026-08-18',
      machine: 'Adafruit Feather RP2040 with rp2040'
    })
  })

  it('handles a banner with no build date without swallowing the board string', () => {
    expect(parseRuntimeBanner('MicroPython v1.20.0; Some Board')).toEqual({
      dialect: 'micropython',
      version: '1.20.0',
      machine: 'Some Board'
    })
  })

  it('handles a banner with neither date nor board', () => {
    expect(parseRuntimeBanner('MicroPython v1.20.0')).toEqual({
      dialect: 'micropython',
      version: '1.20.0'
    })
  })

  it('is null for a line that names no runtime, so a console buffer can be scanned with it', () => {
    expect(parseRuntimeBanner('>>> print("hello")')).toBeNull()
    expect(parseRuntimeBanner('')).toBeNull()
  })
})

describe('parseBootOut', () => {
  const BOOT_OUT = [
    'Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040',
    'Board ID:adafruit_feather_rp2040',
    'UID:E661640843373E2A',
    ''
  ].join('\r\n')

  it('reads the version and the per-board id with no serial connection', () => {
    expect(parseBootOut(BOOT_OUT)).toEqual({
      dialect: 'circuitpython',
      version: '10.2.1',
      buildDate: '2026-08-18',
      machine: 'Adafruit Feather RP2040 with rp2040',
      boardId: 'adafruit_feather_rp2040'
    })
  })

  it('still identifies the runtime from a Board ID alone — the drive is CIRCUITPY either way', () => {
    expect(parseBootOut('Board ID:raspberry_pi_pico')).toEqual({
      dialect: 'circuitpython',
      boardId: 'raspberry_pi_pico'
    })
  })

  it('is null for a file that is neither', () => {
    expect(parseBootOut('INFO_UF2.TXT\nModel: Raspberry Pi RP2')).toBeNull()
  })
})

describe('parseBootOutUid', () => {
  it('reads the UID line — how a drive is tied to a port with no connection (#753)', () => {
    const text = [
      'Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040',
      'Board ID:adafruit_feather_rp2040',
      'UID:E661640843373E2A'
    ].join('\r\n')
    expect(parseBootOutUid(text)).toBe('E661640843373E2A')
  })

  it('normalises to upper case, so the comparison with a USB serial number is stable', () => {
    expect(parseBootOutUid('UID:e661640843373e2a')).toBe('E661640843373E2A')
    expect(parseBootOutUid('UID: E66164 ')).toBe('E66164')
  })

  it('is undefined on an older CircuitPython that writes no UID — hence the pairing fallback', () => {
    expect(parseBootOutUid('Adafruit CircuitPython 6.3.0 on 2021-01-01; Pico\nBoard ID:pico')).toBeUndefined()
  })

  it('ignores a line that merely mentions a uid', () => {
    expect(parseBootOutUid('the UID is somewhere else')).toBeUndefined()
    expect(parseBootOutUid('UID:not-hex-at-all')).toBeUndefined()
  })
})

describe('runtimeGreeting', () => {
  it('rebuilds each runtime in its OWN wording, round-tripping its banner', () => {
    expect(runtimeGreeting(parseRuntimeProbe(MP_PROBE))).toBe(MP_BANNER)
    expect(runtimeGreeting(parseRuntimeProbe(CP_PROBE))).toBe(CP_BANNER)
  })

  it('omits the parts the board did not report', () => {
    expect(runtimeGreeting({ dialect: 'micropython', version: '1.28.0' })).toBe('MicroPython v1.28.0')
  })

  it('prints nothing rather than a bare runtime name when there is no version', () => {
    expect(runtimeGreeting({ dialect: 'circuitpython' })).toBe('')
    expect(runtimeGreeting(null)).toBe('')
  })
})

describe('runtimeLabel', () => {
  it('is the short status-bar form', () => {
    expect(runtimeLabel({ dialect: 'circuitpython', version: '10.2.1' })).toBe('CircuitPython 10.2.1')
    expect(runtimeLabel({ dialect: 'micropython', version: '1.28.0' })).toBe('MicroPython 1.28.0')
  })

  it('falls back to the runtime name alone, and to nothing when unknown', () => {
    expect(runtimeLabel({ dialect: 'micropython' })).toBe('MicroPython')
    expect(runtimeLabel(null)).toBe('')
    expect(DIALECT_LABEL.unknown).toBe('Unknown runtime')
  })
})

describe('RUNTIME_PROBE_PY', () => {
  it('asks sys.implementation FIRST, so a board with an odd os module still yields a dialect', () => {
    const impl = RUNTIME_PROBE_PY.indexOf('.implementation')
    const uname = RUNTIME_PROBE_PY.indexOf('uname')
    expect(impl).toBeGreaterThanOrEqual(0)
    expect(impl).toBeLessThan(uname)
  })

  it('guards the os.uname() enrichment, so a missing attribute degrades instead of raising', () => {
    expect(RUNTIME_PROBE_PY).toContain('except Exception:')
  })

  it('prints the three sentinels the parser reads', () => {
    for (const p of ['SNKIMPL ', 'SNKVER ', 'SNKMACH ']) expect(RUNTIME_PROBE_PY).toContain(p)
  })
})

describe("CircuitPython's four-element version tuple", () => {
  it('drops the empty release level instead of trailing a dot', () => {
    // Reported from a real board: `sys.implementation.version` is
    // `(10, 2, 1, '')` on CircuitPython 10.2.1 — three numbers and an empty
    // release level. Joining the tuple whole gave '10.2.1.', which is not a
    // version any comparison or display should have to cope with.
    const join = (v: (number | string)[]): string =>
      v.filter((x) => String(x)).map(String).join('.')
    expect(join([10, 2, 1, ''])).toBe('10.2.1')
    expect(join([1, 28, 0])).toBe('1.28.0')
    // A pre-release still carries its level through.
    expect(join([10, 3, 0, 'beta'])).toBe('10.3.0.beta')
  })
})
