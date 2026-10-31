import type { RobotDefinition } from '../../../shared/robot'

/** The wiring with `boardId` as its board. A new or removed board takes the
 *  wires on the old one's pins with it: they'd point at pads that aren't there. */
export function withBoard(robot: RobotDefinition, boardId: string | null): RobotDefinition {
  const board = boardId || undefined
  if (board === robot.board) return robot
  const onBoard = (end: string): boolean => end === 'board' || end.startsWith('board.')
  const connections = robot.board
    ? robot.connections.filter((c) => !onBoard(c.from) && !onBoard(c.to))
    : robot.connections
  const next: RobotDefinition = { ...robot, connections }
  if (board) next.board = board
  else delete next.board
  return next
}
