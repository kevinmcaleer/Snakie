import { describe, expect, it } from 'vitest'
import { parseEmbedParams } from '../src/renderer/src/code-embed/params'
import {
  dutyToServoAngle,
  jointsFromPins,
  meshFile,
  pickUrdf,
  pinNumber
} from '../src/renderer/src/code-embed/robot-drive'
import type { ServoJointBinding } from '../src/shared/robot'

/** The 16-bit duty for a pulse of `ms` at 50 Hz. */
const duty = (ms: number): number => Math.round((ms / 20) * 65535)

describe('a servo pulse as an angle (#1321)', () => {
  it('reads 0.5 ms as 0, 1.5 ms as 90 and 2.5 ms as 180 degrees', () => {
    expect(dutyToServoAngle(duty(0.5))).toBeCloseTo(0, 0)
    expect(dutyToServoAngle(duty(1.5))).toBeCloseTo(90, 0)
    expect(dutyToServoAngle(duty(2.5))).toBeCloseTo(180, 0)
  })

  it('stays inside 0 to 180 for a pulse outside the range', () => {
    expect(dutyToServoAngle(0)).toBe(0)
    expect(dutyToServoAngle(65535)).toBe(180)
    expect(dutyToServoAngle(-5)).toBe(0)
  })

  it('treats the names of one pin alike', () => {
    expect(pinNumber('GP15')).toBe('15')
    expect(pinNumber('gpio15')).toBe('15')
    expect(pinNumber('15')).toBe('15')
    expect(pinNumber('LED')).toBe('LED')
  })
})

describe('pins to joints (#1321)', () => {
  const bindings: ServoJointBinding[] = [
    { pin: 'GP15', joint: 'shoulder', jointMin: -90, jointMax: 90 },
    { pin: '16', joint: 'elbow', jointMin: 0, jointMax: 120, invert: true }
  ]

  it('moves the joint a servo is bound to', () => {
    const joints = jointsFromPins({ GP15: { kind: 'w', value: duty(1.5) } }, bindings)
    expect(joints.shoulder).toBeCloseTo(0, 0)
    expect(joints).not.toHaveProperty('elbow')
  })

  it('honours an inverted binding and a bare pin number', () => {
    const joints = jointsFromPins({ GP16: { kind: 'w', value: duty(0.5) } }, bindings)
    expect(joints.elbow).toBeCloseTo(120, 0)
  })

  it('leaves a joint alone for a pin that is off, digital or unbound', () => {
    expect(jointsFromPins({ GP15: { kind: 'w', value: 0 } }, bindings)).toEqual({})
    expect(jointsFromPins({ GP15: { kind: 'p', value: 1 } }, bindings)).toEqual({})
    expect(jointsFromPins({ GP2: { kind: 'w', value: duty(1.5) } }, bindings)).toEqual({})
    expect(jointsFromPins({ GP15: { kind: 'w', value: duty(1.5) } }, undefined)).toEqual({})
  })
})

describe("a project's robot files (#1321)", () => {
  const files = [
    { id: 1, filename: 'README.md' },
    { id: 2, filename: 'arm.urdf' },
    { id: 3, filename: 'Base.STL' },
    { id: 4, filename: 'old.urdf' }
  ]

  it('picks the URDF the wiring names, else the first', () => {
    expect(pickUrdf(files, 'robots/old.urdf')?.id).toBe(4)
    expect(pickUrdf(files, 'missing.urdf')?.id).toBe(2)
    expect(pickUrdf(files)?.id).toBe(2)
    expect(pickUrdf([{ id: 1, filename: 'README.md' }])).toBeNull()
  })

  it('finds a mesh by its file name, whatever folder the URDF gives', () => {
    expect(meshFile('package://arm/meshes/base.stl', files)?.id).toBe(3)
    expect(meshFile('meshes\\base.stl?x=1', files)?.id).toBe(3)
    expect(meshFile('meshes/hand.stl', files)).toBeNull()
  })
})

describe('robot frame params (#1321)', () => {
  it('reads robot=1 with a project', () => {
    const p = parseEmbedParams('?robot=1&project=42')
    expect(p.robot).toBe(true)
    expect(p.project).toBe('42')
    expect(p.urdf).toBeNull()
  })

  it('takes only an https urdf address', () => {
    expect(parseEmbedParams('?robot=1&urdf=https%3A%2F%2Fexample.com%2Farm.urdf').urdf).toBe(
      'https://example.com/arm.urdf'
    )
    expect(parseEmbedParams('?robot=1&urdf=javascript%3Aalert(1)').urdf).toBeNull()
    expect(parseEmbedParams('?robot=1&urdf=http%3A%2F%2Fexample.com%2Farm.urdf').urdf).toBeNull()
    expect(parseEmbedParams('?code=x').robot).toBe(false)
  })
})
