/**
 * NETLIST EXTRACTOR (epic #597 Circuit Sim, issue #600 — the keystone).
 * =============================================================================
 * Turn the breadboard's WIRING GRAPH into an electrical **netlist**: a set of
 * NODES (electrically-joined points) with the part-pins that meet at each, plus
 * the EDGES (the wires) between them. Every later phase — the Electrical Rules
 * Check (#601), the DC solver (#603) and the component models — consumes this.
 *
 * PURE + dependency-light: it imports only shared types + the pure bus classifier,
 * so it runs headlessly under vitest with no DOM and no MicroPython. It takes the
 * already-resolved inputs (the robot definition, the MCU board, and a map from
 * each placed-part instance id to its {@link PartDefinition}); the caller does the
 * library lookup.
 *
 * ── The model (see docs/circuit-sim-epic.md §4 #600) ──
 * Endpoints are wiring strings `"<key>.<pinName>#<index>"` where `key` is `"board"`
 * for the MCU or a placed part's instance id, and `#index` is the authoritative
 * FLATTENED pin index (pin names repeat — a Pico has eight pads all called `GND`).
 *
 * Two implicit rules Snakie's model requires, on top of the user's explicit wires:
 *   1. **The board's own rails are internally bonded.** All of the MCU's GND pads
 *      are one node; pads sharing a power-rail label (all `3V3`, all `VBUS`, …)
 *      are one node per rail — because they're joined on the real PCB. Distinct
 *      rails stay distinct (`VBUS` ≠ `VSYS` ≠ `3V3`).
 *   2. **Everything else is explicit.** Two pads on the same physical breadboard
 *      row are NOT auto-joined — the netlist is exactly the wires drawn (plus rule
 *      1). A part's `GND` only reaches the board ground when a wire says so.
 *
 * Nodes are computed with a union-find over endpoints. 3-way junctions are just
 * several wires sharing an endpoint (there is no junction primitive), so they fall
 * out of the union naturally.
 */
import type { BoardDefinition, BoardPad, BoardPadType } from './board'
import type { PartDefinition, PartPin, PartPinCapability } from './part'
import { connectionId, type RobotConnection, type RobotDefinition } from './robot'
import { classifyBusWire, type BusWire } from './bus-wires'

/** A pin's electrical role, normalised across board pads and part pins. */
export type TerminalRole = 'gnd' | 'pwr' | 'io' | 'other'

/** One resolved wiring endpoint — a single physical pin the netlist knows about. */
export interface NetlistTerminal {
  /** The wiring endpoint string, e.g. `"board.GP15#7"` or `"led1.A#0"`. */
  endpoint: string
  /** Instance key: `"board"` for the MCU, else the placed part's instance id. */
  key: string
  /** The flattened pin index on that subject (authoritative — names repeat). */
  index: number
  /** Human pin name / silk label (`GP15`, `SDA`, `VBUS`, `A`, `+`). */
  name: string
  /** Electrical role, normalised (board `vcc`→`pwr`, `gpio`→`io`; part roles kept). */
  role: TerminalRole
  /** Rail label for power/ground terminals (`GND`, `VBUS`, `VSYS`, `3V3`, `5V`, …). */
  rail?: string
  /** GPIO number, when the terminal maps to one (a board GPIO pad / part io pin). */
  gpio?: number
  /** `io` capabilities (i2c/spi/…), when the pin declares them. */
  capabilities?: PartPinCapability[]
}

/** A node = a set of terminals that are electrically the same point. */
export interface NetlistNode {
  /** Stable id assigned in a deterministic order: `N0`, `N1`, … */
  id: string
  /** The terminals joined at this node. */
  terminals: NetlistTerminal[]
  /** Net classification: `ground` if any terminal is GND, else `power` if any is
   *  a supply, else `signal`. (A node with BOTH gnd + pwr is a short — #601's job
   *  to flag; here it classifies as `ground`.) */
  kind: 'ground' | 'power' | 'signal'
  /** The rail label for a `power`/`ground` node when unambiguous (`GND`, `3V3`). */
  rail?: string
}

