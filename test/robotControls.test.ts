import { describe, it, expect } from 'vitest'
import { sampleControl } from '../src/shared/robot-timeline'
import { buildServosPayload } from '../src/shared/control'
import type { PuppetControl } from '../src/shared/robot'

const poses = {
  left: { yaw: -90, tilt: 0 },
  center: { yaw: 0, tilt: 0 },
  right: { yaw: 90, tilt: 20 }
}
const ctl = (names: string[]): PuppetControl => ({ id: 'c1', name: 'look', poses: names })

describe('sampleControl — puppet pose blend (#416)', () => {
  it('lerps between two poses across the slider', () => {
    const c = ctl(['left', 'center'])
    expect(sampleControl(c, poses, 0)).toEqual({ yaw: -90, tilt: 0 })
    expect(sampleControl(c, poses, 1)).toEqual({ yaw: 0, tilt: 0 })
    expect(sampleControl(c, poses, 0.5).yaw).toBeCloseTo(-45)
  })

  it('clamps t to 0..1', () => {
    const c = ctl(['left', 'center'])
    expect(sampleControl(c, poses, -3)).toEqual({ yaw: -90, tilt: 0 })
    expect(sampleControl(c, poses, 9)).toEqual({ yaw: 0, tilt: 0 })
  })

  it('brackets the right pair for 3 poses (stops at 0, 0.5, 1)', () => {
    const c = ctl(['left', 'center', 'right'])
    expect(sampleControl(c, poses, 0)).toEqual({ yaw: -90, tilt: 0 }) // left
    expect(sampleControl(c, poses, 0.5)).toEqual({ yaw: 0, tilt: 0 }) // exactly center
    expect(sampleControl(c, poses, 1)).toEqual({ yaw: 90, tilt: 20 }) // right (endpoint)
    // quarter → halfway left↔center
    expect(sampleControl(c, poses, 0.25).yaw).toBeCloseTo(-45)
    // three-quarters → halfway center↔right
    const tq = sampleControl(c, poses, 0.75)
    expect(tq.yaw).toBeCloseTo(45)
    expect(tq.tilt).toBeCloseTo(10)
  })

  it('holds a joint present in only one neighbour', () => {
    const p = { a: { j: 0 }, b: { j: 10, k: 5 } }
    // k is only in b → it holds b's value across the blend
    expect(sampleControl(ctl(['a', 'b']), p, 0.5)).toEqual({ j: 5, k: 5 })
  })

  it('a single pose (or unknown names) never throws', () => {
    expect(sampleControl(ctl(['center']), poses, 0.7)).toEqual({ yaw: 0, tilt: 0 })
    // an unknown pose resolves to {}, so the blend holds the known neighbour's joints
    expect(sampleControl(ctl(['ghost', 'center']), poses, 0)).toEqual({ yaw: 0, tilt: 0 })
    expect(sampleControl({ id: 'x', name: 'x', poses: [] }, poses, 0.5)).toEqual({})
  })
})

describe('buildServosPayload — multi-servo control line (#416)', () => {
  it('emits rounded pin:deg pairs', () => {
    expect(buildServosPayload({ '0': 90, '15': 44.6 })).toBe('0:90 15:45')
  })
  it('skips non-finite angles, empty map → empty string', () => {
    expect(buildServosPayload({ '0': Number.NaN, '1': 30 })).toBe('1:30')
    expect(buildServosPayload({})).toBe('')
  })
})
