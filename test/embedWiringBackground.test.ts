import { describe, expect, it } from 'vitest'
import { backgroundFor, matFor, withBackground } from '../src/renderer/src/embed/wiring-background'
import type { RobotDefinition, WiringBackground } from '../src/shared/robot'

const robot: RobotDefinition = { parts: [], connections: [] }

describe('wiring background', () => {
  it('maps each background to a mat and back', () => {
    for (const bg of ['transparent', 'blueprint', 'blueprint-dark'] as WiringBackground[]) {
      expect(backgroundFor(matFor(bg))).toBe(bg)
    }
  })

  it('is black blueprint when the wiring has none saved', () => {
    expect(matFor(undefined)).toBe('dark')
    expect(withBackground(robot, 'blueprint-dark')).toBe(robot)
  })

  it('saves a new choice in the wiring, leaving the rest alone', () => {
    const next = withBackground(robot, 'transparent')
    expect(next).not.toBe(robot)
    expect(next.wiringBackground).toBe('transparent')
    expect(next.parts).toBe(robot.parts)
    expect(withBackground(next, 'transparent')).toBe(next)
  })
})