/** An edge between two endpoints — a user wire, or a synthetic board-rail bond. */
export interface NetlistEdge {
  /** The wire id (`RobotConnection.id`) or a synthesised id for internal bonds. */
  id: string
  /** Endpoint strings this edge joins. */
  from: string
  to: string
  /** Bus classification (i2c/spi) when the wire joins bus-capable pins. */
  bus?: BusWire
  /** True for a synthetic edge modelling the board's internal rail bonding
   *  (its GND pads, its same-rail power pads) rather than a user-drawn wire. */
  internal?: boolean
}

/** The extracted electrical netlist. */
export interface Netlist {
  /** Every node, in deterministic id order. */
  nodes: NetlistNode[]
  /** Every edge (user wires + internal rail bonds). */
  edges: NetlistEdge[]
  /** endpoint string → node id, for O(1) lookup. */
  nodeOf: Record<string, string>
  /** Endpoints a wire referenced that couldn't be resolved (missing part/pin/pad).
   *  Surfaced, never silently dropped — ERC + the UI want to know. */
  dangling: string[]
}

/** The MCU board endpoint key (the wiring uses `"board.<pin>#<i>"` for it). */
const BOARD_KEY = 'board'

// --- endpoint parsing --------------------------------------------------------

/** Parse `"<key>.<pinName>#<index>"` → its subject key + flattened pin index.
 *  Mirrors `WiringCanvas.parseEndpoint`: the `#index` is authoritative. */
export function parseEndpoint(ep: string): { key: string; index: number } {
  const hash = ep.lastIndexOf('#')
  const index = hash >= 0 ? parseInt(ep.slice(hash + 1), 10) : -1
  const head = hash >= 0 ? ep.slice(0, hash) : ep
  const dot = head.indexOf('.')
  return { key: dot >= 0 ? head.slice(0, dot) : head, index }
}

// --- pin flattening (must match the wiring endpoint order) -------------------

/** Flatten a board's pads in header→pin order (mirrors `enumerateBoardPads`): the
 *  flattened position IS the wiring endpoint `#index`. Empty headers contribute
 *  nothing, so they don't shift indices. */
function flattenBoardPads(board: BoardDefinition): BoardPad[] {
  const out: BoardPad[] = []
  for (const header of board.headers ?? []) for (const pad of header.pins ?? []) out.push(pad)
  return out
}

/** Flatten a part's pins in header→pin order (mirrors `resolvedPins`): the
 *  flattened position IS the wiring endpoint `#index`. */
function flattenPartPins(part: PartDefinition): PartPin[] {
  const out: PartPin[] = []
  for (const header of part.headers ?? []) for (const pin of header.pins ?? []) out.push(pin)
  return out
}

// --- role + rail classification ----------------------------------------------

/** A ground pad/pin (by role, or a ground-ish label as a fallback). Mirrors the
 *  board-layout schematic rail logic so the netlist merges the same pads. */
function isGndLabel(label: string): boolean {
  return /^(gnd|ground|vss|vee|agnd|dgnd)$/i.test(label)
}
/** A power-rail pad/pin (by role, or a supply-ish label as a fallback). */
function isPwrLabel(label: string): boolean {
  return /^(3v3|3\.3v|5v|vcc|vdd|vbus|vsys|vin|v\+|avdd)$/i.test(label)
}

/** Normalise a board pad's type to a terminal role (`vcc`→`pwr`, `gpio`→`io`;
 *  absent type defaults to `gpio`→`io`), with a label fallback for untyped pads. */
function boardPadRole(pad: BoardPad): TerminalRole {
  const t: BoardPadType = pad.type ?? 'gpio'
  if (t === 'gnd') return 'gnd'
  if (t === 'vcc') return 'pwr'
  if (t === 'other') {
    // A pad typed `other` but labelled like a rail (some hand-authored boards) is
    // still a rail electrically.
    if (isGndLabel(pad.label)) return 'gnd'
    if (isPwrLabel(pad.label)) return 'pwr'
    return 'other'
  }
  return 'io'
}

/** The rail a terminal belongs to: `GND` for any ground, `<LABEL>` (upper-cased)
 *  for a power pin, else undefined (signals are never railed/merged). */
