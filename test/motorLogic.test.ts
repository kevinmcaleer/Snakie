import { describe, expect, it } from 'vitest'
import {
  MOTOR_TARGET,
  applyTrim,
  arcadeMix,
  brakePayload,
  channelPayload,
  formatPower,
  parseMotorAddr,
  roundPower,
  runPayload,
  standbyPayload,
  stopPayload
} from '../src/renderer/src/components/motor-logic'
import { buildControlLine } from '../src/shared/control'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'

/**
 * Motor instrument logic (#638) — the control payloads and the calibration maths.
 * Pure: no DOM, no device. The payload grammar here MUST match `motor_command`
 * in `micropython/instruments.py`, so these double as the wire-format contract.
 */

describe('motor control payloads', () => {
  it('builds a run payload for both channels', () => {
    expect(runPayload(0.5, -0.25)).toBe('run 0.5 -0.25')
  })

  it('builds single-channel payloads', () => {
    expect(channelPayload('a', 1)).toBe('a 1')
    expect(channelPayload('b', -1)).toBe('b -1')
  })

  it('clamps out-of-range powers rather than emitting them', () => {
    // A payload outside -1..1 would be silently clamped on the device anyway;
    // clamping here keeps the panel's readout honest about what was sent.
    expect(runPayload(5, -5)).toBe('run 1 -1')
  })

  it('rounds to the wire precision and never emits "-0"', () => {
    // `-0` round-trips through Number() fine but reads as a bug in the terminal
    // echo, and `float('-0')` vs `0` is a pointless difference on the device.
    expect(roundPower(-0.0001)).toBe(0)
    expect(Object.is(roundPower(-0.0001), -0)).toBe(false)
    expect(runPayload(0.12345, 0)).toBe('run 0.123 0')
  })

  it('builds the stop / brake / standby verbs', () => {
    expect(stopPayload()).toBe('stop')
    expect(brakePayload()).toBe('brake')
    expect(standbyPayload(true)).toBe('standby 1')
    expect(standbyPayload(false)).toBe('standby 0')
  })

  it('produces a well-formed control line for the device', () => {
    expect(buildControlLine(MOTOR_TARGET, runPayload(1, -1))).toBe('SNKCMD motor run 1 -1\n')
  })
})

describe('applyTrim (the straight-line calibration)', () => {
  it('is a no-op at zero trim', () => {
    expect(applyTrim(0.8, 0)).toEqual([0.8, 0.8])
  })

  it('cuts the OTHER side rather than boosting past the commanded power', () => {
    // The trap this avoids: a symmetric mix boosts one side, which has no
    // headroom at full throttle — so trim would silently do nothing at exactly
    // the speed where drift is worst.
    expect(applyTrim(1, 0.25)).toEqual([1, 0.75])
    expect(applyTrim(1, -0.25)).toEqual([0.75, 1])
    const [a, b] = applyTrim(1, 0.5)
    expect(Math.max(a, b)).toBe(1)
  })

  it('holds the favoured side and stops the other at full trim', () => {
    expect(applyTrim(0.6, 1)).toEqual([0.6, 0])
    expect(applyTrim(0.6, -1)).toEqual([0, 0.6])
  })

  it('keeps the trim ratio when reversing', () => {
    expect(applyTrim(-1, 0.25)).toEqual([-1, -0.75])
  })
})

describe('arcadeMix', () => {
  it('drives straight with no steering', () => {
    expect(arcadeMix(1, 0)).toEqual([1, 1])
  })

  it('spins on the spot with pure steering', () => {
    expect(arcadeMix(0, 1)).toEqual([1, -1])
  })

  it('clamps rather than exceeding full power', () => {
    // Throttle + steering saturates A at full forward and leaves B stopped.
    expect(arcadeMix(1, 1)).toEqual([1, 0])
  })
})

describe('formatPower', () => {
  it('signs the percentage', () => {
    expect(formatPower(0.42)).toBe('+42%')
    expect(formatPower(-0.42)).toBe('-42%')
    expect(formatPower(0)).toBe('0%')
  })
})

describe('parseMotorAddr', () => {
  it('finds a hex address in a driver construction', () => {
    expect(parseMotorAddr('m = GroveMotorDriver(i2c, addr=0x70)')).toBe(0x70)
  })

  it('is undefined when nothing is declared', () => {
    expect(parseMotorAddr('print("hi")')).toBeUndefined()
    expect(parseMotorAddr('')).toBeUndefined()
  })
})

describe('SNK MOTOR telemetry (the applied read-back)', () => {
  it('parses the powers the board reports', () => {
    expect(parseTelemetry('SNK MOTOR 0.5 -0.25')).toEqual({ kind: 'motor', a: 0.5, b: -0.25 })
  })

  it('rejects a malformed line rather than reporting NaN power', () => {
    expect(parseTelemetry('SNK MOTOR x y')).toBeNull()
    expect(parseTelemetry('SNK MOTOR 0.5')).toBeNull()
  })
})
