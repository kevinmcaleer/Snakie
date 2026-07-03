import { describe, it, expect } from 'vitest'
import {
  isProbeCode,
  PROBE_MARK,
  simulatedTelemetryFrame,
  simulateProbeResponse
} from '../src/main/device/simulation'
import {
  isTelemetry,
  parseTelemetry
} from '../src/renderer/src/components/instrument-telemetry'
import { buildValueProbe, parseProbeOutput } from '../src/renderer/src/components/board-values'
import type { UsedPins } from '../src/renderer/src/components/parse-pins'

/**
 * The simulator (issue #135) must speak the EXACT telemetry + probe dialect the
 * renderer already parses. Rather than re-assert the wire format here, we feed
 * the simulator's output through the real consumer parsers — so these tests
 * fail if either side of the contract drifts.
 */
describe('simulatedTelemetryFrame', () => {
  it('emits only well-formed SNK telemetry lines the renderer can parse', () => {
    for (let tick = 0; tick < 64; tick++) {
      const lines = simulatedTelemetryFrame(tick)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(isTelemetry(line)).toBe(true)
        // Every line either parses to a reading or is the READY heartbeat
        // (which isTelemetry accepts but parseTelemetry intentionally ignores).
        const reading = parseTelemetry(line)
        if (!line.includes('READY')) {
          expect(reading).not.toBeNull()
        }
      }
    }
  })

  it('covers the core instrument kinds in a single frame', () => {
    const readings = simulatedTelemetryFrame(0)
      .map((l) => parseTelemetry(l))
      .filter((r): r is NonNullable<typeof r> => r !== null)
    const kinds = new Set(readings.map((r) => r.kind))
    for (const kind of ['scope', 'meter', 'plot', 'env', 'imu', 'dist', 'enc', 'btn']) {
      expect(kinds.has(kind as never)).toBe(true)
    }
  })

  it('produces a moving scope signal across frames (animates)', () => {
    const scopeAt = (tick: number): number => {
      const r = parseTelemetry(simulatedTelemetryFrame(tick)[0])
      if (!r || r.kind !== 'scope') throw new Error('expected scope reading first')
      return r.value
    }
    // Two ticks a quarter-period apart should differ.
    expect(scopeAt(0)).not.toBe(scopeAt(3))
  })

  it('emits a READY heartbeat on the first frame', () => {
    expect(simulatedTelemetryFrame(0).some((l) => l.includes('READY'))).toBe(true)
    expect(simulatedTelemetryFrame(1).some((l) => l.includes('READY'))).toBe(false)
  })
})

describe('simulateProbeResponse', () => {
  function conn(partial: Partial<UsedPins> & Pick<UsedPins, 'type'>): UsedPins {
    return {
      pins: ['0'],
      variable: 'x',
      constructor: 'Pin(0)',
      ...partial
    }
  }

  it('answers every index in a real probe, and the renderer parses the values', () => {
    const conns: UsedPins[] = [
      conn({ type: 'output', variable: 'led' }),
      conn({ type: 'adc', variable: 'pot' }),
      conn({ type: 'pwm', variable: 'servo' })
    ]
    const probe = buildValueProbe(conns)
    expect(isProbeCode(probe)).toBe(true)

    const stdout = simulateProbeResponse(probe, 5)
    const values = parseProbeOutput(stdout)
    // One live value per probeable connection.
    expect(values.size).toBe(conns.length)
    for (let i = 0; i < conns.length; i++) {
      const v = values.get(i)
      expect(v).toBeDefined()
      expect(typeof v?.value).toBe('number')
      expect(v?.value).toBeGreaterThanOrEqual(0)
      expect(v?.value).toBeLessThanOrEqual(65535)
    }
  })

  it('returns empty output for a non-probe snippet', () => {
    expect(simulateProbeResponse('print("hi")', 0)).toBe('')
    expect(isProbeCode('print("hi")')).toBe(false)
  })

  it('animates probe values across ticks', () => {
    const probe = `print('${PROBE_MARK}0:'+str(x))`
    const a = parseProbeOutput(simulateProbeResponse(probe, 0)).get(0)?.value
    const b = parseProbeOutput(simulateProbeResponse(probe, 4)).get(0)?.value
    expect(a).not.toBe(b)
  })
})