function railOf(role: TerminalRole, label: string): string | undefined {
  if (role === 'gnd') return 'GND'
  if (role === 'pwr') return label.toUpperCase()
  return undefined
}

// --- terminal resolution -----------------------------------------------------

/** Resolve one endpoint to a terminal, or null if it can't be resolved (a wire to
 *  a missing part / out-of-range pin — surfaced as `dangling`). */
function resolveTerminal(
  endpoint: string,
  board: BoardDefinition | null,
  partDefs: Map<string, PartDefinition>
): NetlistTerminal | null {
  const { key, index } = parseEndpoint(endpoint)
  if (index < 0) return null

  if (key === BOARD_KEY) {
    if (!board) return null
    const pad = flattenBoardPads(board)[index]
    if (!pad) return null
    const role = boardPadRole(pad)
    const t: NetlistTerminal = { endpoint, key, index, name: pad.label, role }
    const rail = railOf(role, pad.label)
    if (rail) t.rail = rail
    if (pad.gpio !== undefined) t.gpio = pad.gpio
    return t
  }

  const def = partDefs.get(key)
  if (!def) return null
  const pin = flattenPartPins(def)[index]
  if (!pin) return null
  // Part roles already match TerminalRole ('pwr'|'gnd'|'io'|'other').
  const role: TerminalRole = pin.type
  const name = pin.name || pin.label || ''
  const t: NetlistTerminal = { endpoint, key, index, name, role }
  const rail = railOf(role, name)
  if (rail) t.rail = rail
  if (pin.gpio !== undefined) t.gpio = pin.gpio
  if (pin.capabilities && pin.capabilities.length) t.capabilities = pin.capabilities
  return t
}

// --- board swap: re-map wiring to a new MCU ----------------------------------

/** A connection dropped by {@link remapConnectionsForBoard}, with why. */
export interface RemovedConnection {
  connection: RobotConnection
  /** Human reasons a board endpoint couldn't be re-mapped (`GPIO 26`, `5V rail`). */
  reasons: string[]
}

/** The result of re-mapping a robot's wiring onto a swapped-in board. */
export interface BoardRemap {
  /** Surviving connections, board endpoints rewritten to the new board's pads. */
  connections: RobotConnection[]
  /** Connections dropped because a board pad had no counterpart on the new board. */
  removed: RemovedConnection[]
}

/** Why an old-board pad has no counterpart (shown in the swap confirm dialog). */
function unmatchedReason(pad: BoardPad): string {
  const role = boardPadRole(pad)
  if (role === 'gnd') return 'GND'
  if (role === 'pwr') return `${pad.label} rail`
  if (role === 'io' && pad.gpio !== undefined) return `GPIO ${pad.gpio}`
  return pad.label
}

/** Canonical rail key so near-equivalent supply labels match (`3.3V`≡`3V3`≡`3V`,
 *  `5.0V`≡`5V`), while distinct rails stay distinct (`3V3`≠`5V`≠`VSYS`). */
function canonRail(label: string): string {
  const u = label.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (u === '3V3' || u === '33V' || u === '3V') return '3V3'
  if (u === '5V' || u === '50V') return '5V'
  return u
}

/** The new-board pad index that should inherit an old-board pad's wire:
 *  - ground → any ground pad (all bonded), preferring the same label;
 *  - power  → a pad on the SAME rail (canonicalised label; 3V3 ≠ 5V);
 *  - GPIO   → the pad with the same `gpio` number (may sit on a different pin);
 *  - other / io-without-gpio → the pad with the same label (case-insensitive).
 *  Returns its flattened index, or null when the new board has no counterpart. */
function matchPadIndex(oldPad: BoardPad, newPads: BoardPad[]): number | null {
  const role = boardPadRole(oldPad)
  const find = (pred: (p: BoardPad) => boolean): number | null => {
    const i = newPads.findIndex(pred)
    return i >= 0 ? i : null
  }
  if (role === 'gnd') {
    return (
      find((p) => boardPadRole(p) === 'gnd' && p.label === oldPad.label) ??
      find((p) => boardPadRole(p) === 'gnd')
    )
  }
  if (role === 'pwr') {
    const rail = canonRail(oldPad.label)
    return find((p) => boardPadRole(p) === 'pwr' && canonRail(p.label) === rail)
  }
  if (role === 'io' && oldPad.gpio !== undefined) {
    return find((p) => p.gpio === oldPad.gpio)
  }
  const label = oldPad.label.toUpperCase()
  return find((p) => p.label.toUpperCase() === label)
}

