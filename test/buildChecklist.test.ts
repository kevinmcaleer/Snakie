import { describe, it, expect } from 'vitest'
import {
  BUILD_STEPS,
  checklistKey,
  checklistProgress,
  countUrdfJoints,
  detectSteps,
  latchSticky,
  loadSticky,
  looksLikeRobotApp,
  resolveChecklist,
  saveSticky,
  servoPartKeysOf,
  urdfHasMesh,
  type BuildSnapshot,
  type ChecklistStorage
} from '../src/renderer/src/components/build-checklist'
import type { PartDefinition } from '../src/shared/part'
import type { RobotDefinition } from '../src/shared/robot'

const part = (over: Partial<PartDefinition>): PartDefinition =>
  ({ id: 'x', name: 'X', headers: [], ...over }) as PartDefinition

const robot = (over: Partial<RobotDefinition>): RobotDefinition => ({
  parts: [],
  connections: [],
  ...over
})

const URDF_ARM = `<?xml version="1.0"?>
<robot name="arm">
  <link name="base"><visual><geometry><mesh filename="meshes/base.stl"/></geometry></visual></link>
  <link name="upper"><visual><geometry><box size="1 1 1"/></geometry></visual></link>
  <joint name="shoulder" type="revolute">
    <parent link="base"/><child link="upper"/>
  </joint>
</robot>`

const URDF_PRIMITIVES_ONLY = `<robot name="bot">
  <link name="base"><visual><geometry><cylinder radius="1" length="2"/></geometry></visual></link>
</robot>`

describe('URDF text detectors (#436)', () => {
  it('counts named joints', () => {
    expect(countUrdfJoints(URDF_ARM)).toBe(1)
    expect(countUrdfJoints(URDF_PRIMITIVES_ONLY)).toBe(0)
    expect(countUrdfJoints('')).toBe(0)
  })

  it('spots an imported mesh (STL) but not primitives', () => {
    expect(urdfHasMesh(URDF_ARM)).toBe(true)
    expect(urdfHasMesh(URDF_PRIMITIVES_ONLY)).toBe(false)
  })
})

describe('servoPartKeysOf (#436)', () => {
  it('collects lowercased lib/part keys for servo parts only', () => {
    const keys = servoPartKeysOf([
      {
        id: 'Snakie-Standard',
        parts: [
          part({ id: 'SG90', name: 'SG90 Micro Servo', family: 'Motor', tags: ['servo', 'pwm'] }),
          part({ id: 'led', name: 'Red LED', tags: ['led'] })
        ]
      }
    ])
    expect(keys).toEqual(new Set(['snakie-standard/sg90']))
  })
})

describe('looksLikeRobotApp (#436)', () => {
  it('matches a .py file that drives servos or exported poses', () => {
    expect(looksLikeRobotApp('main.py', 'from servo import Servo')).toBe(true)
    expect(looksLikeRobotApp('robot.py', 'SNAKIE_POSES = {"wave": {}}')).toBe(true)
    expect(looksLikeRobotApp('main.py', 'print("hello")')).toBe(false)
    expect(looksLikeRobotApp('notes.txt', 'servo servo servo')).toBe(false)
  })
})

