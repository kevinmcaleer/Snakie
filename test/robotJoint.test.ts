import { describe, it, expect } from 'vitest'
import {
  addPrimitive,
  blankUrdf,
  readJoint,
  setJoint,
  jointNames,
  defaultJointLimit
} from '../src/renderer/src/components/robot-assembly'
import { principalAxisName, type Vec3 } from '../src/renderer/src/components/robot-build'

/** A 2-link arm: base_link + `arm` joined by its (fixed) `arm_joint`. */
function arm(): string {
  return addPrimitive(blankUrdf('bot'), { kind: 'box', linkBase: 'arm', parent: 'base_link' }).urdf
}

describe('setJoint — type changes (#315b)', () => {
  it('fixed → revolute adds an <axis> and a <limit>, keeping origin/parent', () => {
    const u = setJoint(arm(), 'arm', { type: 'revolute' })
    const j = readJoint(u, 'arm')!
    expect(j.type).toBe('revolute')
    expect(j.parent).toBe('base_link')
    expect(j.xyz).toEqual([0.06, 0, 0]) // origin preserved
    expect(j.axis).toEqual([0, 0, 1]) // default +Z
    expect(j.limit!.lower).toBeCloseTo(-Math.PI / 2, 3) // written at 4dp
    expect(j.limit!.upper).toBeCloseTo(Math.PI / 2, 3)
    expect(u).toMatch(/effort="1" velocity="1"/) // spec-required attrs
  })

  it('honours an explicit axis + native limits', () => {
    const u = setJoint(arm(), 'arm', { type: 'revolute', axis: [0, 1, 0], lower: -1, upper: 2 })
    const j = readJoint(u, 'arm')!
    expect(j.axis).toEqual([0, 1, 0])
    expect(j.limit).toEqual({ lower: -1, upper: 2 })
  })

  it('prismatic carries a limit; continuous has an axis but no lower/upper', () => {
    const p = readJoint(setJoint(arm(), 'arm', { type: 'prismatic' }), 'arm')!
    expect(p.type).toBe('prismatic')
    expect(p.limit).toEqual({ lower: 0, upper: 0.05 })
    const c = readJoint(setJoint(arm(), 'arm', { type: 'continuous', axis: [1, 0, 0] }), 'arm')!
    expect(c.type).toBe('continuous')
    expect(c.axis).toEqual([1, 0, 0])
    expect(c.limit).toBeNull() // effort/velocity only, no bounds
  })

  it('revolute → fixed strips axis, limit and mimic', () => {
    let u = setJoint(arm(), 'arm', { type: 'revolute', mimic: { joint: 'x', multiplier: 1, offset: 0 } })
    u = setJoint(u, 'arm', { type: 'fixed' })
    const j = readJoint(u, 'arm')!
    expect(j.type).toBe('fixed')
    expect(j.axis).toBeNull()
    expect(j.limit).toBeNull()
    expect(j.mimic).toBeNull()
    expect(u).not.toMatch(/<axis|<limit|<mimic/)
  })

  it('preserves a non-default origin through a type change', () => {
    const moved = setJoint(arm(), 'arm', { type: 'fixed' }).replace('xyz="0.06 0 0"', 'xyz="0.1 0 0.06"')
    const j = readJoint(setJoint(moved, 'arm', { type: 'revolute' }), 'arm')!
    expect(j.xyz).toEqual([0.1, 0, 0.06])
  })

  it('leaves the URDF untouched when the child has no joint', () => {
    const u = arm()
    expect(setJoint(u, 'base_link', { type: 'revolute' })).toBe(u) // root has no parent joint
    expect(setJoint(u, 'ghost', { type: 'revolute' })).toBe(u)
  })
})

describe('setJoint — mimic (#315b)', () => {
  it('adds a <mimic> and reads it back; null clears it', () => {
    let u = setJoint(arm(), 'arm', { type: 'revolute', mimic: { joint: 'lead', multiplier: -0.5, offset: 0.1 } })
    expect(readJoint(u, 'arm')!.mimic).toEqual({ joint: 'lead', multiplier: -0.5, offset: 0.1 })
    u = setJoint(u, 'arm', { type: 'revolute', mimic: null })
    expect(readJoint(u, 'arm')!.mimic).toBeNull()
  })

  it('ignores a mimic on a fixed joint (nothing to drive)', () => {
    const u = setJoint(arm(), 'arm', { type: 'fixed', mimic: { joint: 'lead', multiplier: 1, offset: 0 } })
    expect(readJoint(u, 'arm')!.mimic).toBeNull()
  })
})

describe('readJoint / jointNames / defaults (#315b)', () => {
  it('reads a hand-written revolute joint (axis, limit, mimic)', () => {
    const urdf = `<robot name="r">
      <link name="a"/><link name="b"/>
      <joint name="b_joint" type="revolute">
        <parent link="a"/><child link="b"/>
        <origin xyz="0 0 0.1" rpy="0 0 0"/>
        <axis xyz="0 1 0"/>
        <limit lower="-0.5" upper="0.5" effort="1" velocity="1"/>
        <mimic joint="a_joint" multiplier="2" offset="0"/>
      </joint>
    </robot>`
    const j = readJoint(urdf, 'b')!
    expect(j.type).toBe('revolute')
    expect(j.axis).toEqual([0, 1, 0])
    expect(j.limit).toEqual({ lower: -0.5, upper: 0.5 })
    expect(j.mimic).toEqual({ joint: 'a_joint', multiplier: 2, offset: 0 })
  })

  it('lists every joint name for the mimic picker', () => {
    const two = addPrimitive(arm(), { kind: 'box', linkBase: 'hand', parent: 'arm' }).urdf
    expect(jointNames(two).sort()).toEqual(['arm_joint', 'hand_joint'])
  })

  it('defaultJointLimit: ±90° for angular, 0–50 mm for prismatic', () => {
    expect(defaultJointLimit('revolute')).toEqual({ lower: -Math.PI / 2, upper: Math.PI / 2 })
    expect(defaultJointLimit('prismatic')).toEqual({ lower: 0, upper: 0.05 })
  })
})

describe('principalAxisName (#315b)', () => {
  it('classifies principal axes, custom vectors, and no-axis', () => {
    expect(principalAxisName([1, 0, 0])).toBe('x')
    expect(principalAxisName([0, -1, 0] as Vec3)).toBe('y') // sign ignored
    expect(principalAxisName([0, 0, 1])).toBe('z')
    expect(principalAxisName([1, 1, 0])).toBe('custom')
    expect(principalAxisName(null)).toBe('none')
  })
})
