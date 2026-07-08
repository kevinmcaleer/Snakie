import { describe, it, expect } from 'vitest'
import {
  ease,
  sampleTrack,
  sampleTimeline,
  upsertKey,
  deleteKey,
  moveKey,
  dropPose,
  mirrorName,
  autoMirrorPairs,
  mirrorTracks,
  pinNumber,
  frameCount,
  generateMicroPython
} from '../src/shared/robot-timeline'
import { jointToServo, servoToJoint } from '../src/shared/krf'
import type { MotionTimeline, ServoJointBinding } from '../src/shared/robot'

const tl = (over: Partial<MotionTimeline> = {}): MotionTimeline => ({
  duration: 2,
  easing: 'linear',
  loop: true,
  fps: 4,
  tracks: [{ joint: 'a', keys: [{ t: 0, value: 0 }, { t: 2, value: 100 }] }],
  ...over
})

describe('ease + sampleTrack (#314)', () => {
  it('eases linear + smoothstep, clamped', () => {
    expect(ease('linear', 0.5)).toBe(0.5)
    expect(ease('linear', -1)).toBe(0)
    expect(ease('easeInOut', 0)).toBe(0)
    expect(ease('easeInOut', 1)).toBe(1)
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5)
    expect(ease('easeInOut', 0.25)).toBeCloseTo(0.15625) // slower at the ends
  })
  it('interpolates + holds outside the range', () => {
    const track = { joint: 'a', keys: [{ t: 0, value: 0 }, { t: 2, value: 100 }] }
    expect(sampleTrack(track, -1, 'linear')).toBe(0) // hold first
    expect(sampleTrack(track, 0, 'linear')).toBe(0)
    expect(sampleTrack(track, 1, 'linear')).toBe(50)
    expect(sampleTrack(track, 2, 'linear')).toBe(100)
    expect(sampleTrack(track, 5, 'linear')).toBe(100) // hold last
  })
  it('applies easing between keys', () => {
    const track = { joint: 'a', keys: [{ t: 0, value: 0 }, { t: 2, value: 100 }] }
    expect(sampleTrack(track, 0.5, 'easeInOut')).toBeCloseTo(100 * ease('easeInOut', 0.25))
  })
  it('single / empty tracks', () => {
    expect(sampleTrack({ joint: 'a', keys: [{ t: 1, value: 7 }] }, 9, 'linear')).toBe(7)
    expect(sampleTrack({ joint: 'a', keys: [] }, 0, 'linear')).toBeNull()
  })
  it('samples the whole timeline', () => {
    expect(sampleTimeline(tl(), 1)).toEqual({ a: 50 })
  })
})

describe('keyframe editing (#314)', () => {
  it('upsert adds + replaces + sorts', () => {
    let t = tl({ tracks: [{ joint: 'a', keys: [{ t: 0, value: 0 }] }] })
    t = upsertKey(t, 'a', 1, 40)
    expect(t.tracks[0].keys).toEqual([{ t: 0, value: 0 }, { t: 1, value: 40 }])
    t = upsertKey(t, 'a', 1, 55) // replace at same t
    expect(t.tracks[0].keys.find((k) => k.t === 1)?.value).toBe(55)
    t = upsertKey(t, 'b', 0, 9) // new track
    expect(t.tracks.map((x) => x.joint)).toContain('b')
  })
  it('delete removes a key + prunes empty tracks; move relocates', () => {
    let t = tl()
    t = deleteKey(t, 'a', 0)
    expect(t.tracks[0].keys).toEqual([{ t: 2, value: 100 }])
    t = deleteKey(t, 'a', 2)
    expect(t.tracks).toHaveLength(0)
    let m = tl()
    m = moveKey(m, 'a', 2, 1.5)
    expect(m.tracks[0].keys.map((k) => k.t)).toEqual([0, 1.5])
  })
  it('dropPose keys only animatable joints (never mimics)', () => {
    const t = dropPose(tl({ tracks: [] }), { a: 30, mimic: 99, b: 12 }, 0, ['a', 'b'])
    expect(t.tracks.map((x) => x.joint).sort()).toEqual(['a', 'b'])
    expect(sampleTimeline(t, 0)).toEqual({ a: 30, b: 12 })
  })
})

