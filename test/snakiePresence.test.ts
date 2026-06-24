import { describe, it, expect } from 'vitest'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'
import { isPresent, PRESENCE_WINDOW_MS } from '../src/renderer/src/components/snakie-presence'

describe('parseTelemetry READY', () => {
  it('parses a SNK READY line with capability tokens', () => {
    expect(parseTelemetry('SNK READY scan:wifi scan:bt teleop')).toEqual({
      kind: 'ready',
      caps: ['scan:wifi', 'scan:bt', 'teleop']
    })
  })

  it('parses a bare SNK READY (no caps) as an empty cap list', () => {
    expect(parseTelemetry('SNK READY')).toEqual({ kind: 'ready', caps: [] })
  })

  it('tolerates extra whitespace', () => {
    expect(parseTelemetry('  SNK   READY   scan:wifi  ')).toEqual({
      kind: 'ready',
      caps: ['scan:wifi']
    })
  })

  it('does not treat a non-READY SNK line as ready', () => {
    expect(parseTelemetry('SNK WIFI Home -40 6 WPA2')?.kind).toBe('wifi')
  })
})

describe('isPresent', () => {
  it('is false before any READY (lastReadyAt 0)', () => {
    expect(isPresent(0, 10_000)).toBe(false)
  })

  it('is true within the presence window', () => {
    expect(isPresent(10_000, 10_000 + PRESENCE_WINDOW_MS - 1)).toBe(true)
  })

  it('is false once the window elapses', () => {
    expect(isPresent(10_000, 10_000 + PRESENCE_WINDOW_MS)).toBe(false)
    expect(isPresent(10_000, 10_000 + PRESENCE_WINDOW_MS + 5_000)).toBe(false)
  })

  it('honours a custom window', () => {
    expect(isPresent(100, 600, 1000)).toBe(true)
    expect(isPresent(100, 1200, 1000)).toBe(false)
  })
})
