import { describe, expect, it } from 'vitest'
import {
  BODY_KEYS,
  HOME_BODY,
  bodyOf,
  carryBody,
  hasBody,
  isHomeBody,
  mirrorBody,
  mirrorBodyValues,
  pinChain,
  posesOnTheSpot,
  stripBody,
  timelineMovesBody,
  withBody
} from '../src/renderer/src/components/robot-body'
import { poseTargetNative, type JointMeta } from '../src/renderer/src/components/robot-pose'
import { samplePoseSequence } from '../src/shared/robot-timeline'

const body = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => ({ x, y, z, rx, ry, rz })

describe('the body inside a pose', () => {
  it('a pose without the keys leaves the body alone', () => {
    expect(hasBody({ hip: 10 })).toBe(false)
    expect(bodyOf({ hip: 10 })).toBeNull()
  })

  it('round-trips through values, rounded like other pose values', () => {
    const v = withBody({ hip: 10 }, body(12.345, -3, 40.004, 1.239, 0, -2))
    expect(v.hip).toBe(10)
    expect(bodyOf(v)).toEqual(body(12.35, -3, 40, 1.24, 0, -2))
    expect(Object.keys(stripBody(v))).toEqual(['hip'])
  })

  it('can keep exact values for a live posture', () => {
    expect(withBody({}, body(1.23456), true)['@body.x']).toBe(1.23456)
  })

  it('fills missing keys with home', () => {
    expect(bodyOf({ '@body.z': 5 })).toEqual(body(0, 0, 5))
    expect(isHomeBody(HOME_BODY)).toBe(true)
    expect(isHomeBody(body(0, 0, 0.5))).toBe(false)
  })

  it('carries only the body keys', () => {
    expect(carryBody({ hip: 1 }, { knee: 9, '@body.x': 4 })).toEqual({ hip: 1, '@body.x': 4 })
  })

  it('rides through a pose target without limits or unit changes', () => {
    const meta = [{ name: 'hip', type: 'revolute', lower: -1, upper: 1, isMimic: false }] as unknown as JointMeta[]
    const t = poseTargetNative(meta, { hip: 0 }, withBody({ hip: 90 }, body(500, 0, 20, 0, 0, 180)))
    expect(t.hip).toBe(1) // clamped
    expect(t['@body.x']).toBe(500)
    expect(t['@body.rz']).toBe(180)
    // A pose with no body keeps the current one.
    const kept = poseTargetNative(meta, { hip: 0, '@body.x': 7 }, { hip: 0 })
    expect(kept['@body.x']).toBe(7)
  })

  it('is eased between timeline blocks like any other value', () => {
    const byName = { a: withBody({ hip: 0 }, body(0)), b: withBody({ hip: 10 }, body(100)) }
    const seq = { loop: false, steps: [{ pose: 'a', duration: 1, easing: 'linear' as const }, { pose: 'b', duration: 1, easing: 'linear' as const }] }
    expect(samplePoseSequence(seq, byName, 0.5)['@body.x']).toBeCloseTo(50)
  })
})

describe('mirroring the body', () => {
  it('flips sideways position, lean and turn; keeps forward, height and nod', () => {
    expect(mirrorBody(body(10, 4, 30, 2, 5, 7))).toEqual(body(10, -4, 30, -2, 5, -7))
  })

  it('uses the measured left-right direction', () => {
    // A robot modelled with its sides along X.
    expect(mirrorBody(body(10, 4, 30, 2, 5, 7), [2, 0, 0])).toEqual(body(-10, 4, 30, 2, -5, -7))
  })

  it('mirroring twice is the original', () => {
    const b = body(1, 2, 3, 4, 5, 6)
    const back = mirrorBody(mirrorBody(b, [1, 1, 0]), [1, 1, 0])
    for (const k of Object.keys(b) as (keyof typeof b)[]) expect(back[k]).toBeCloseTo(b[k])
  })

  it('leaves a pose with no body untouched', () => {
    const v = { hip: 3 }
    expect(mirrorBodyValues(v)).toBe(v)
  })
})