describe('detectSteps (#436)', () => {
  it('everything false on an empty project', () => {
    const d = detectSteps({ def: null })
    for (const step of BUILD_STEPS) expect(d[step.id]).toBe(false)
  })

  it('detects each live step from the project snapshot', () => {
    const snap: BuildSnapshot = {
      def: robot({
        board: 'pico2w',
        parts: [{ id: 'servo1', lib: 'snakie-standard', part: 'sg90' }],
        robot: {
          urdf: 'urdf/arm.urdf',
          servoJointMap: [{ pin: 'GP16', joint: 'shoulder', jointMin: -90, jointMax: 90 }],
          poses: [{ name: 'wave', values: { shoulder: 45 } }]
        }
      }),
      urdfText: URDF_ARM,
      servoPartKeys: new Set(['snakie-standard/sg90']),
      openPython: [{ name: 'main.py', content: 'from servo import Servo' }],
      simulatorConnected: true
    }
    const d = detectSteps(snap)
    expect(d).toEqual({
      board: true,
      servos: true,
      meshes: true,
      joints: true,
      bind: true,
      poses: true,
      code: true,
      simulate: true
    })
  })

  it('falls back to an id/label match for servos when the library is unknown', () => {
    const d = detectSteps({
      def: robot({ parts: [{ id: 's1', lib: 'my-parts', part: 'big-servo' }] })
    })
    expect(d.servos).toBe(true)
    const none = detectSteps({ def: robot({ parts: [{ id: 'l1', lib: 'my-parts', part: 'led' }] }) })
    expect(none.servos).toBe(false)
  })

  it('a binding without a joint (or pin) does not count', () => {
    const d = detectSteps({
      def: robot({ robot: { servoJointMap: [{ pin: 'GP16', joint: '', jointMin: 0, jointMax: 90 }] } })
    })
    expect(d.bind).toBe(false)
  })

  it('meshes/joints stay false without any URDF text', () => {
    const d = detectSteps({ def: robot({ robot: { urdf: 'urdf/arm.urdf' } }), urdfText: null })
    expect(d.meshes).toBe(false)
    expect(d.joints).toBe(false)
  })
})

describe('latch + resolve (#436)', () => {
  const detectedNone = detectSteps({ def: null })

  it('latches observed steps and keeps them done after the evidence goes away', () => {
    const seen = { ...detectedNone, simulate: true }
    const sticky = latchSticky(seen, {})
    expect(sticky).toEqual({ simulate: true })
    // The simulator disconnects — the step stays done via the sticky record.
    const rows = resolveChecklist(detectedNone, sticky)
    expect(rows.find((r) => r.step.id === 'simulate')?.done).toBe(true)
    expect(rows.find((r) => r.step.id === 'simulate')?.detected).toBe(false)
  })

  it('returns the same reference when nothing new was observed (no write loop)', () => {
    const sticky = { simulate: true }
    expect(latchSticky({ ...detectedNone, simulate: true }, sticky)).toBe(sticky)
    expect(latchSticky(detectedNone, sticky)).toBe(sticky)
  })

  it('does NOT latch live steps — they must reflect current state', () => {
    const sticky = latchSticky({ ...detectedNone, board: true, poses: true }, {})
    expect(sticky).toEqual({})
    const rows = resolveChecklist(detectedNone, { board: true })
    expect(rows.find((r) => r.step.id === 'board')?.done).toBe(false)
  })

  it('progress counts done rows', () => {
    const rows = resolveChecklist({ ...detectedNone, board: true, servos: true }, { code: true })
    expect(checklistProgress(rows)).toEqual({ done: 3, total: 8 })
  })
})

describe('per-project persistence (#436)', () => {
  const memStorage = (): ChecklistStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v)
    }
  }

  it('keys by project folder (with a scratch bucket for none)', () => {
    expect(checklistKey('/home/kev/robots/wavey')).toBe('snakie.buildChecklist.v1:/home/kev/robots/wavey')
    expect(checklistKey(null)).toBe('snakie.buildChecklist.v1')
  })

  it('round-trips the sticky record per folder', () => {
    const s = memStorage()
    saveSticky(s, '/p/a', { code: true })
    saveSticky(s, '/p/b', { simulate: true })
    expect(loadSticky(s, '/p/a')).toEqual({ code: true })
    expect(loadSticky(s, '/p/b')).toEqual({ simulate: true })
    expect(loadSticky(s, '/p/c')).toEqual({})
  })

  it('ignores corrupt or foreign values in storage', () => {
    const s = memStorage()
    s.data.set(checklistKey('/p/a'), 'not json {')
    expect(loadSticky(s, '/p/a')).toEqual({})
    s.data.set(checklistKey('/p/a'), JSON.stringify({ code: 'yes', bogus: true, simulate: true }))
    expect(loadSticky(s, '/p/a')).toEqual({ simulate: true })
    s.data.set(checklistKey('/p/a'), JSON.stringify([1, 2]))
    expect(loadSticky(s, '/p/a')).toEqual({})
  })

  it('save is best-effort on a throwing storage', () => {
    const s: ChecklistStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      }
    }
    expect(() => saveSticky(s, '/p/a', { code: true })).not.toThrow()
  })
})
