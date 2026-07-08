import { describe, it, expect } from 'vitest'
import {
  extractJoints,
  toDisplay,
  toNative,
  unitLabel,
  clamp,
  mimicValue,
  effectiveLimit,
  normPin,
  servoToJointNative,
  CONTINUOUS_RANGE,
  type JointMeta,
  type RobotLike
} from '../src/renderer/src/components/robot-pose'
import type { ServoJointBinding } from '../src/shared/robot'

describe('robot-pose unit conversions (#312)', () => {
  it('converts revolute rad ↔ deg and prismatic m ↔ mm', () => {
    expect(toDisplay('revolute', Math.PI)).toBeCloseTo(180)
    expect(toNative('revolute', 90)).toBeCloseTo(Math.PI / 2)
    expect(toDisplay('prismatic', 0.05)).toBeCloseTo(50)
    expect(toNative('prismatic', 25)).toBeCloseTo(0.025)
  })
  it('labels units + clamps', () => {
    expect(unitLabel('revolute')).toBe('°')
    expect(unitLabel('prismatic')).toBe('mm')
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})

describe('extractJoints (#312)', () => {
  const robot: RobotLike = {
    joints: {
      base: { jointType: 'fixed', limit: { lower: 0, upper: 0 } },
      shoulder: { jointType: 'revolute', limit: { lower: -1, upper: 1 } },
      slide: { jointType: 'prismatic', limit: { lower: 0, upper: 0.1 } },
      wheel: { jointType: 'continuous', limit: {} },
      // a mimic following the shoulder at 0.5× + 0.1 offset
      finger: {
        jointType: 'revolute',
        limit: { lower: -1, upper: 1 },
        mimicJoint: 'shoulder',
        multiplier: 0.5,
        offset: 0.1
      }
    }
  }
  const meta = extractJoints(robot)

  it('skips fixed joints, keeps revolute/prismatic/continuous', () => {
    expect(meta.map((m) => m.name)).toEqual(['shoulder', 'slide', 'wheel', 'finger'])
  })
  it('gives a continuous joint a symmetric ±180° range', () => {
    const wheel = meta.find((m) => m.name === 'wheel')!
    expect(wheel.lower).toBeCloseTo(-CONTINUOUS_RANGE)
    expect(wheel.upper).toBeCloseTo(CONTINUOUS_RANGE)
  })
  it('flags a mimic joint with its master + factors', () => {
    const finger = meta.find((m) => m.name === 'finger')!
    expect(finger.isMimic).toBe(true)
    expect(finger.master).toBe('shoulder')
    expect(finger.multiplier).toBe(0.5)
    expect(finger.offset).toBe(0.1)
    // masters are NOT flagged
    expect(meta.find((m) => m.name === 'shoulder')!.isMimic).toBe(false)
  })
  it('also detects a mimic declared via the master mimicJoints list', () => {
    const r: RobotLike = {
      joints: {
        a: { jointType: 'revolute', limit: { lower: -1, upper: 1 }, mimicJoints: [{ name: 'b' }] },
        b: { jointType: 'revolute', limit: { lower: -1, upper: 1 } }
      }
    }
    expect(extractJoints(r).find((m) => m.name === 'b')!.isMimic).toBe(true)
  })
})

describe('mimicValue + effectiveLimit (#312)', () => {
  const finger = {
    name: 'finger',
    type: 'revolute' as const,
    lower: -1,
    upper: 1,
    isMimic: true,
    master: 'shoulder',
    multiplier: 0.5,
    offset: 0.1
  }
  it('computes a mimic follower value', () => {
    expect(mimicValue(finger, 1)).toBeCloseTo(0.6)
    expect(mimicValue(finger, 0)).toBeCloseTo(0.1)
  })
  it('applies display-unit overrides onto native limits', () => {
    const shoulder = {
      name: 'shoulder',
      type: 'revolute' as const,
      lower: -1,
      upper: 1,
      isMimic: false
    }
    const lim = effectiveLimit(shoulder, { min: -90, max: 45 })
    expect(lim.lower).toBeCloseTo(-Math.PI / 2)
    expect(lim.upper).toBeCloseTo(Math.PI / 4)
  })
  it('never returns a zero/negative span', () => {
    const j = { name: 'j', type: 'prismatic' as const, lower: 0, upper: 0, isMimic: false }
    const lim = effectiveLimit(j)
    expect(lim.upper).toBeGreaterThan(lim.lower)
  })
})

describe('servoToJointNative — the code-driven pipe (#313)', () => {
  const meta: JointMeta[] = [
    { name: 'shoulder', type: 'revolute', lower: -Math.PI / 2, upper: Math.PI / 2, isMimic: false }
  ]
  it('normalises pin tokens (GP16 == 16)', () => {
    expect(normPin('GP16')).toBe('16')
    expect(normPin('gp0')).toBe('0')
    expect(normPin(' 5 ')).toBe('5')
  })
  it('maps a servo angle onto the joint in native radians', () => {
    const bindings: ServoJointBinding[] = [
      { pin: 'GP16', joint: 'shoulder', servoMin: 0, servoMax: 180, jointMin: -90, jointMax: 90 }
    ]
    // servo 0 → joint -90° → -PI/2 rad ; via pin "16" (telemetry emits bare pin)
    expect(servoToJointNative(bindings, meta, '16', 0)?.native).toBeCloseTo(-Math.PI / 2)
    // servo 90 → joint 0° ; servo 180 → 90° → +PI/2
    expect(servoToJointNative(bindings, meta, '16', 90)?.native).toBeCloseTo(0)
    expect(servoToJointNative(bindings, meta, '16', 180)?.native).toBeCloseTo(Math.PI / 2)
  })
  it('honours inversion', () => {
    const bindings: ServoJointBinding[] = [
      { pin: '16', joint: 'shoulder', servoMin: 0, servoMax: 180, jointMin: -90, jointMax: 90, invert: true }
    ]
    // inverted: servo 0 → joint +90° → +PI/2
    expect(servoToJointNative(bindings, meta, '16', 0)?.native).toBeCloseTo(Math.PI / 2)
  })
  it('returns null for an unbound pin or missing joint', () => {
    const bindings: ServoJointBinding[] = [
      { pin: '16', joint: 'shoulder', jointMin: -90, jointMax: 90 }
    ]
    expect(servoToJointNative(bindings, meta, '99', 90)).toBeNull()
    expect(servoToJointNative([{ pin: '16', joint: 'ghost', jointMin: 0, jointMax: 1 }], meta, '16', 90)).toBeNull()
  })
})