describe('mirror (#314)', () => {
  it('finds partners by naming convention', () => {
    expect(mirrorName('hip_left')).toBe('hip_right')
    expect(mirrorName('hip_right')).toBe('hip_left')
    expect(mirrorName('legL')).toBe('legR')
    expect(mirrorName('shoulder')).toBeNull()
    expect(autoMirrorPairs(['hip_left', 'hip_right', 'spine'])).toEqual([
      { a: 'hip_left', b: 'hip_right' }
    ])
  })
  it('copies a track onto its partner (in-phase)', () => {
    const src = tl({
      duration: 2,
      tracks: [{ joint: 'hip_left', keys: [{ t: 0, value: 45 }, { t: 1, value: 70 }] }]
    })
    const m = mirrorTracks(src, [{ a: 'hip_left', b: 'hip_right' }])
    const right = m.tracks.find((x) => x.joint === 'hip_right')
    expect(right?.keys).toEqual([{ t: 0, value: 45 }, { t: 1, value: 70 }])
  })
  it('phase offsets the copy by half the duration + closes the loop seam (a walk)', () => {
    const src = tl({
      duration: 2,
      tracks: [{ joint: 'hip_left', keys: [{ t: 0, value: 45 }, { t: 0.5, value: 70 }] }]
    })
    const m = mirrorTracks(src, [{ a: 'hip_left', b: 'hip_right' }], { phase: true })
    const right = m.tracks.find((x) => x.joint === 'hip_right')!
    // shifted keys at +1s, PLUS seam keys at 0 and duration for a continuous loop
    expect(right.keys.map((k) => k.t)).toEqual([0, 1, 1.5, 2])
    expect(right.keys.find((k) => k.t === 1)?.value).toBe(45)
    expect(right.keys.find((k) => k.t === 1.5)?.value).toBe(70)
    // start == end → no jump at the wrap
    expect(right.keys[0].value).toBe(right.keys[right.keys.length - 1].value)
  })
  it('invert reflects about the neutral', () => {
    const src = tl({ tracks: [{ joint: 'l', keys: [{ t: 0, value: 30 }] }] })
    const m = mirrorTracks(src, [{ a: 'l', b: 'r', invert: true }], { neutral: { r: 90 } })
    expect(m.tracks.find((x) => x.joint === 'r')?.keys[0].value).toBe(150) // 2*90 - 30
    const m0 = mirrorTracks(src, [{ a: 'l', b: 'r', invert: true }]) // neutral defaults 0
    expect(m0.tracks.find((x) => x.joint === 'r')?.keys[0].value).toBe(-30)
  })
})

describe('jointToServo — the load-bearing inverse (#314)', () => {
  it('round-trips servoToJoint for every whole servo degree (default range)', () => {
    const b: ServoJointBinding = { pin: '0', joint: 'j', jointMin: -90, jointMax: 90 }
    for (let s = 0; s <= 180; s++) expect(jointToServo(b, servoToJoint(b, s))).toBe(s)
  })
  it('round-trips with a custom servo range + invert', () => {
    const b: ServoJointBinding = { pin: '0', joint: 'j', jointMin: 0, jointMax: 45, servoMin: 30, servoMax: 150, invert: true }
    for (let s = 30; s <= 150; s++) expect(jointToServo(b, servoToJoint(b, s))).toBe(s)
  })
  it('is zero-span safe + clamped to a whole 0..180', () => {
    const b: ServoJointBinding = { pin: '0', joint: 'j', jointMin: 10, jointMax: 10 }
    expect(jointToServo(b, 999)).toBe(0) // no divide-by-zero → t=0 → servoMin 0
    const b2: ServoJointBinding = { pin: '0', joint: 'j', jointMin: -90, jointMax: 90 }
    expect(jointToServo(b2, 1000)).toBe(180)
    expect(jointToServo(b2, -1000)).toBe(0)
    expect(Number.isInteger(jointToServo(b2, 12.3))).toBe(true)
  })
})

describe('pinNumber + frameCount (#314)', () => {
  it('normalises pins; blank / number-less → NaN (skipped, not GP0)', () => {
    expect(pinNumber('GP0')).toBe(0)
    expect(pinNumber('gp16')).toBe(16)
    expect(pinNumber(' 5 ')).toBe(5)
    expect(Number.isNaN(pinNumber('SDA'))).toBe(true)
    expect(Number.isNaN(pinNumber(''))).toBe(true)
    expect(Number.isNaN(pinNumber('GP'))).toBe(true)
    expect(Number.isNaN(pinNumber('  '))).toBe(true)
  })
  it('drops the loop seam frame', () => {
    expect(frameCount(tl({ loop: true }), 4)).toBe(8) // round(2*4)
    expect(frameCount(tl({ loop: false }), 4)).toBe(9) // one-shot keeps the final frame
  })
})

