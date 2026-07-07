import { describe, it, expect } from 'vitest'
import {
  emptySession,
  foldReading,
  pairsForReading,
  seriesKeys,
  seriesSamples,
  csvFor,
  paperRows,
  shortKey,
  formatValue,
  extentOf,
  pointsFor,
  csvFilename
} from '../src/renderer/src/components/logger-logic'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'

describe('pairsForReading (#242)', () => {
  it('flattens every numeric telemetry kind to keyed pairs', () => {
    expect(pairsForReading(parseTelemetry('SNK METER adc0 1.65 V')!)).toEqual([['meter:adc0', 1.65]])
    expect(pairsForReading(parseTelemetry('SNK SCOPE ch1 0.5')!)).toEqual([['scope:ch1', 0.5]])
    expect(pairsForReading(parseTelemetry('SNK ENV env 21.5 1013.2 45')!)).toEqual([
      ['env:env.temp', 21.5],
      ['env:env.pressure', 1013.2],
      ['env:env.humidity', 45]
    ])
    expect(pairsForReading(parseTelemetry('SNK IMU imu 1 2 3')!)).toEqual([
      ['imu:imu.roll', 1],
      ['imu:imu.pitch', 2],
      ['imu:imu.yaw', 3]
    ])
    expect(pairsForReading(parseTelemetry('SNK DIST dist 150')!)).toEqual([['dist:dist', 150]])
    expect(pairsForReading(parseTelemetry('SNK ENC enc 42')!)).toEqual([['enc:enc', 42]])
    // Buttons log as a 0/1 step trace.
    expect(pairsForReading(parseTelemetry('SNK BTN a 1')!)).toEqual([['btn:a', 1]])
    // Plot rows expand per series.
    expect(pairsForReading(parseTelemetry('SNK PLOT temp=22.1 light=88')!)).toEqual([
      ['plot:temp', 22.1],
      ['plot:light', 88]
    ])
  })

  it('non-numeric kinds (binds/ready) produce nothing', () => {
    const bind = parseTelemetry('SNK BIND pwm pwm')
    if (bind) expect(pairsForReading(bind)).toEqual([])
  })
})

describe('session fold + series (#242)', () => {
  const session = emptySession()
  foldReading(session, parseTelemetry('SNK METER adc0 1.0 V')!, 0)
  foldReading(session, parseTelemetry('SNK PLOT temp=20')!, 500)
  foldReading(session, parseTelemetry('SNK METER adc0 2.0 V')!, 1000)

  it('captures samples with timestamps + first-seen key order', () => {
    expect(session.samples).toHaveLength(3)
    expect(seriesKeys(session)).toEqual(['meter:adc0', 'plot:temp'])
    expect(seriesSamples(session, 'meter:adc0').map((s) => s.value)).toEqual([1, 2])
  })

  it('exports a WIDE csv: time_s + one column per series', () => {
    const csv = csvFor(session)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('time_s,meter:adc0,plot:temp')
    expect(lines[1]).toBe('0.000,1,')
    expect(lines[2]).toBe('0.500,,20')
    expect(lines[3]).toBe('1.000,2,')
  })

  it('an empty session still exports a header row', () => {
    expect(csvFor(emptySession())).toBe('time_s\n')
  })

  it('samples sharing a timestamp share a CSV row (latest wins per key)', () => {
    const s = emptySession()
    foldReading(s, parseTelemetry('SNK METER adc0 1.0 V')!, 100)
    foldReading(s, parseTelemetry('SNK PLOT temp=20')!, 100)
    foldReading(s, parseTelemetry('SNK METER adc0 1.5 V')!, 100)
    const lines = csvFor(s).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('0.100,1.5,20')
  })
})

describe('paper rows (#242)', () => {
  it('prints the latest values at each interval boundary + the tail', () => {
    const s = emptySession()
    foldReading(s, parseTelemetry('SNK METER adc0 1.0 V')!, 200)
    foldReading(s, parseTelemetry('SNK METER adc0 1.5 V')!, 1200)
    foldReading(s, parseTelemetry('SNK METER adc0 2.0 V')!, 2400)
    const rows = paperRows(s, 1000)
    // Boundaries at 1s (latest=1.0) and 2s (latest=1.5), tail at 2.4s (2.0).
    expect(rows.map((r) => r.text)).toEqual([
      '1.0s  adc0=1',
      '2.0s  adc0=1.50',
      '2.4s  adc0=2'
    ])
  })

  it('empty session → no rows', () => {
    expect(paperRows(emptySession(), 1000)).toEqual([])
  })
})

describe('chart geometry + formatting (#242)', () => {
  it('extent + points map into the box with y flipped', () => {
    const samples = [
      { t: 0, key: 'k', value: 0 },
      { t: 500, key: 'k', value: 5 },
      { t: 1000, key: 'k', value: 10 }
    ]
    expect(extentOf(samples)).toEqual({ min: 0, max: 10 })
    const pts = pointsFor(samples, 1000, 100, 50)
    expect(pts).toBe('0.0,50.0 50.0,25.0 100.0,0.0')
  })

  it('a flat series draws the centre line; empty series → empty string', () => {
    const flat = [
      { t: 0, key: 'k', value: 3 },
      { t: 1000, key: 'k', value: 3 }
    ]
    expect(pointsFor(flat, 1000, 100, 50)).toBe('0.0,25.0 100.0,25.0')
    expect(pointsFor([], 1000, 100, 50)).toBe('')
  })

  it('shortKey trims the kind prefix; formatValue is compact', () => {
    expect(shortKey('env:env.temp')).toBe('env.temp')
    expect(shortKey('bare')).toBe('bare')
    expect(formatValue(1013.25)).toBe('1013')
    expect(formatValue(21.54)).toBe('21.5')
    expect(formatValue(1.234)).toBe('1.23')
    expect(formatValue(42)).toBe('42')
  })

  it('csvFilename builds a safe name from a wall-clock stamp', () => {
    expect(csvFilename('2026-07-07T193000')).toMatch(/^snakie-log-[0-9T-]+\.csv$/)
  })
})
