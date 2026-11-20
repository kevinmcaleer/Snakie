/**
 * WHAT IS WIRED TO EACH BOARD PIN (#1320) — read out of a robot definition.
 *
 * A project's wiring says `board.GP15` goes to `servo1.SIG`. A code frame on
 * that project's page wants the other direction of the same fact: "GP15 is
 * Servo 1". This follows the wires (through joined nets, and through a part
 * seated on a carrier) from every board pin to the part pins it reaches.
 *
 * Pure and dependency-free, so the embed, the tests and a host page's own
 * checks can share it.
 */
import type { RobotDefinition, RobotNet } from './robot'

/** One part pin a board pin reaches. */
export interface WiredTo {
  /** The part instance id (`servo1`). */
  part: string
  /** What to call the part: its label, else its library part id, else its instance id. */
  label: string
  /** The pin on that part (`SIG`). */
  pin: string
  net?: RobotNet
  /** The ids of the wires that make the path, for a viewer to light. */
  wires: string[]
}

const BOARD = 'board'

function split(endpoint: string): { part: string; pin: string } | null {
  const dot = endpoint.indexOf('.')
  if (dot <= 0 || dot === endpoint.length - 1) return null
  return { part: endpoint.slice(0, dot), pin: endpoint.slice(dot + 1) }
}

/**
 * Board pin name (as the wiring writes it, e.g. `GP15`) → the part pins it is
 * wired to. A board pin with nothing on it is absent.
 */
export function boardWiring(robot: RobotDefinition | null | undefined): Map<string, WiredTo[]> {
  const out = new Map<string, WiredTo[]>()
  if (!robot || !Array.isArray(robot.connections)) return out
  const parts = new Map((robot.parts ?? []).map((p) => [p.id, p]))

  // A part seated in a carrier shares the carrier's same-named pins, and so
  // does a board seated in one.
  const canonical = (endpoint: string): string => {
    const ep = split(endpoint)
    if (!ep) return endpoint
    let owner = ep.part
    for (let hops = 0; hops < 8; hops++) {
      const carrier = owner === BOARD ? robot.boardMountedOn : parts.get(owner)?.mountedOn
      if (!carrier || carrier === owner) break
      owner = carrier
    }
    return `${owner}.${ep.pin}`
  }

  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as string
    parent.set(k, root)
    return root
  }
  const seen = new Map<string, string>() // canonical → the endpoint as written
  const touch = (endpoint: string): string => {
    const key = canonical(endpoint)
    if (!parent.has(key)) parent.set(key, key)
    // Prefer the board's own spelling of a shared pin.
    if (!seen.has(key) || endpoint.startsWith(`${BOARD}.`)) seen.set(key, endpoint)
    return key
  }
  const written: { endpoint: string; key: string }[] = []
  for (const c of robot.connections) {
    if (typeof c?.from !== 'string' || typeof c?.to !== 'string') continue
    const a = touch(c.from)
    const b = touch(c.to)
    written.push({ endpoint: c.from, key: a }, { endpoint: c.to, key: b })
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Group the endpoints, and the wires, by net.
  const groups = new Map<string, { board: Set<string>; ends: Set<string>; wires: string[]; net?: RobotNet }>()
  const groupOf = (key: string): { board: Set<string>; ends: Set<string>; wires: string[]; net?: RobotNet } => {
    const root = find(key)
    let g = groups.get(root)
    if (!g) {
      g = { board: new Set(), ends: new Set(), wires: [] }
      groups.set(root, g)
    }
    return g
  }
  for (const { endpoint, key } of written) {
    const g = groupOf(key)
    const ep = split(endpoint)
    if (!ep) continue
    // A wire on the carrier the board is seated in is a wire on the board's pin.
    if (ep.part === BOARD || ep.part === robot.boardMountedOn) g.board.add(ep.pin)
    else g.ends.add(endpoint)
  }
  for (const c of robot.connections) {
    if (typeof c?.from !== 'string' || typeof c?.to !== 'string') continue
    const g = groupOf(canonical(c.from))
    if (c.id) g.wires.push(c.id)
    if (c.net && !g.net) g.net = c.net
  }

  for (const g of groups.values()) {
    if (g.board.size === 0 || g.ends.size === 0) continue
    const reached: WiredTo[] = []
    for (const endpoint of g.ends) {
      const ep = split(endpoint)
      if (!ep) continue
      const part = parts.get(ep.part)
      reached.push({
        part: ep.part,
        label: (part?.label || part?.part || ep.part).trim(),
        pin: ep.pin,
        ...(g.net ? { net: g.net } : {}),
        wires: g.wires
      })
    }
    for (const pin of g.board) out.set(pin, [...(out.get(pin) ?? []), ...reached])
  }
  return out
}

/** The parts on a pin, as one short phrase: `Servo 1`, `Servo 1, Buzzer`. */
export function wiredLabel(wired: readonly WiredTo[]): string {
  const names: string[] = []
  for (const w of wired) if (!names.includes(w.label)) names.push(w.label)
  return names.join(', ')
}