describe('generateMicroPython — runnable export (#314)', () => {
  const bindings: ServoJointBinding[] = [
    { pin: 'GP0', joint: 'a', jointMin: 0, jointMax: 100, servoMin: 0, servoMax: 180 }
  ]
  it('emits importable, servo-driving code with baked int frames', () => {
    const ex = generateMicroPython(tl(), bindings, { robotName: 'bot', fps: 4 })
    expect(ex.code).toContain('import instruments as inst')
    expect(ex.code).toContain('s0 = inst.servo_on(0)') // GP0 → 0 (not int("GP0")!)
    expect(ex.code).toContain('DT = 1 / FPS')
    expect(ex.code).toMatch(/def play\(\):/)
    expect(ex.code).toContain('while True:')
    expect(ex.boundJoints).toEqual(['a'])
    // every baked angle is a whole number in 0..180
    const nums = [...ex.code.matchAll(/\((\d+),\)/g)].map((m) => Number(m[1]))
    expect(nums.length).toBe(8) // 8 frames, single-element tuples
    for (const n of nums) expect(Number.isInteger(n) && n >= 0 && n <= 180).toBe(true)
  })
  it('single-servo rows are 1-tuples (trailing comma) so zip() works', () => {
    const ex = generateMicroPython(tl(), bindings, { fps: 2 })
    expect(ex.code).toMatch(/\(\d+,\),/) // e.g. "(50,)," — NOT "(50),"
  })
  it('warns + skips a non-numeric pin instead of emitting a crash', () => {
    const ex = generateMicroPython(tl(), [{ pin: 'SDA', joint: 'a', jointMin: 0, jointMax: 100 }])
    expect(ex.code).not.toContain('servo_on(SDA)')
    expect(ex.warnings.join(' ')).toMatch(/not a number/)
  })
  it('reports an animated joint with no binding as skipped', () => {
    const ex = generateMicroPython(
      tl({ tracks: [{ joint: 'a', keys: [{ t: 0, value: 0 }] }, { joint: 'ghost', keys: [{ t: 0, value: 1 }] }] }),
      bindings
    )
    expect(ex.skippedJoints).toEqual(['ghost'])
    expect(ex.warnings.join(' ')).toMatch(/not exported/)
  })
  it('a joint bound to TWO pins drives both servos', () => {
    const two: ServoJointBinding[] = [
      { pin: '0', joint: 'a', jointMin: 0, jointMax: 100 },
      { pin: '1', joint: 'a', jointMin: 0, jointMax: 100, invert: true }
    ]
    const ex = generateMicroPython(tl(), two)
    expect(ex.code).toContain('s0 = inst.servo_on(0)')
    expect(ex.code).toContain('s1 = inst.servo_on(1)')
    expect(ex.code).toContain('SERVOS = (s0, s1)')
  })
  it('with no bindings emits valid, explanatory Python (no servos)', () => {
    const ex = generateMicroPython(tl(), [])
    expect(ex.code).toContain('import instruments as inst')
    expect(ex.code).not.toContain('servo_on')
    expect(ex.code).toMatch(/bind pins to joints/i)
  })
  it('bakes frame times at i/fps so a non-integer duration×fps keeps the right speed', () => {
    // duration 0.7 @ fps 3 → round(2.1)=2 frames (loop) at t=0 and t=1/3.
    const t = tl({
      duration: 0.7,
      easing: 'linear',
      loop: true,
      tracks: [{ joint: 'a', keys: [{ t: 0, value: 0 }, { t: 0.7, value: 100 }] }]
    })
    const ex = generateMicroPython(t, bindings, { fps: 3 })
    expect(ex.code).toContain('DT = 1 / FPS') // symbolic sleep matches i/fps spacing
    const rows = [...ex.code.matchAll(/\((\d+),\),/g)].map((m) => Number(m[1]))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(0) // t=0 → joint 0° → servo 0
    expect(rows[1]).toBe(86) // t=1/3: linear 47.6° → servo round(47.6/100*180)=86
  })
})
