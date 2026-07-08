import { describe, it, expect } from 'vitest'
import { robotFromYaml, robotToYaml } from '../src/shared/robot-yaml'
import { blankRobot, connectionColor, signalColor, type RobotDefinition } from '../src/shared/robot'

const RICH: RobotDefinition = {
  name: 'Line Follower',
  board: 'pico2w',
  boardX: 40,
  boardY: 60,
  parts: [
    { id: 'dist1', lib: 'snakie-basics', part: 'vl53l0x', label: 'Distance', x: 300, y: 80 },
    { id: 'led1', lib: 'snakie-basics', part: 'led', x: 300, y: 240 }
  ],
  connections: [
    { id: 'c1', from: 'dist1.SDA', to: 'pico2w.GP4', net: 'signal', color: '#4ea1ff' },
    { id: 'c2', from: 'dist1.VIN', to: 'pico2w.3V3', net: 'vcc' },
    { id: 'c3', from: 'dist1.GND', to: 'pico2w.GND', net: 'gnd' }
  ]
}

describe('robot.yml round-trip', () => {
  it('round-trips a rich definition', () => {
    expect(robotFromYaml(robotToYaml(RICH))).toEqual(RICH)
  })

  it('round-trips a blank definition', () => {
    expect(robotFromYaml(robotToYaml(blankRobot()))).toEqual(blankRobot())
  })

  it('round-trips the project name + description (and drops empties)', () => {
    const back = robotFromYaml(robotToYaml({ ...blankRobot(), name: 'Rover', description: 'A 2-wheel line follower' }))
    expect(back.name).toBe('Rover')
    expect(back.description).toBe('A 2-wheel line follower')
    // Empty strings are not serialised.
    const empty = robotFromYaml(robotToYaml({ ...blankRobot(), name: '', description: '' }))
    expect(empty.name).toBeUndefined()
    expect(empty.description).toBeUndefined()
  })

  it('round-trips a part rotation and snaps it to 90°', () => {
    const def = robotFromYaml(
      ['parts:', '  - { id: a, lib: l, part: p, rotation: 95 }', '  - { id: b, lib: l, part: p, rotation: 0 }'].join('\n')
    )
    expect(def.parts[0].rotation).toBe(90) // 95 snapped to nearest 90
    expect(def.parts[1].rotation).toBeUndefined() // a no-op 0 is dropped
    const back = robotFromYaml(robotToYaml({ ...blankRobot(), parts: [{ id: 'a', lib: 'l', part: 'p', rotation: 270 }] }))
    expect(back.parts[0].rotation).toBe(270)
  })

  it('drops malformed parts/connections and defaults a missing connection id', () => {
    const def = robotFromYaml(
      [
        'name: X',
        'parts:',
        '  - { id: a, lib: l, part: p }',
        '  - { id: b }', // missing lib/part → dropped
        '  - nonsense',
        'connections:',
        '  - { from: a.X, to: b.Y }', // no id → derived
        '  - { from: a.X }', // no `to` → dropped
        ''
      ].join('\n')
    )
    expect(def.parts.map((p) => p.id)).toEqual(['a'])
    expect(def.connections).toHaveLength(1)
    expect(def.connections[0].id).toBe('a.X__b.Y')
  })
})

describe('KRF robot model round-trips (#312)', () => {
  it('serialises + parses the robot: section (limits, defaultPose, poses)', () => {
    const def: RobotDefinition = {
      parts: [],
      connections: [],
      robot: {
        version: 1,
        urdf: 'urdf/arm.urdf',
        joints: { shoulder: { min: -45, max: 45 } },
        defaultPose: { shoulder: 10 },
        poses: [{ name: 'home', values: { shoulder: 0, elbow: 20 } }]
      }
    }
    const round = robotFromYaml(robotToYaml(def))
    expect(round.robot?.urdf).toBe('urdf/arm.urdf')
    expect(round.robot?.joints?.shoulder).toEqual({ min: -45, max: 45 })
    expect(round.robot?.defaultPose).toEqual({ shoulder: 10 })
    expect(round.robot?.poses).toEqual([{ name: 'home', values: { shoulder: 0, elbow: 20 } }])
  })

  it('a wiring-only robot.yml stays free of a robot: section', () => {
    const yaml = robotToYaml({ parts: [], connections: [] })
    expect(yaml).not.toMatch(/\brobot:/)
    expect(robotFromYaml(yaml).robot).toBeUndefined()
  })

  it('round-trips a motion timeline + mirror (#314)', () => {
    const def: RobotDefinition = {
      parts: [],
      connections: [],
      robot: {
        version: 1,
        urdf: 'urdf/biped.urdf',
        timeline: {
          duration: 2,
          easing: 'easeInOut',
          loop: true,
          fps: 20,
          tracks: [{ joint: 'hip_left', keys: [{ t: 0, value: 45 }, { t: 1, value: 70 }] }]
        },
        mirror: [{ a: 'hip_left', b: 'hip_right', invert: true }]
      }
    }
    const round = robotFromYaml(robotToYaml(def))
    expect(round.robot?.timeline).toEqual(def.robot!.timeline)
    expect(round.robot?.mirror).toEqual(def.robot!.mirror)
  })
})

describe('connection colours', () => {
  it('vcc is red, gnd flips with the theme, signal uses its colour', () => {
    expect(connectionColor({ id: '1', from: 'a', to: 'b', net: 'vcc' }, false)).toBe('#c0392b')
    expect(connectionColor({ id: '2', from: 'a', to: 'b', net: 'gnd' }, false)).toBe('#16191d')
    expect(connectionColor({ id: '3', from: 'a', to: 'b', net: 'gnd' }, true)).toBe('#e9edf1')
    expect(connectionColor({ id: '4', from: 'a', to: 'b', net: 'signal', color: '#abc' }, false)).toBe('#abc')
  })
  it('an explicit colour always wins', () => {
    expect(connectionColor({ id: '5', from: 'a', to: 'b', net: 'vcc', color: '#0f0' }, false)).toBe('#0f0')
  })
  it('signalColor round-robins the palette', () => {
    expect(signalColor(0)).toBe(signalColor(8))
    expect(signalColor(0)).not.toBe(signalColor(1))
  })
})
