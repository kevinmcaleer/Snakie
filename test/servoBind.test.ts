import { describe, it, expect } from 'vitest'
import {
  isServoPart,
  endpointParts,
  servoBoardGpio,
  boundJoint,
  bindServoJoint,
  bindableServos,
  poseServoAngles,
  tweenServoAngles
} from '../src/renderer/src/components/servo-bind'
import type { PartDefinition } from '../src/shared/part'
import type { RobotConnection, RobotPart, ServoJointBinding } from '../src/shared/robot'

const def = (over: Partial<PartDefinition>): PartDefinition =>
  ({ id: 'x', name: 'X', headers: [], ...over }) as PartDefinition

describe('isServoPart (#)', () => {
  it('detects a servo by family / tags / id / name', () => {
    expect(isServoPart(def({ id: 'sg90', name: 'SG90 Micro Servo', family: 'Motor', tags: ['servo', 'pwm'] }))).toBe(true)
    expect(isServoPart(def({ id: 'my-servo', name: 'Big', tags: [] }))).toBe(true) // id
    expect(isServoPart(def({ id: 'led', name: 'Red LED', family: 'Output', tags: ['led'] }))).toBe(false)
    expect(isServoPart(undefined)).toBe(false)
  })
})

describe('endpointParts (#)', () => {
  it('splits key + pin, dropping the #index', () => {
    expect(endpointParts('dist1.Signal#12')).toEqual({ key: 'dist1', pin: 'Signal' })
    expect(endpointParts('board.GP16#3')).toEqual({ key: 'board', pin: 'GP16' })
    expect(endpointParts('board')).toEqual({ key: 'board', pin: '' })
  })
})

describe('servoBoardGpio (#)', () => {
  const conns: RobotConnection[] = [
    { id: 'a', from: 'servo1.VCC#0', to: 'board.3V3#40', net: 'vcc' },
    { id: 'b', from: 'servo1.GND#1', to: 'board.GND#41', net: 'gnd' },
    { id: 'c', from: 'servo1.Signal#2', to: 'board.GP16#5', net: 'signal' }
  ]
  it('finds the GPIO the signal is wired to (skips power pins)', () => {
    expect(servoBoardGpio('servo1', conns)).toBe('16')
  })
  it('works whichever end is the board', () => {
    expect(servoBoardGpio('servo1', [{ id: 'c', from: 'board.GP5#9', to: 'servo1.Signal#2', net: 'signal' }])).toBe('5')
  })
  it('returns null when the servo has no GPIO wire', () => {
    expect(servoBoardGpio('servo1', [conns[0], conns[1]])).toBeNull() // only power
    expect(servoBoardGpio('other', conns)).toBeNull()
  })
})

describe('boundJoint + bindServoJoint (#)', () => {
  const map: ServoJointBinding[] = [{ pin: 'GP16', joint: 'shoulder', jointMin: 0, jointMax: 180 }]

  it('reads the joint a GPIO drives (pin-normalised)', () => {
    expect(boundJoint(map, '16')).toBe('shoulder')
    expect(boundJoint(map, 'GP16')).toBe('shoulder')
    expect(boundJoint(map, '17')).toBeNull()
  })
  it('binds a new pin without disturbing others', () => {
    const next = bindServoJoint(map, '17', 'elbow')
    expect(next).toHaveLength(2)
    expect(boundJoint(next, '17')).toBe('elbow')
    expect(boundJoint(next, '16')).toBe('shoulder')
  })
  it('re-binds a pin to a different joint (replaces, pin-normalised)', () => {
    const next = bindServoJoint(map, '16', 'wrist')
    expect(next).toHaveLength(1)
    expect(boundJoint(next, '16')).toBe('wrist')
  })
  it('keeps the existing binding object when the joint is unchanged (no churn)', () => {
    const next = bindServoJoint(map, 'GP16', 'shoulder')
    expect(next[0]).toBe(map[0]) // same reference
  })
  it('unbinds on an empty joint', () => {
    expect(bindServoJoint(map, '16', '')).toEqual([])
  })
})

