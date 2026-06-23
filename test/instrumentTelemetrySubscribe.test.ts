import { describe, it, expect } from 'vitest'
import { splitTelemetryLines } from '../src/renderer/src/components/instrument-telemetry-subscribe'

describe('splitTelemetryLines', () => {
  it('splits complete newline-terminated lines and carries no remainder', () => {
    const { lines, rest } = splitTelemetryLines('', 'SNK IMU b 1 2 3\nSNK DIST d 100\n')
    expect(lines).toEqual(['SNK IMU b 1 2 3', 'SNK DIST d 100'])
    expect(rest).toBe('')
  })

  it('carries an unfinished final line as the remainder', () => {
    const { lines, rest } = splitTelemetryLines('', 'SNK ENC e 5\nSNK BTN go ')
    expect(lines).toEqual(['SNK ENC e 5'])
    expect(rest).toBe('SNK BTN go ')
  })

  it('prepends the carried buffer so a line split across chunks rejoins', () => {
    const first = splitTelemetryLines('', 'SNK WIFI Home_')
    expect(first.lines).toEqual([])
    expect(first.rest).toBe('SNK WIFI Home_')
    const second = splitTelemetryLines(first.rest, 'Net -40 6 WPA2\n')
    expect(second.lines).toEqual(['SNK WIFI Home_Net -40 6 WPA2'])
    expect(second.rest).toBe('')
  })

  it('normalises CRLF and bare CR newlines', () => {
    const { lines, rest } = splitTelemetryLines('', 'SNK I2C 0x3C\r\nSNK BT a ? -50\rSNK ')
    expect(lines).toEqual(['SNK I2C 0x3C', 'SNK BT a ? -50'])
    expect(rest).toBe('SNK ')
  })

  it('emits an empty line for a blank row but never drops it', () => {
    const { lines, rest } = splitTelemetryLines('', '\nSNK SCOPE pwm 0.5\n')
    expect(lines).toEqual(['', 'SNK SCOPE pwm 0.5'])
    expect(rest).toBe('')
  })
})
