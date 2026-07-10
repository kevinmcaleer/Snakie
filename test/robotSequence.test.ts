import { describe, it, expect } from 'vitest'
import {
  samplePoseSequence,
  sequenceSegments,
  sequenceDuration,
  lerpPoses,
  poseSequenceToManagedSteps
} from '../src/shared/robot-timeline'
import type { MotionSequence } from '../src/shared/robot'

// Two poses on a single joint `j`, so interpolation is easy to reason about.
const poses = {
  a: { j: 0 },
  b: { j: 100 },
  c: { j: 40 }
}

const seq = (over: Partial<MotionSequence> = {}): MotionSequence => ({
  loop: false,
  steps: [
    { pose: 'a', duration: 1, easing: 'linear' },
    { pose: 'b', duration: 1, easing: 'linear' }
  ],
  ...over
})

describe('sequenceSegments / sequenceDuration (#415)', () => {
  it('a one-shot has steps-1 segments (last duration is an end hold)', () => {
    const s = seq({ steps: [
      { pose: 'a', duration: 1 },
      { pose: 'b', duration: 2 },
      { pose: 'c', duration: 5 }
    ] })
    expect(sequenceSegments(s)).toEqual([1, 2]) // c's duration ignored (no wrap)
    expect(sequenceDuration(s)).toBe(3)
  })

  it('a loop has one segment per step (the last wraps back to the first)', () => {
    const s = seq({ loop: true, steps: [
      { pose: 'a', duration: 1 },
      { pose: 'b', duration: 2 },
      { pose: 'c', duration: 3 }
    ] })
    expect(sequenceSegments(s)).toEqual([1, 2, 3])
    expect(sequenceDuration(s)).toBe(6)
  })

  it('clamps negative / NaN durations to 0', () => {
    const s = seq({ steps: [
      { pose: 'a', duration: -5 },
      { pose: 'b', duration: Number.NaN as unknown as number }
    ] })
    expect(sequenceSegments(s)).toEqual([0])
  })
})

describe('lerpPoses (#415)', () => {
  it('lerps joints present in both, holds joints present in only one', () => {
    expect(lerpPoses({ x: 0, y: 10 }, { x: 100, z: 5 }, 0.5)).toEqual({ x: 50, y: 10, z: 5 })
  })
})

describe('samplePoseSequence (#415)', () => {
  it('holds the first pose before the start and the last pose after the end (one-shot)', () => {
    const s = seq()
    expect(samplePoseSequence(s, poses, -1)).toEqual({ j: 0 })
    expect(samplePoseSequence(s, poses, 0)).toEqual({ j: 0 })
    expect(samplePoseSequence(s, poses, 5)).toEqual({ j: 100 }) // past the end → last pose
  })

  it('linearly interpolates across a segment', () => {
    const s = seq()
    expect(samplePoseSequence(s, poses, 0.5).j).toBeCloseTo(50)
    expect(samplePoseSequence(s, poses, 0.25).j).toBeCloseTo(25)
  })

  it('applies the from-step easing (smoothstep ≠ linear at u=0.25)', () => {
    const smooth = seq({ steps: [
      { pose: 'a', duration: 1, easing: 'easeInOut' },
      { pose: 'b', duration: 1 }
    ] })
    // smoothstep(0.25) = 0.15625 → 15.625; linear would be 25.
    expect(samplePoseSequence(smooth, poses, 0.25).j).toBeCloseTo(15.625)
  })

  it('wraps a looping sequence over its total duration', () => {
    // a→b (1s) then b→a (1s, the loop seam). Total 2s.
    const s = seq({ loop: true })
    expect(samplePoseSequence(s, poses, 0).j).toBeCloseTo(0)
    expect(samplePoseSequence(s, poses, 0.5).j).toBeCloseTo(50) // a→b mid
    expect(samplePoseSequence(s, poses, 1.5).j).toBeCloseTo(50) // b→a mid (seam)
    expect(samplePoseSequence(s, poses, 2).j).toBeCloseTo(0) // wrapped back to t=0
    expect(samplePoseSequence(s, poses, 2.5).j).toBeCloseTo(50) // == t=0.5
  })

  it('a single-step sequence is just that pose', () => {
    const s = seq({ steps: [{ pose: 'b', duration: 1 }] })
    expect(samplePoseSequence(s, poses, 0)).toEqual({ j: 100 })
    expect(samplePoseSequence(s, poses, 99)).toEqual({ j: 100 })
  })

  it('an empty sequence samples to nothing', () => {
    expect(samplePoseSequence(seq({ steps: [] }), poses, 0)).toEqual({})
  })

  it('an unknown pose name resolves to an empty pose (no throw)', () => {
    const s = seq({ steps: [{ pose: 'ghost', duration: 1 }, { pose: 'b', duration: 1 }] })
    expect(samplePoseSequence(s, poses, 0.5)).toEqual({ j: 100 }) // only b's joint is known
  })

  it('multi-segment: picks the right segment and interpolates within it', () => {
    const s = seq({ steps: [
      { pose: 'a', duration: 1, easing: 'linear' }, // a→b over [0,1)
      { pose: 'b', duration: 1, easing: 'linear' }, // b→c over [1,2)
      { pose: 'c', duration: 1 }
    ] })
    expect(samplePoseSequence(s, poses, 0.5).j).toBeCloseTo(50) // a(0)→b(100)
    expect(samplePoseSequence(s, poses, 1.5).j).toBeCloseTo(70) // b(100)→c(40) mid = 70
  })
})

describe('poseSequenceToManagedSteps (#415 → #413 block)', () => {
  it('emits [pose, durationMs] with whole-ms rounding', () => {
    const s = seq({ steps: [
      { pose: 'a', duration: 0.5 },
      { pose: 'b', duration: 1.2345 }
    ] })
    expect(poseSequenceToManagedSteps(s)).toEqual([['a', 500], ['b', 1235]])
  })
})
