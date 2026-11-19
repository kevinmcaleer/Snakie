import { describe, expect, it } from 'vitest'
import {
  friendlyJointName,
  groupJoints,
  jointSide,
  loadBuildMode,
  loadLiveMirror,
  mirrorPatch,
  mirrorPoseValues,
  mirroredPoseName,
  poseKey,
  thumbnailCrop,
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

describe('mirrorPoseValues — the same pose, left and right swapped', () => {
  const pairs = [
    { a: 'hip_left', b: 'hip_right' },
    { a: 'knee_left', b: 'knee_right' }
  ]
  const travel = {
    hip_left: { lower: -90, upper: 90 },
    hip_right: { lower: -90, upper: 90 },
    knee_left: { lower: 0, upper: 120 },
    knee_right: { lower: 0, upper: 120 }
  }

  it('trades each pair and leaves unpaired joints alone', () => {
    expect(
      mirrorPoseValues({ hip_left: 30, hip_right: -20, knee_left: 45, knee_right: 5, neck: 12 }, pairs, travel)
    ).toEqual({ hip_left: -20, hip_right: 30, knee_left: 5, knee_right: 45, neck: 12 })
  })

  it('mirroring twice gets the pose back', () => {
    const pose = { hip_left: 30, hip_right: -20, knee_left: 45, knee_right: 5 }
    expect(mirrorPoseValues(mirrorPoseValues(pose, pairs, travel), pairs, travel)).toEqual(pose)
  })

  it('reflects inverted pairs about the middle of the receiving joint’s travel', () => {
    const inv = [{ a: 'knee_left', b: 'knee_right', invert: true }]
    expect(mirrorPoseValues({ knee_left: 100, knee_right: 10 }, inv, travel)).toEqual({
      knee_left: 110,
      knee_right: 20
    })
  })

  it('keeps a partial pose partial: a side it never stored is not invented', () => {
    expect(mirrorPoseValues({ hip_left: 30 }, pairs, travel)).toEqual({ hip_right: 30 })
  })

  it('clamps into the receiving joint’s travel', () => {
    const tight = { ...travel, hip_right: { lower: -10, upper: 10 } }
    expect(mirrorPoseValues({ hip_left: 30, hip_right: 0 }, pairs, tight)).toEqual({ hip_left: 0, hip_right: 10 })
  })
})

describe('mirroredPoseName', () => {
  it('swaps the side in the name, keeping its case', () => {
    expect(mirroredPoseName('Step left', [])).toBe('Step right')
    expect(mirroredPoseName('Right foot up', [])).toBe('Left foot up')
    expect(mirroredPoseName('LEFT', [])).toBe('RIGHT')
  })

  it('adds "mirrored" when the name has no side, and only swaps whole words', () => {
    expect(mirroredPoseName('Wave', [])).toBe('Wave mirrored')
    expect(mirroredPoseName('Upright', [])).toBe('Upright mirrored')
  })

  it('never collides with an existing pose', () => {
    expect(mirroredPoseName('Step left', ['Step right'])).toBe('Step right 2')
    expect(mirroredPoseName('Wave', ['Wave mirrored', 'Wave mirrored 2'])).toBe('Wave mirrored 3')
  })
})

describe('poseKey', () => {
  it('changes with the name or any value, but not with key order', () => {
    const a = poseKey({ name: 'A', values: { x: 1, y: 2 } })
    expect(poseKey({ name: 'A', values: { y: 2, x: 1 } })).toBe(a)
    expect(poseKey({ name: 'B', values: { x: 1, y: 2 } })).not.toBe(a)
    expect(poseKey({ name: 'A', values: { x: 1, y: 3 } })).not.toBe(a)
  })
})

describe('thumbnailCrop', () => {
  it('keeps the aspect, centres on the robot and leaves air around it', () => {
    const c = thumbnailCrop({ minX: 100, minY: 100, maxX: 200, maxY: 300 }, 1.6, 0.1)
    expect(c.w / c.h).toBeCloseTo(1.6)
    expect(c.h).toBeCloseTo(240) // 200 tall + 10% each side
    expect(c.x + c.w / 2).toBeCloseTo(150)
    expect(c.y + c.h / 2).toBeCloseTo(200)
  })

  it('widens to fit a robot wider than the thumbnail', () => {
    const c = thumbnailCrop({ minX: 0, minY: 0, maxX: 400, maxY: 50 }, 1.6, 0)
    expect(c.w).toBeCloseTo(400)
    expect(c.h).toBeCloseTo(250)
  })

  it('survives a degenerate box', () => {
    const c = thumbnailCrop({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 1.6)
    expect(c.w).toBeGreaterThan(0)
    expect(c.h).toBeGreaterThan(0)
  })
})