describe('bindableServos (#)', () => {
  const parts: RobotPart[] = [
    { id: 'sg90', lib: 'std', part: 'sg90', label: 'Left arm' },
    { id: 'sg902', lib: 'std', part: 'sg90' },
    { id: 'led1', lib: 'std', part: 'led' }
  ]
  const conns: RobotConnection[] = [
    { id: 'a', from: 'sg90.Signal#0', to: 'board.GP16#5', net: 'signal' }
    // sg902 has no signal wire yet
  ]
  const defs: Record<string, PartDefinition> = {
    sg90: { id: 'sg90', name: 'SG90 Micro Servo', tags: ['servo'], headers: [] } as PartDefinition,
    led: { id: 'led', name: 'LED', family: 'Output', headers: [] } as PartDefinition
  }
  const resolve = (p: RobotPart): PartDefinition | undefined => defs[p.part]

  it('lists only servos, with their label + signal GPIO (null when unwired)', () => {
    const list = bindableServos(parts, conns, resolve)
    expect(list).toEqual([
      { id: 'sg90', label: 'Left arm', pin: '16' }, // label wins
      { id: 'sg902', label: 'SG90 Micro Servo', pin: null } // def name, not wired
    ])
    expect(list.some((s) => s.id === 'led1')).toBe(false) // not a servo
  })
})

describe('poseServoAngles (#)', () => {
  const bindings: ServoJointBinding[] = [
    // GP-prefixed pin, straight 0..180 → 0..180 map
    { pin: 'GP16', joint: 'base', servoMin: 0, servoMax: 180, jointMin: 0, jointMax: 180 },
    // bare pin, inverted, joint range 0..90 → servo 0..180
    { pin: '17', joint: 'elbow', servoMin: 0, servoMax: 180, jointMin: 0, jointMax: 90, invert: true }
  ]

  it('maps a pose to per-pin servo degrees, keyed by NUMERIC pin, applying calibration', () => {
    const byPin = poseServoAngles(bindings, { base: 90, elbow: 90 })
    // base: 90/180 → 90°; elbow: 90/90=1, inverted → 0°
    expect(byPin).toEqual({ '16': 90, '17': 0 })
  })

  it('skips joints the pose does not set and non-finite values', () => {
    expect(poseServoAngles(bindings, { base: 45 })).toEqual({ '16': 45 })
    expect(poseServoAngles(bindings, { base: Number.NaN, elbow: 45 })).toEqual({ '17': 90 })
  })

  it('is empty for no bindings or no values', () => {
    expect(poseServoAngles([], { base: 90 })).toEqual({})
    expect(poseServoAngles(bindings, undefined)).toEqual({})
    expect(poseServoAngles(undefined, undefined)).toEqual({})
  })
})

describe('tweenServoAngles (#)', () => {
  it('lerps each target pin from its start angle, rounding to whole degrees', () => {
    const from = { '16': 0, '17': 180 }
    const to = { '16': 100, '17': 80 }
    expect(tweenServoAngles(from, to, 0)).toEqual({ '16': 0, '17': 180 })
    expect(tweenServoAngles(from, to, 1)).toEqual({ '16': 100, '17': 80 })
    expect(tweenServoAngles(from, to, 0.5)).toEqual({ '16': 50, '17': 130 })
  })

  it('only moves the target set (pins only in `from` are dropped)', () => {
    expect(tweenServoAngles({ '16': 0, '99': 10 }, { '16': 90 }, 1)).toEqual({ '16': 90 })
  })

  it('holds a pin at its target when `from` lacks it (no jump from 0)', () => {
    // GP17 has no prior angle → it should sit at the target the whole tween, not sweep up from 0.
    expect(tweenServoAngles({ '16': 0 }, { '16': 90, '17': 45 }, 0)).toEqual({ '16': 0, '17': 45 })
    expect(tweenServoAngles({ '16': 0 }, { '16': 90, '17': 45 }, 0.5)).toEqual({ '16': 45, '17': 45 })
  })
})