/** Re-map one endpoint. Non-board endpoints (placed parts) pass through unchanged;
 *  a board endpoint is rewritten to its matching new pad, or reported unmatched. */
function remapEndpoint(
  endpoint: string,
  oldPads: BoardPad[],
  newPads: BoardPad[]
): { endpoint: string } | { unmatched: string } {
  const { key, index } = parseEndpoint(endpoint)
  if (key !== BOARD_KEY) return { endpoint }
  const oldPad = oldPads[index]
  if (!oldPad) return { unmatched: 'a removed pin' }
  const ni = matchPadIndex(oldPad, newPads)
  if (ni === null) return { unmatched: unmatchedReason(oldPad) }
  return { endpoint: `${BOARD_KEY}.${newPads[ni].label}#${ni}` }
}

/**
 * Re-map a robot's wiring when the MCU board is swapped. Each board endpoint moves
 * to the pad carrying the SAME GPIO (power/ground matched by rail/type), so a wire
 * follows its signal even when it lands on a different physical pin. A wire whose
 * board pad has no counterpart on the new board is dropped (with a reason). Pure +
 * tested; the UI confirms the removals before applying.
 */
export function remapConnectionsForBoard(
  connections: RobotConnection[],
  oldBoard: BoardDefinition,
  newBoard: BoardDefinition
): BoardRemap {
  const oldPads = flattenBoardPads(oldBoard)
  const newPads = flattenBoardPads(newBoard)
  const kept: RobotConnection[] = []
  const removed: RemovedConnection[] = []
  // Merging pads (e.g. eight GND pads → one on the new board) can rewrite several
  // wires onto the same endpoint. Drop the resulting self-loops + duplicates so we
  // never persist wires the user could not draw (WiringCanvas rejects both).
  const seen = new Set<string>()
  for (const c of connections) {
    const f = remapEndpoint(c.from, oldPads, newPads)
    const t = remapEndpoint(c.to, oldPads, newPads)
    const reasons: string[] = []
    if ('unmatched' in f) reasons.push(f.unmatched)
    if ('unmatched' in t) reasons.push(t.unmatched)
    if (reasons.length) {
      removed.push({ connection: c, reasons })
      continue
    }
    const from = (f as { endpoint: string }).endpoint
    const to = (t as { endpoint: string }).endpoint
    if (from === to) continue // collapsed onto one pad — electrically a no-op
    const key = [from, to].sort().join('|')
    if (seen.has(key)) continue // duplicate / reverse-duplicate of a kept wire
    seen.add(key)
    // When an endpoint moved, recompute the id from the new endpoints so a later
    // redraw of this wire doesn't create a duplicate (ids are `${from}__${to}`).
    const moved = from !== c.from || to !== c.to
    kept.push(moved ? { ...c, id: connectionId(from, to), from, to } : c)
  }
  return { connections: kept, removed }
}

// --- union-find --------------------------------------------------------------

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let root = this.parent.get(x)
    if (root === undefined) {
      this.parent.set(x, x)
      return x
    }
    // Path-halving.
    while (root !== x) {
      const gp = this.parent.get(root) ?? root
      this.parent.set(x, gp)
      x = gp
      root = this.parent.get(x) ?? x
    }
    return x
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

// --- the extractor -----------------------------------------------------------

/** The bus-classifier's per-endpoint view of a terminal. */
function busInfo(t: NetlistTerminal): { caps?: PartPinCapability[]; gpio?: number } {
  return { caps: t.capabilities, gpio: t.gpio }
}

/**
 * Build the electrical netlist from the wiring graph. Pure: no DOM, no IO.
 *
 * @param robot     the project (its `connections` are the wires; `board` its MCU id)
 * @param board     the resolved MCU {@link BoardDefinition} (or null if none chosen)
 * @param partDefs  placed-part **instance id** → its {@link PartDefinition}
 */
