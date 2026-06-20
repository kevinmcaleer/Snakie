import { describe, it, expect } from 'vitest'
import {
  buildValueProbe,
  isProbeableVariable,
  liveValueDisplay,
  parseProbeOutput,
  PROBE_ERR,
  PROBE_MARK
} from '../src/renderer/src/components/board-values'
import type { UsedPins } from '../src/renderer/src/components/parse-pins'

function conn(partial: Partial<UsedPins> & Pick<UsedPins, 'type'>): UsedPins {
  return {
    pins: ['0'],
    variable: 'x',
    constructor: 'Pin(0)',
    ...partial
  }
}

describe('isProbeableVariable', () => {
  it('accepts plain python identifiers', () => {
    expect(isProbeableVariable('led')).toBe(true)
    expect(isProbeableVariable('_btn2')).toBe(true)
    expect(isProbeableVariable('Motor_A')).toBe(true)
  })
  it('rejects empty / undefined / non-identifier names', () => {
    expect(isProbeableVariable('')).toBe(false)
    expect(isProbeableVariable(undefined)).toBe(false)
    expect(isProbeableVariable('2bad')).toBe(false)
    expect(isProbeableVariable('a.b')).toBe(false)
    expect(isProbeableVariable('a b')).toBe(false)
  })
})

describe('buildValueProbe', () => {
  it('returns empty string when nothing is probeable', () => {
    expect(buildValueProbe([])).toBe('')
    expect(buildValueProbe([conn({ type: 'output', variable: '' })])).toBe('')
  })

  it('emits a .value() read for digital input/output, indexed by position', () => {
    const snippet = buildValueProbe([
      conn({ type: 'output', variable: 'led' }),
      conn({ type: 'input', variable: 'btn' })
    ])
    expect(snippet).toContain('led.value()')
    expect(snippet).toContain('btn.value()')
    expect(snippet).toContain(`${PROBE_MARK}0:`)
    expect(snippet).toContain(`${PROBE_MARK}1:`)
    // Each read is guarded so one undefined var can't abort the batch.
    expect(snippet).toContain('except Exception')
    expect(snippet).toContain(PROBE_ERR)
  })

  it('emits a duty_u16 read with a .duty() fallback for pwm', () => {
    const snippet = buildValueProbe([conn({ type: 'pwm', variable: 'fan' })])
    expect(snippet).toContain('fan.duty_u16()')
    expect(snippet).toContain('fan.duty()')
  })

  it('emits a presence probe for i2c/spi/pio (no scan/transfer)', () => {
    const snippet = buildValueProbe([
      conn({ type: 'i2c', variable: 'bus' }),
      conn({ type: 'spi', variable: 'spi' }),
      conn({ type: 'pio', variable: 'sm' })
    ])
    expect(snippet).toContain('(1 if bus else 0)')
    expect(snippet).toContain('(1 if spi else 0)')
    expect(snippet).toContain('(1 if sm else 0)')
    expect(snippet).not.toContain('.scan(')
    expect(snippet).not.toContain('.write(')
  })

  it('keeps source indices stable even when a non-probeable conn is skipped', () => {
    // The middle connection has no variable → it is skipped, but the LAST one
    // must still report under its ORIGINAL index 2 (so the merge lines up).
    const snippet = buildValueProbe([
      conn({ type: 'output', variable: 'a' }),
      conn({ type: 'output', variable: '' }),
      conn({ type: 'output', variable: 'c' })
    ])
    expect(snippet).toContain(`${PROBE_MARK}0:`)
    expect(snippet).not.toContain(`${PROBE_MARK}1:`)
    expect(snippet).toContain(`${PROBE_MARK}2:`)
  })
})

