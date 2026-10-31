/**
 * The wiring's background (snakie embed, for the kevsrobots project editor):
 * transparent, or blueprint paper in black or blue. It is saved in the wiring
 * itself as `robot.wiringBackground` and drawn as the canvas's mat.
 */
import type { WiringMat } from '../components/WiringCanvas'
import type { RobotDefinition, WiringBackground } from '../../../shared/robot'

/** The wiring's background, as the canvas's mat. */
export function matFor(background: WiringBackground | undefined): WiringMat {
  return background === 'transparent' ? 'transparent' : background === 'blueprint' ? 'blueprint' : 'dark'
}

/** The canvas's mat, as the background saved in the wiring. */
export function backgroundFor(mat: WiringMat): WiringBackground {
  return mat === 'transparent' ? 'transparent' : mat === 'blueprint' ? 'blueprint' : 'blueprint-dark'
}

/** `robot` drawn on `background` (the same object when it already is). */
export function withBackground(robot: RobotDefinition, background: WiringBackground): RobotDefinition {
  return (robot.wiringBackground ?? 'blueprint-dark') === background ? robot : { ...robot, wiringBackground: background }
}
