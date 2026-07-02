import { describe, it, expect } from 'vitest'
import {
  anglePayload,
  pinPayload,
  detachPayload,
  angleToDuty,
  dutyToAngle,
  sweepAngle,
  parseServoPin
} from '../src/renderer/src/components/servo-logic'

describe('servo-logic payloads', () => {
  it('anglePayload rounds + clamps to 0..180', () => {
    expect(anglePayload(90)).toBe('angle 90')
    expect(anglePayload(90.6)).toBe('angle 91')
    expect(anglePayload(-5)).toBe('angle 0')
    expect(anglePayload(999)).toBe('angle 180')
    expect(anglePayload(NaN)).toBe('angle 0')
  })
  it('pinPayload truncates + clamps to a valid GPIO', () => {
    expect(pinPayload(16)).toBe('pin 16')
    expect(pinPayload(16.9)).toBe('pin 16')
    expect(pinPayload(-1)).toBe('pin 0')
  })
  it('detachPayload is a bare verb', () => {
    expect(detachPayload()).toBe('detach')
  })
})

describe('servo-logic PWM math', () => {
  it('maps 0/90/180° to the 0.5/1.5/2.5 ms pulses (as duty at 50 Hz)', () => {
    expect(angleToDuty(0)).toBeCloseTo(500 / 20000, 6)
    expect(angleToDuty(90)).toBeCloseTo(1500 / 20000, 6)
    expect(angleToDuty(180)).toBeCloseTo(2500 / 20000, 6)
  })
  it('dutyToAngle inverts angleToDuty', () => {
    for (const deg of [0, 30, 90, 135, 180]) {
      expect(dutyToAngle(angleToDuty(deg))).toBeCloseTo(deg, 4)
    }
  })
  it('dutyToAngle clamps out-of-range duty', () => {
    expect(dutyToAngle(0)).toBe(0)
    expect(dutyToAngle(1)).toBe(180)
  })
})

describe('parseServoPin', () => {
  it('reads inst.start(servo_pin=N)', () => {
    expect(parseServoPin('inst.start(servo_pin=0)')).toBe(0)
    expect(parseServoPin('inst.start(buzzer_pin=15, servo_pin = 22)')).toBe(22)
  })
  it('reads Servo(N) / Servo(pin=N)', () => {
    expect(parseServoPin('s = Servo(16)')).toBe(16)
    expect(parseServoPin('s = Servo(pin=5, freq=50)')).toBe(5)
  })
  it('is undefined when no servo pin is declared', () => {
    expect(parseServoPin('print("hi")')).toBeUndefined()
    expect(parseServoPin('')).toBeUndefined()
  })
})

describe('servo-logic sweep', () => {
  it('ping-pongs a→b→a across t 0..1', () => {
    expect(sweepAngle(0, 180, 0)).toBeCloseTo(0)
    expect(sweepAngle(0, 180, 0.5)).toBeCloseTo(180)
    expect(sweepAngle(0, 180, 1)).toBeCloseTo(0)
    expect(sweepAngle(0, 180, 0.25)).toBeCloseTo(90)
  })
})