describe('walk on the spot', () => {
  const byName = {
    a: withBody({ hip: 0 }, body(0, 0, 100)),
    b: withBody({ hip: 5 }, body(30, 4, 95, 0, 3, 0)),
    c: withBody({ hip: 9 }, body(60, 0, 100)),
    still: { hip: 1 }
  }

  it('takes the forward travel out and keeps bob, sway and tilt', () => {
    const out = posesOnTheSpot(['a', 'b', 'c'], byName)
    expect(bodyOf(out.a)).toEqual(body(0, 0, 100))
    expect(bodyOf(out.b)).toEqual(body(0, 4, 95, 0, 3, 0))
    expect(bodyOf(out.c)).toEqual(body(0, 0, 100))
    expect(out.b.hip).toBe(5)
    expect(out.still).toBe(byName.still)
  })

  it('works whichever way the robot walks', () => {
    const diag = {
      a: withBody({}, body(0, 0, 0)),
      b: withBody({}, body(10, 10, 0)),
      c: withBody({}, body(20, 20, 0))
    }
    const out = posesOnTheSpot(['a', 'b', 'c'], diag)
    expect(bodyOf(out.b)!.x).toBeCloseTo(0)
    expect(bodyOf(out.b)!.y).toBeCloseTo(0)
  })

  it('does nothing when the body does not travel', () => {
    const same = { a: withBody({}, body(0, 0, 5)), b: withBody({}, body(0.2, 0, 9)) }
    expect(posesOnTheSpot(['a', 'b'], same)).toBe(same)
    expect(timelineMovesBody(['a', 'b'], same)).toBe(false)
    expect(timelineMovesBody(['a', 'b', 'c'], byName)).toBe(true)
    expect(timelineMovesBody(['still', 'a'], byName)).toBe(false)
  })

  it('has six reserved keys no joint could be called', () => {
    expect(BODY_KEYS).toHaveLength(6)
    expect(BODY_KEYS.every((k) => k.startsWith('@body.'))).toBe(true)
  })
})

describe('the chain to bend when a part is pinned', () => {
  // torso ─ hipL ─ thighL ─ kneeL ─ shinL ─ ankleL ─ footL
  //       └ hipR ─ thighR ─ kneeR ─ shinR
  //       └ neck ─ head
  const joints: Record<string, { joint: string; parent: string }> = {
    thighL: { joint: 'hipL', parent: 'torso' },
    shinL: { joint: 'kneeL', parent: 'thighL' },
    footL: { joint: 'ankleL', parent: 'shinL' },
    thighR: { joint: 'hipR', parent: 'torso' },
    shinR: { joint: 'kneeR', parent: 'thighR' },
    head: { joint: 'neck', parent: 'torso' }
  }
  const up = (l: string) => joints[l]

  it('with nothing pinned, runs from the part to the root', () => {
    expect(pinChain('footL', null, up)).toEqual([
      { joint: 'ankleL', reversed: false },
      { joint: 'kneeL', reversed: false },
      { joint: 'hipL', reversed: false }
    ])
    expect(pinChain('torso', null, up)).toEqual([])
  })

  it('dragging the body bends the planted leg, reversed, nearest the body first', () => {
    expect(pinChain('torso', 'footL', up)).toEqual([
      { joint: 'hipL', reversed: true },
      { joint: 'kneeL', reversed: true },
      { joint: 'ankleL', reversed: true }
    ])
  })

  it('dragging the other leg uses its own joints, then the planted leg', () => {
    expect(pinChain('shinR', 'footL', up).map((c) => `${c.reversed ? '-' : '+'}${c.joint}`)).toEqual([
      '+kneeR',
      '+hipR',
      '-hipL',
      '-kneeL',
      '-ankleL'
    ])
  })

  it('a part beyond the pin only uses the joints between them', () => {
    expect(pinChain('footL', 'thighL', up)).toEqual([
      { joint: 'ankleL', reversed: false },
      { joint: 'kneeL', reversed: false }
    ])
    expect(pinChain('thighL', 'footL', up)).toEqual([
      { joint: 'kneeL', reversed: true },
      { joint: 'ankleL', reversed: true }
    ])
  })

  it('the pinned part itself cannot be dragged', () => {
    expect(pinChain('footL', 'footL', up)).toEqual([])
  })
})