export function buildNetlist(
  robot: RobotDefinition,
  board: BoardDefinition | null,
  partDefs: Map<string, PartDefinition>
): Netlist {
  const uf = new UnionFind()
  const terminals = new Map<string, NetlistTerminal>()
  const edges: NetlistEdge[] = []
  const dangling: string[] = []

  // Register a terminal (idempotent) and seed it into the union-find.
  const register = (endpoint: string): NetlistTerminal | null => {
    const existing = terminals.get(endpoint)
    if (existing) return existing
    const t = resolveTerminal(endpoint, board, partDefs)
    if (!t) return null
    terminals.set(endpoint, t)
    uf.find(endpoint) // seed
    return t
  }

  // 1. Board internal rail bonding: all GND pads → one node; each distinct power
  //    rail label → one node. Synthetic `internal` edges record the bonds.
  if (board) {
    const railFirst = new Map<string, string>() // rail label → first endpoint seen
    flattenBoardPads(board).forEach((pad, index) => {
      const role = boardPadRole(pad)
      const rail = railOf(role, pad.label)
      if (!rail) return
      const endpoint = `${BOARD_KEY}.${pad.label}#${index}`
      register(endpoint)
      const anchor = railFirst.get(rail)
      if (anchor === undefined) {
        railFirst.set(rail, endpoint)
      } else {
        uf.union(anchor, endpoint)
        edges.push({ id: `board:rail:${rail}:${index}`, from: anchor, to: endpoint, internal: true })
      }
    })
  }

  // 2. Every user-drawn wire joins its two endpoints. Unresolvable endpoints are
  //    surfaced as dangling (the wire is skipped, not silently swallowed).
  for (const conn of robot.connections ?? []) {
    const from = register(conn.from)
    const to = register(conn.to)
    if (!from) dangling.push(conn.from)
    if (!to) dangling.push(conn.to)
    if (!from || !to) continue
    uf.union(conn.from, conn.to)
    const bus = classifyBusWire(busInfo(from), busInfo(to)) ?? undefined
    const edge: NetlistEdge = { id: conn.id, from: conn.from, to: conn.to }
    if (bus) edge.bus = bus
    edges.push(edge)
  }

  // 3. Collect terminals into nodes by union-find root, in a deterministic order
  //    (board pads by index, then parts by instance id then pin index) so node ids
  //    are stable across runs and re-layouts.
  const ordered = [...terminals.values()].sort((a, b) => {
    const ab = a.key === BOARD_KEY ? 0 : 1
    const bb = b.key === BOARD_KEY ? 0 : 1
    if (ab !== bb) return ab - bb
    if (a.key !== b.key) return a.key < b.key ? -1 : 1
    return a.index - b.index
  })

  const rootToNode = new Map<string, NetlistNode>()
  const nodes: NetlistNode[] = []
  const nodeOf: Record<string, string> = {}
  for (const t of ordered) {
    const root = uf.find(t.endpoint)
    let node = rootToNode.get(root)
    if (!node) {
      node = { id: `N${nodes.length}`, terminals: [], kind: 'signal' }
      rootToNode.set(root, node)
      nodes.push(node)
    }
    node.terminals.push(t)
    nodeOf[t.endpoint] = node.id
  }

  // 4. Classify each node: ground wins, then power (carry the rail when all its
  //    rail terminals agree), else signal.
  for (const node of nodes) {
    const hasGnd = node.terminals.some((t) => t.role === 'gnd')
    const pwrRails = new Set(node.terminals.filter((t) => t.role === 'pwr').map((t) => t.rail))
    if (hasGnd) {
      node.kind = 'ground'
      node.rail = 'GND'
    } else if (pwrRails.size > 0) {
      node.kind = 'power'
      // A single, agreed rail label → carry it; a node bridging two rails (a
      // wiring mistake) leaves rail undefined for ERC to notice.
      if (pwrRails.size === 1) {
        const only = [...pwrRails][0]
        if (only) node.rail = only
      }
    }
  }

  return { nodes, edges, nodeOf, dangling }
}
