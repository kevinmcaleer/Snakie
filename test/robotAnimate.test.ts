import { describe, expect, it } from 'vitest'
import {
  friendlyJointName,
  groupJoints,
  jointSide,
  loadBuildMode,
  loadLiveMirror,
  mirrorPatch,
  nextPoseName,
  posturesDiffer,
  saveBuildMode,
  saveLiveMirror,
  shortArc
} from '../src/renderer/src/components/robot-animate'

const memStore = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

describe('Animate mode — remembered settings', () => {
  it('falls back when nothing or junk is stored, and round-trips a choice', () => {
    const s = memStore()
    expect(loadBuildMode(s, 'assemble')).toBe('assemble')
    s.setItem('snakie:buildMode', 'sideways')
    expect(loadBuildMode(s, 'assemble')).toBe('assemble')
    saveBuildMode(s, 'animate')
    expect(loadBuildMode(s, 'assemble')).toBe('animate')
    expect(loadBuildMode(undefined, 'animate')).toBe('animate')
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: (): string => {
        throw new Error('blocked')
      },
      setItem: (): void => {
        throw new Error('blocked')
      }
    }
    expect(loadBuildMode(broken, 'assemble')).toBe('assemble')
    expect(loadLiveMirror(broken)).toBe(false)
    expect(() => saveBuildMode(broken, 'animate')).not.toThrow()
    expect(() => saveLiveMirror(broken, true)).not.toThrow()
  })

  it('mirror is off until switched on', () => {
    const s = memStore()
    expect(loadLiveMirror(s)).toBe(false)
    saveLiveMirror(s, true)
    expect(loadLiveMirror(s)).toBe(true)
  })
})

describe('mirrorPatch — a joint you turn drives its partner', () => {
  const pairs = [{ a: 'hip_left', b: 'hip_right' }]
  const travel = { hip_left: { lower: -1, upper: 1 }, hip_right: { lower: -1, upper: 1 } }

  it('copies the moved side onto the other, either way round', () => {
    expect(mirrorPatch({ hip_left: 0.4 }, ['hip_left'], pairs, travel)).toEqual({ hip_right: 0.4 })
    expect(mirrorPatch({ hip_right: -0.2 }, ['hip_right'], pairs, travel)).toEqual({ hip_left: -0.2 })
  })

  it('leaves a pair alone when neither or both sides moved', () => {
    expect(mirrorPatch({ knee: 0.3 }, ['knee'], pairs, travel)).toEqual({})
    expect(
      mirrorPatch({ hip_left: 0.4, hip_right: 0.1 }, ['hip_left', 'hip_right'], pairs, travel)
    ).toEqual({})
  })

  it('reflects an inverted pair about the middle of the partner’s travel', () => {
    const inv = [{ a: 'hip_left', b: 'hip_right', invert: true }]
    expect(mirrorPatch({ hip_left: 0.4 }, ['hip_left'], inv, travel)).toEqual({ hip_right: -0.4 })
    // An off-centre partner (0…2) reflects about 1, not 0.
    const off = { hip_left: { lower: 0, upper: 2 }, hip_right: { lower: 0, upper: 2 } }
    expect(mirrorPatch({ hip_left: 0.5 }, ['hip_left'], inv, off)).toEqual({ hip_right: 1.5 })
  })

  it('clamps into the partner’s travel', () => {
    const tight = { hip_left: { lower: -1, upper: 1 }, hip_right: { lower: -0.25, upper: 0.25 } }
    expect(mirrorPatch({ hip_left: 0.9 }, ['hip_left'], pairs, tight)).toEqual({ hip_right: 0.25 })
  })

  it('ignores a moved joint with no usable value', () => {
    expect(mirrorPatch({}, ['hip_left'], pairs, travel)).toEqual({})
    expect(mirrorPatch({ hip_left: NaN }, ['hip_left'], pairs, travel)).toEqual({})
  })
})

describe('groupJoints — the Joints panel sections', () => {
  it('sorts joints into Body, Left side and Right side, keeping model order', () => {
    const g = groupJoints(['neck', 'hip_left', 'knee_left', 'hip_right', 'knee_right', 'waist'])
    expect(g.map((x) => x.label)).toEqual(['Body', 'Left side', 'Right side'])
    expect(g[0].joints).toEqual(['neck', 'waist'])
    expect(g[1].joints).toEqual(['hip_left', 'knee_left'])
    expect(g[2].joints).toEqual(['hip_right', 'knee_right'])
  })

  it('understands the short l/r conventions but not words that merely contain them', () => {
    expect(jointSide('arm_l')).toBe('left')
    expect(jointSide('r_hip')).toBe('right')
    expect(jointSide('legL')).toBe('left')
    expect(jointSide('legR')).toBe('right')
    expect(jointSide('wheel')).toBe('centre')
    expect(jointSide('roll')).toBe('centre')
  })

  it('calls a robot with no sides just "Joints", and drops empty sections', () => {
    expect(groupJoints(['shoulder', 'elbow', 'wrist'])).toEqual([
      { side: 'centre', label: 'Joints', joints: ['shoulder', 'elbow', 'wrist'] }
    ])
    expect(groupJoints(['hip_left']).map((x) => x.label)).toEqual(['Left side'])
    expect(groupJoints([])).toEqual([])
  })
})

describe('friendlyJointName', () => {
  it('reads like a label', () => {
    expect(friendlyJointName('hip_left')).toBe('Hip left')
    expect(friendlyJointName('servo_4_joint')).toBe('Servo 4')
    expect(friendlyJointName('legL')).toBe('Leg L')
    expect(friendlyJointName('_joint')).toBe('_joint')
  })
})

describe('shortArc — the swing of a ring drag', () => {
  it('is the plain difference for small moves', () => {
    expect(shortArc(0.1, 0.4)).toBeCloseTo(0.3)
    expect(shortArc(0.4, 0.1)).toBeCloseTo(-0.3)
  })

  it('takes the short way across the ±π seam', () => {
    expect(shortArc(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
    expect(shortArc(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2)
  })
})

describe('nextPoseName', () => {
  it('numbers from the count and skips names already taken', () => {
    expect(nextPoseName([])).toBe('Pose 1')
    expect(nextPoseName(['Start', 'Duck'])).toBe('Pose 3')
    expect(nextPoseName(['Pose 2', 'Pose 3'])).toBe('Pose 4')
  })
})

describe('posturesDiffer', () => {
  it('ignores rounding noise and treats a missing joint as zero', () => {
    expect(posturesDiffer({ a: 1 }, { a: 1 + 1e-9 })).toBe(false)
    expect(posturesDiffer({ a: 0 }, {})).toBe(false)
    expect(posturesDiffer({ a: 1 }, { a: 1.01 })).toBe(true)
    expect(posturesDiffer({}, { b: 0.5 })).toBe(true)
  })
})
