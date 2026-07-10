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
    // An empty/keyless timeline + mirror don't count as content.
    expect(sanitiseRobotModel({ timeline: { tracks: [] }, mirror: [] })).toBeUndefined()
  })

  it('sanitises a motion timeline (#314): drops bad keys, sorts, defaults', () => {
    const m = sanitiseRobotModel({
      timeline: {
        duration: -5, // invalid → default 2
        easing: 'bogus', // → easeInOut
        fps: 999, // clamped 60
        tracks: [
          { joint: 'a', keys: [{ t: 2, value: 20 }, { t: 0, value: 0 }, { t: 1, value: 'x' }] },
          { keys: [{ t: 0, value: 1 }] }, // no joint → dropped
          { joint: 'b', keys: [] } // no keys → dropped
        ]
      }
    })
    expect(m!.timeline!.duration).toBe(2)
    expect(m!.timeline!.easing).toBe('easeInOut')
    expect(m!.timeline!.fps).toBe(60)
    expect(m!.timeline!.tracks).toHaveLength(1)
    expect(m!.timeline!.tracks[0].keys.map((k) => k.t)).toEqual([0, 2]) // sorted, bad dropped
  })

  it('sanitises pose sequences (#415): keeps valid steps, drops empties, defaults easing/loop', () => {
    const m = sanitiseRobotModel({
      sequences: [
        {
          name: '  walk  ',
          loop: false,
          fps: 999, // clamped to 60
          steps: [
            { pose: 'stand', duration: 1, easing: 'linear' },
            { pose: 'lift', duration: -3 }, // negative → 0, easing defaults
            { pose: '', duration: 1 }, // no pose → dropped
            { duration: 2 } // no pose → dropped
          ]
        },
        { steps: [] }, // no steps → whole sequence dropped
        'junk'
      ]
    })
    expect(m!.sequences).toHaveLength(1)
    const seq = m!.sequences![0]
    expect(seq.name).toBe('walk') // trimmed
    expect(seq.loop).toBe(false)
    expect(seq.fps).toBe(60)
    expect(seq.steps).toEqual([
      { pose: 'stand', duration: 1, easing: 'linear' },
      { pose: 'lift', duration: 0, easing: 'easeInOut' }
    ])
  })

  it('a sequences-only model round-trips (regression for the drop-on-save bug)', () => {
    // Before the fix sanitiseRobotModel silently omitted `sequences`, so a robot with
    // only a sequence saved+loaded as empty. It must survive.
    const m = sanitiseRobotModel({ sequences: [{ loop: true, steps: [{ pose: 'a', duration: 0.5 }] }] })
    expect(m).toBeDefined()
    expect(m!.sequences![0].steps[0].pose).toBe('a')
  })

  it('sanitises puppet controls (#416): keeps id/name + ≥2 poses, drops the rest', () => {
    const m = sanitiseRobotModel({
      controls: [
        { id: ' look ', name: '  Look  ', poses: [' left ', 'right', '', 5] },
        { id: 'c2', poses: ['only-one'] }, // <2 poses → dropped
        { name: 'no-id', poses: ['a', 'b'] }, // no id → dropped
        'junk'
      ]
    })
    expect(m!.controls).toEqual([{ id: 'look', name: 'Look', poses: ['left', 'right'] }])
  })

  it('a controls-only model round-trips (regression: never silently dropped)', () => {
    const m = sanitiseRobotModel({ controls: [{ id: 'c', poses: ['a', 'b'] }] })
    expect(m!.controls![0]).toEqual({ id: 'c', name: 'c', poses: ['a', 'b'] }) // name defaults to id
  })

  it('sanitises mirror pairs (#314)', () => {
    const m = sanitiseRobotModel({
      urdf: 'a.urdf',
      mirror: [{ a: 'l', b: 'r', invert: true }, { a: 'x' }, 'junk']
    })
    expect(m!.mirror).toEqual([{ a: 'l', b: 'r', invert: true }])
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