describe('parseProbeOutput', () => {
  it('parses marked lines into numeric values by index', () => {
    const out = parseProbeOutput(`${PROBE_MARK}0:1\n${PROBE_MARK}1:0\n${PROBE_MARK}2:32768\n`)
    expect(out.get(0)).toEqual({ value: 1, raw: '1' })
    expect(out.get(1)).toEqual({ value: 0, raw: '0' })
    expect(out.get(2)).toEqual({ value: 32768, raw: '32768' })
  })

  it('treats an ERR token as unreadable (no value)', () => {
    const out = parseProbeOutput(`${PROBE_MARK}3:${PROBE_ERR}`)
    expect(out.get(3)).toEqual({ value: undefined, raw: PROBE_ERR })
  })

  it('treats a non-numeric token as unreadable', () => {
    const out = parseProbeOutput(`${PROBE_MARK}4:nope`)
    expect(out.get(4)?.value).toBeUndefined()
  })

  it('ignores banners / unmarked lines and tolerates empty/undefined input', () => {
    const out = parseProbeOutput(`MicroPython v1.22\nraw REPL; CTRL-B to exit\n${PROBE_MARK}0:1`)
    expect(out.size).toBe(1)
    expect(out.get(0)?.value).toBe(1)
    expect(parseProbeOutput('').size).toBe(0)
    // @ts-expect-error — exercising the runtime guard for a missing string.
    expect(parseProbeOutput(undefined).size).toBe(0)
  })

  it('tolerates the marker not starting at column 0 (raw-REPL echo prefix)', () => {
    // The raw-REPL ack / echo can prefix the line; the marker is still found and
    // the token runs to end of line (one value per device `print()`).
    const out = parseProbeOutput(`OK> ${PROBE_MARK}5:1`)
    expect(out.get(5)?.value).toBe(1)
  })
})

describe('liveValueDisplay', () => {
  it('falls back to the idle placeholder when there is no reading', () => {
    expect(liveValueDisplay('output', undefined)).toEqual({ text: '1', asserted: false, live: false })
    expect(liveValueDisplay('input', undefined)).toEqual({ text: '1', asserted: false, live: false })
    expect(liveValueDisplay('pwm', undefined)).toEqual({ text: '—', asserted: false, live: false })
    expect(liveValueDisplay('i2c', undefined)).toEqual({ text: '—', asserted: false, live: false })
  })

  it('falls back to idle when the reading carries no numeric value', () => {
    expect(liveValueDisplay('output', { value: undefined, raw: PROBE_ERR })).toEqual({
      text: '1',
      asserted: false,
      live: false
    })
  })

  it('digital output: high is asserted (green), low is idle', () => {
    expect(liveValueDisplay('output', { value: 1, raw: '1' })).toEqual({
      text: '1',
      asserted: true,
      live: true
    })
    expect(liveValueDisplay('output', { value: 0, raw: '0' })).toEqual({
      text: '0',
      asserted: false,
      live: true
    })
  })

  it('digital input: high is asserted, low is idle', () => {
    expect(liveValueDisplay('input', { value: 1, raw: '1' }).asserted).toBe(true)
    expect(liveValueDisplay('input', { value: 0, raw: '0' }).asserted).toBe(false)
  })

  it('pwm: shows the duty level; non-zero is asserted', () => {
    expect(liveValueDisplay('pwm', { value: 32768, raw: '32768' })).toEqual({
      text: '32768',
      asserted: true,
      live: true
    })
    expect(liveValueDisplay('pwm', { value: 0, raw: '0' })).toEqual({
      text: '0',
      asserted: false,
      live: true
    })
  })

  it('bus types: present is "active" (asserted), absent is "idle"', () => {
    expect(liveValueDisplay('i2c', { value: 1, raw: '1' })).toEqual({
      text: 'active',
      asserted: true,
      live: true
    })
    expect(liveValueDisplay('spi', { value: 0, raw: '0' })).toEqual({
      text: 'idle',
      asserted: false,
      live: true
    })
    expect(liveValueDisplay('pio', { value: 1, raw: '1' }).text).toBe('active')
  })
})
