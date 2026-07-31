import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { robotFromYaml } from '../src/shared/robot-yaml'
import { partFromYaml } from '../src/shared/part-yaml'
import { buildNetlist } from '../src/shared/netlist'
import { runErc } from '../src/shared/erc'
import { partToBoardDefinition } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * The servo-arm demo is the one artefact that shows Electronics, Robot and Code as
 * the SAME robot — it is how a new user discovers that the three workspaces are
 * connected at all. A silently broken endpoint would leave them looking at an
 * empty board and drawing the opposite conclusion, so it is guarded here.
 */
const ROOT = join(__dirname, '..', 'examples')
const part = (id: string): PartDefinition =>
  partFromYaml(readFileSync(join(ROOT, 'parts', 'snakie-standard', id, 'parts.yml'), 'utf-8'))
const robot = robotFromYaml(readFileSync(join(ROOT, 'servo-arm', 'robot.yml'), 'utf-8'))

const defs = new Map<string, PartDefinition>([
  ['board', part('pico')],
  ...robot.parts.map((p) => [p.id, part(p.part)] as [string, PartDefinition])
])
const netlist = buildNetlist(robot, partToBoardDefinition(part('pico')), defs)

/** The node a given endpoint landed on, or undefined if it resolved to nothing. */
const nodeOf = (endpoint: string): string | undefined =>
  netlist.nodes.find((n) => n.terminals.some((t) => t.endpoint === endpoint))?.id

describe('the servo-arm demo project', () => {
  it('places a board and both servos', () => {
    expect(robot.board).toBe('pico')
    expect(robot.parts.map((p) => p.id).sort()).toEqual(['elbow', 'shoulder'])
  })

  it('resolves EVERY wire — no endpoint points at a pin that does not exist', () => {
    // Endpoints carry a flattened pin index; get one wrong and the wire silently
    // vanishes from the board instead of erroring.
    for (const c of robot.connections) {
      expect(nodeOf(c.from), `${c.id} from`).toBeDefined()
      expect(nodeOf(c.to), `${c.id} to`).toBeDefined()
    }
  })

  it('joins each servo signal to its own GPIO', () => {
    expect(nodeOf('shoulder.Signal#0')).toBe(nodeOf('board.GP0#0'))
    expect(nodeOf('elbow.Signal#0')).toBe(nodeOf('board.GP1#1'))
    // …and NOT to each other, which would drive both joints from one pin.
    expect(nodeOf('shoulder.Signal#0')).not.toBe(nodeOf('elbow.Signal#0'))
  })

  it('shares one ground and powers both servos from the same rail', () => {
    expect(nodeOf('shoulder.GND#2')).toBe(nodeOf('elbow.GND#2'))
    expect(nodeOf('shoulder.VCC#1')).toBe(nodeOf('elbow.VCC#1'))
  })

  it('passes its own ERC — the demo must not ship a fault', () => {
    // It would otherwise greet a new user with magic smoke (#618).
    const errors = runErc(netlist, defs).filter((i) => i.severity === 'error')
    expect(errors.map((e) => e.title)).toEqual([])
  })

  it('binds each joint to the GPIO its servo is actually wired to', () => {
    // The spine of the whole demo: wiring in Electronics, joints in Robot. If the
    // map named a pin nothing is wired to, the 3-D arm would never move and the
    // connection the demo exists to teach would be a lie.
    const map = robot.robot?.servoJointMap ?? []
    expect(map.map((m) => m.joint).sort()).toEqual(['elbow', 'shoulder'])
    for (const { pin, joint } of map) {
      const gpio = `board.GP${pin}#${pin}`
      const servo = joint === 'shoulder' ? 'shoulder.Signal#0' : 'elbow.Signal#0'
      expect(nodeOf(gpio), `GP${pin} is wired`).toBeDefined()
      expect(nodeOf(servo)).toBe(nodeOf(gpio))
    }
  })

  it('references a URDF that ships beside it', () => {
    const urdf = robot.robot?.urdf
    expect(urdf).toBeTruthy()
    expect(() => readFileSync(join(ROOT, 'servo-arm', urdf!), 'utf-8')).not.toThrow()
  })

  it('names the joints the URDF actually defines', () => {
    const urdf = readFileSync(join(ROOT, 'servo-arm', robot.robot!.urdf!), 'utf-8')
    for (const m of robot.robot?.servoJointMap ?? []) {
      expect(urdf, `joint "${m.joint}"`).toContain(`name="${m.joint}"`)
    }
  })
})
