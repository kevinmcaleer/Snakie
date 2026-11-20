import { describe, expect, it } from 'vitest'
import type { MotionSequence, MotionTimeline } from '../src/shared/robot'
import {
  blockAt,
  blockTimes,
  insertBlock,
  keyframesToBlocks,
  makeWalkCycle,
  moveBlock,
  removeBlock,
  renamePoseInControls,
  renamePoseInSequence,
  setGap,
  setGapEasing
} from '../src/shared/robot-pose-timeline'
import { samplePoseSequence, sampleTimeline } from '../src/shared/robot-timeline'

const seq = (loop: boolean, ...steps: [string, number][]): MotionSequence => ({
  name: 'sequence',
  loop,
  steps: steps.map(([pose, duration]) => ({ pose, duration, easing: 'easeInOut' }))
})

describe('blockTimes / blockAt', () => {
  it('gives each block its arrival time and the loop total', () => {
    const s = seq(true, ['a', 0.5], ['b', 1], ['c', 0.25])
    expect(blockTimes(s)).toEqual({ starts: [0, 0.5, 1.5], total: 1.75 })
  })
  it('a one-shot ends on its last block', () => {
    const s = seq(false, ['a', 0.5], ['b', 1], ['c', 0.25])
    expect(blockTimes(s)).toEqual({ starts: [0, 0.5, 1.5], total: 1.5 })
  })
  it('finds the block under the playhead', () => {
    const s = seq(true, ['a', 0.5], ['b', 1])
    expect(blockAt(s, 0)).toBe(0)
    expect(blockAt(s, 0.49)).toBe(0)
    expect(blockAt(s, 0.5)).toBe(1)
    expect(blockAt(s, 9)).toBe(1)
    expect(blockAt(seq(true), 0)).toBe(-1)
  })
})

describe('editing blocks', () => {
  const s = seq(true, ['a', 0.5], ['b', 1], ['c', 0.25])
  it('inserts after a block, or at the start', () => {
    expect(insertBlock(s, 'x', 0).steps.map((p) => p.pose)).toEqual(['a', 'x', 'b', 'c'])
    expect(insertBlock(s, 'x', -1).steps.map((p) => p.pose)).toEqual(['x', 'a', 'b', 'c'])
    expect(insertBlock(s, 'x', 99).steps.map((p) => p.pose)).toEqual(['a', 'b', 'c', 'x'])
    expect(insertBlock(s, 'x', 0).steps[1].duration).toBe(0.5)
  })
  it('removes a block', () => {
    expect(removeBlock(s, 1).steps.map((p) => p.pose)).toEqual(['a', 'c'])
  })
  it('reorders poses without changing the timing', () => {
    const m = moveBlock(s, 0, 2)
    expect(m.steps.map((p) => p.pose)).toEqual(['b', 'c', 'a'])
    expect(m.steps.map((p) => p.duration)).toEqual([0.5, 1, 0.25])
    expect(moveBlock(s, 1, 1)).toBe(s)
    expect(moveBlock(s, 7, 0)).toBe(s)
  })
  it('sets a gap, never below the minimum', () => {
    expect(setGap(s, 1, 0.333).steps[1].duration).toBe(0.33)
    expect(setGap(s, 1, -4).steps[1].duration).toBe(0.05)
    expect(setGap(s, 1, NaN).steps[1].duration).toBe(0.5)
    expect(setGapEasing(s, 0, 'linear').steps[0].easing).toBe('linear')
  })
})

describe('pose renames follow through', () => {
  it('updates blocks and leaves an untouched timeline alone', () => {
    const s = seq(true, ['a', 0.5], ['b', 1], ['a', 0.5])
    expect(renamePoseInSequence(s, 'a', 'z').steps.map((p) => p.pose)).toEqual(['z', 'b', 'z'])
    expect(renamePoseInSequence(s, 'nope', 'z')).toBe(s)
  })
  it('updates Perform sliders', () => {
    const c = [{ id: '1', name: 'Smile', poses: ['a', 'b'] }]
    expect(renamePoseInControls(c, 'a', 'z')[0].poses).toEqual(['z', 'b'])
    expect(renamePoseInControls(c, 'nope', 'z')).toBe(c)
  })
})

describe('makeWalkCycle', () => {
  it('follows the blocks with their mirrors and loops', () => {
    const s = seq(false, ['Lift left', 0.4], ['Step left', 0.6])
    const mirror: Record<string, string> = { 'Lift left': 'Lift right', 'Step left': 'Step right' }
    const w = makeWalkCycle(s, (p) => mirror[p])
    expect(w.loop).toBe(true)
    expect(w.steps.map((p) => p.pose)).toEqual(['Lift left', 'Step left', 'Lift right', 'Step right'])
    expect(w.steps.map((p) => p.duration)).toEqual([0.4, 0.6, 0.4, 0.6])
  })
  it('repeats a block with no mirror, and leaves an empty timeline alone', () => {
    expect(makeWalkCycle(seq(true, ['a', 1]), () => undefined).steps.map((p) => p.pose)).toEqual(['a', 'a'])
    const e = seq(true)
    expect(makeWalkCycle(e, () => 'x')).toBe(e)
  })
})

describe('keyframesToBlocks', () => {
  const tl: MotionTimeline = {
    duration: 1.2,
    easing: 'easeInOut',
    loop: true,
    fps: 20,
    tracks: [
      { joint: 'hip_left', keys: [{ t: 0, value: 0 }, { t: 0.6, value: 30 }, { t: 1.2, value: 0 }] },
      { joint: 'hip_right', keys: [{ t: 0, value: 10 }, { t: 1.2, value: 10 }] }
    ]
  }
  it('makes one pose per keyed moment and drops the repeated loop end', () => {
    const { poses, sequence } = keyframesToBlocks(tl, ['Key 1'])
    expect(poses.map((p) => p.name)).toEqual(['Key 2', 'Key 3'])
    expect(poses[0].values).toEqual({ hip_left: 0, hip_right: 10 })
    expect(poses[1].values).toEqual({ hip_left: 30, hip_right: 10 })
    expect(sequence.loop).toBe(true)
    expect(sequence.steps.map((s) => s.duration)).toEqual([0.6, 0.6])
  })
  it('plays the same motion as the keyframes it came from', () => {
    const { poses, sequence } = keyframesToBlocks(tl, [])
    const byName = Object.fromEntries(poses.map((p) => [p.name, p.values]))
    for (const t of [0, 0.15, 0.3, 0.6, 0.9, 1.1]) {
      const a = sampleTimeline(tl, t)
      const b = samplePoseSequence(sequence, byName, t)
      expect(b.hip_left).toBeCloseTo(a.hip_left, 1)
      expect(b.hip_right).toBeCloseTo(a.hip_right, 1)
    }
  })
  it('keeps every moment of a one-shot', () => {
    const { poses, sequence } = keyframesToBlocks({ ...tl, loop: false }, [])
    expect(poses).toHaveLength(3)
    expect(sequence.loop).toBe(false)
  })
  it('an empty clip gives nothing', () => {
    expect(keyframesToBlocks({ ...tl, tracks: [] }, []).sequence.steps).toEqual([])
  })
})
