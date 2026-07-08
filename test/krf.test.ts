import { describe, it, expect } from 'vitest'
import {
  KRF_VERSION,
  servoToJoint,
  sanitiseRobotModel,
  readRobotModel,
  scaffoldKrf
} from '../src/shared/krf'
import type { ServoJointBinding } from '../src/shared/robot'

describe('servoToJoint calibration (#310)', () => {
  const b: ServoJointBinding = { pin: 'GP0', joint: 'j1', jointMin: -90, jointMax: 90 }
  it('maps the default 0..180 servo sweep onto the joint range', () => {
    expect(servoToJoint(b, 0)).toBeCloseTo(-90)
    expect(servoToJoint(b, 90)).toBeCloseTo(0)
    expect(servoToJoint(b, 180)).toBeCloseTo(90)
  })
  it('clamps out-of-range servo angles', () => {
    expect(servoToJoint(b, -50)).toBeCloseTo(-90)
    expect(servoToJoint(b, 999)).toBeCloseTo(90)
  })
  it('honours invert', () => {
    expect(servoToJoint({ ...b, invert: true }, 0)).toBeCloseTo(90)
    expect(servoToJoint({ ...b, invert: true }, 180)).toBeCloseTo(-90)
  })
  it('respects a custom servo input range', () => {
    const c: ServoJointBinding = { pin: 'GP1', joint: 'j', servoMin: 500, servoMax: 2500, jointMin: 0, jointMax: 100 }
    expect(servoToJoint(c, 500)).toBeCloseTo(0)
    expect(servoToJoint(c, 1500)).toBeCloseTo(50)
    expect(servoToJoint(c, 2500)).toBeCloseTo(100)
  })
})

describe('sanitiseRobotModel — corruption-safe (#310)', () => {
  it('reads a full model, stamping the version', () => {
    const m = sanitiseRobotModel({
      urdf: 'urdf/arm.urdf',
      servoJointMap: [{ pin: 'GP0', joint: 'j1', jointMin: -90, jointMax: 90, invert: true }],
      joints: { j1: { min: -80, max: 80 } },
      defaultPose: { j1: 0 },
      poses: [{ name: 'home', values: { j1: 0 } }]
    })
    expect(m).toBeDefined()
    expect(m!.version).toBe(KRF_VERSION)
    expect(m!.urdf).toBe('urdf/arm.urdf')
    expect(m!.servoJointMap).toHaveLength(1)
    expect(m!.servoJointMap![0].invert).toBe(true)
    expect(m!.joints!.j1).toEqual({ min: -80, max: 80 })
    expect(m!.poses![0]).toEqual({ name: 'home', values: { j1: 0 } })
  })

  it('drops malformed bindings/poses instead of throwing', () => {
    const m = sanitiseRobotModel({
      urdf: 'urdf/x.urdf',
      servoJointMap: [
        { pin: 'GP0', joint: 'j1', jointMin: -90, jointMax: 90 }, // ok
        { pin: 'GP1' }, // missing joint + range → dropped
        { joint: 'j2', jointMin: 0, jointMax: 1 } // missing pin → dropped
      ],
      poses: [{ name: 'p', values: { a: 1, b: 'x' } }, { values: {} }] // 2nd has no name → dropped
    })
    expect(m!.servoJointMap).toHaveLength(1)
    expect(m!.poses).toHaveLength(1)
    expect(m!.poses![0].values).toEqual({ a: 1 }) // non-numeric 'b' dropped
  })

  it('a wiring-only robot.yml (no model) → undefined', () => {
    expect(sanitiseRobotModel(undefined)).toBeUndefined()
    expect(sanitiseRobotModel({})).toBeUndefined()
    expect(sanitiseRobotModel('nonsense')).toBeUndefined()
    // Only-version, no real content → still "no model".
    expect(sanitiseRobotModel({ servoJointMap: [], defaultPose: {} })).toBeUndefined()
  })

  it('readRobotModel pulls the model off a RobotDefinition', () => {
    expect(readRobotModel({ parts: [], connections: [] })).toBeUndefined()
    const m = readRobotModel({ parts: [], connections: [], robot: { urdf: 'urdf/a.urdf' } })
    expect(m!.urdf).toBe('urdf/a.urdf')
  })
})

describe('scaffoldKrf (#310)', () => {
  it('builds a valid KRF project plan', () => {
    const plan = scaffoldKrf('  Walker  ')
    expect(plan.robotYml.name).toBe('Walker')
    expect(plan.robotYml.parts).toEqual([])
    expect(plan.robotYml.robot!.version).toBe(KRF_VERSION)
    expect(plan.robotYml.robot!.urdf).toBe('urdf/robot.urdf')
    const paths = plan.files.map((f) => f.path)
    expect(paths).toContain('code/main.py')
    expect(paths).toContain('urdf/.gitkeep')
    expect(paths).toContain('stl/.gitkeep')
    expect(plan.files.find((f) => f.path === 'code/main.py')!.content).toContain('Walker')
  })
  it('falls back to a default name', () => {
    expect(scaffoldKrf('   ').robotYml.name).toBe('My Robot')
  })
})
