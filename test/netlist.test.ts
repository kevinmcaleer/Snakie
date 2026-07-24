import { describe, it, expect } from 'vitest'
import { buildNetlist, parseEndpoint, remapConnectionsForBoard, type Netlist } from '../src/shared/netlist'
import type { BoardDefinition } from '../src/shared/board'
import type { PartDefinition } from '../src/shared/part'
import type { RobotConnection, RobotDefinition } from '../src/shared/robot'

// --- fixtures ----------------------------------------------------------------

/** A tiny MCU: one left header with 5V, GND, 3V3, GP0, GP1; one right header with
 *  a second GND and a second 3V3 (to exercise rail bonding). Endpoint indices are
 *  the flattened order: 0=5V 1=GND 2=3V3 3=GP0 4=GP1 5=GND 6=3V3. */
const BOARD: BoardDefinition = {
  id: 'testmcu',
  name: 'Test MCU',
  mcu: 'RP2040',
  pcbColor: '#0f5a2e',
  aspect: 0.6,
  headers: [
    {
      edge: 'left',
      pins: [
        { label: '5V', type: 'vcc' },
        { label: 'GND', type: 'gnd' },
        { label: '3V3', type: 'vcc' },
        { label: 'GP0', type: 'gpio', gpio: 0 },
        { label: 'GP1', type: 'gpio', gpio: 1 }
      ]
    },
    {
      edge: 'right',
      pins: [
        { label: 'GND', type: 'gnd' },
        { label: '3V3', type: 'vcc' }
      ]
    }
  ]
}

/** A 3-pin part: A (anode/io), K (cathode/gnd-ish), VIN (pwr). */
function part(id: string, pins: PartDefinition['headers'][number]['pins']): PartDefinition {
  return { id, name: id, headers: [{ edge: 'left', pins }] }
}

/** A resistor part: two plain io legs. */
const RESISTOR = part('r', [
  { name: '1', type: 'io' },
  { name: '2', type: 'io' }
])
/** An LED part: anode + cathode. */
const LED = part('led', [
  { name: 'A', type: 'io' },
  { name: 'K', type: 'gnd' }
])
/** An I2C sensor: VIN, GND, SDA, SCL (SDA/SCL carry the i2c capability). */
const SENSOR = part('sensor', [
  { name: 'VIN', type: 'pwr' },
  { name: 'GND', type: 'gnd' },
  { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c'] },
  { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c'] }
])

function ep(key: string, pin: string, index: number): string {
  return `${key}.${pin}#${index}`
}
function wire(id: string, from: string, to: string): RobotConnection {
  return { id, from, to }
}
function robot(connections: RobotConnection[]): RobotDefinition {
  return { parts: [], connections }
}
/** The node a given endpoint resolves to. */
function nodeAt(nl: Netlist, endpoint: string): (typeof nl.nodes)[number] | undefined {
  const id = nl.nodeOf[endpoint]
  return nl.nodes.find((n) => n.id === id)
}

// --- tests -------------------------------------------------------------------

describe('parseEndpoint', () => {
  it('splits "<key>.<pin>#<index>" — the #index is authoritative', () => {
    expect(parseEndpoint('board.GP15#7')).toEqual({ key: 'board', index: 7 })
    expect(parseEndpoint('led1.A#0')).toEqual({ key: 'led1', index: 0 })
    expect(parseEndpoint('board.GND')).toEqual({ key: 'board', index: -1 }) // no index
  })
})

describe('buildNetlist — board internal rail bonding', () => {
  it("collapses all the board's GND pads into one ground node, distinct rails apart", () => {
    const nl = buildNetlist(robot([]), BOARD, new Map())
    // Two GND pads (#1, #5) → one node.
    const gndA = nodeAt(nl, ep('board', 'GND', 1))
    const gndB = nodeAt(nl, ep('board', 'GND', 5))
    expect(gndA).toBeDefined()
    expect(gndA!.id).toBe(gndB!.id)
    expect(gndA!.kind).toBe('ground')
    expect(gndA!.rail).toBe('GND')
    // Two 3V3 pads (#2, #6) → one power node, labelled 3V3.
    const v3a = nodeAt(nl, ep('board', '3V3', 2))
    const v3b = nodeAt(nl, ep('board', '3V3', 6))
    expect(v3a!.id).toBe(v3b!.id)
    expect(v3a!.kind).toBe('power')
    expect(v3a!.rail).toBe('3V3')
    // 5V is its own distinct rail (not merged with 3V3).
    const v5 = nodeAt(nl, ep('board', '5V', 0))
    expect(v5!.id).not.toBe(v3a!.id)
    expect(v5!.rail).toBe('5V')
    // A synthetic internal edge bonds the two grounds.
    expect(nl.edges.some((e) => e.internal && e.from === ep('board', 'GND', 1) && e.to === ep('board', 'GND', 5))).toBe(true)
  })

  it('does NOT bond distinct power rails together (VBUS ≠ VSYS ≠ 3V3)', () => {
    const nl = buildNetlist(robot([]), BOARD, new Map())
    const rails = new Set(nl.nodes.filter((n) => n.kind === 'power').map((n) => n.rail))
    expect(rails).toEqual(new Set(['5V', '3V3']))
  })
})

describe('buildNetlist — explicit wires', () => {
  it('a GP0 → resistor → LED → GND chain forms the expected nodes', () => {
    const defs = new Map<string, PartDefinition>([
      ['r', RESISTOR],
      ['led', LED]
    ])
    const nl = buildNetlist(
      robot([
        wire('w1', ep('board', 'GP0', 3), ep('r', '1', 0)),
        wire('w2', ep('r', '2', 1), ep('led', 'A', 0)),
        wire('w3', ep('led', 'K', 1), ep('board', 'GND', 1))
      ]),
      BOARD,
      defs
    )
    // GP0 and the resistor leg 1 share a node.
    expect(nl.nodeOf[ep('board', 'GP0', 3)]).toBe(nl.nodeOf[ep('r', '1', 0)])
    // The LED cathode joins the board ground node (which also holds both GND pads).
    const gndNode = nodeAt(nl, ep('led', 'K', 1))!
    expect(gndNode.kind).toBe('ground')
    expect(gndNode.terminals.map((t) => t.endpoint)).toEqual(
      expect.arrayContaining([ep('board', 'GND', 1), ep('board', 'GND', 5), ep('led', 'K', 1)])
    )
    // The resistor's two legs are on DIFFERENT nodes (it's a 2-terminal element).
    expect(nl.nodeOf[ep('r', '1', 0)]).not.toBe(nl.nodeOf[ep('r', '2', 1)])
  })

  it('a 3-way junction (three wires sharing an endpoint) is ONE node', () => {
    const defs = new Map<string, PartDefinition>([
      ['r', RESISTOR],
      ['led', LED]
    ])
    // GP1 fans out to r.1, led.A and (again) r.2 — all one electrical node.
    const nl = buildNetlist(
      robot([
        wire('a', ep('board', 'GP1', 4), ep('r', '1', 0)),
        wire('b', ep('board', 'GP1', 4), ep('led', 'A', 0)),
        wire('c', ep('board', 'GP1', 4), ep('r', '2', 1))
      ]),
      BOARD,
      defs
    )
    const n = nl.nodeOf[ep('board', 'GP1', 4)]
    expect(nl.nodeOf[ep('r', '1', 0)]).toBe(n)
    expect(nl.nodeOf[ep('led', 'A', 0)]).toBe(n)
    expect(nl.nodeOf[ep('r', '2', 1)]).toBe(n)
    // Three user edges, no internal edge for a signal junction.
    expect(nl.edges.filter((e) => !e.internal)).toHaveLength(3)
  })
})

describe('buildNetlist — bus tagging', () => {
  it('tags an I2C wire (SDA/SCL) with its bus, leaves power wires untagged', () => {
    const defs = new Map<string, PartDefinition>([['sensor', SENSOR]])
    const nl = buildNetlist(
      robot([
        wire('sda', ep('board', 'GP4', 3), ep('sensor', 'SDA', 2)),
        wire('pwr', ep('board', '3V3', 2), ep('sensor', 'VIN', 0))
      ]),
      // Board GP0 is at index 3; give it gpio 4 semantics via the sensor side's caps.
      { ...BOARD, headers: [{ edge: 'left', pins: [
        { label: '5V', type: 'vcc' }, { label: 'GND', type: 'gnd' }, { label: '3V3', type: 'vcc' },
        { label: 'GP4', type: 'gpio', gpio: 4 }, { label: 'GP5', type: 'gpio', gpio: 5 }
      ] }, { edge: 'right', pins: [{ label: 'GND', type: 'gnd' }, { label: '3V3', type: 'vcc' }] }] },
      defs
    )
    const sda = nl.edges.find((e) => e.id === 'sda')
    expect(sda!.bus).toMatchObject({ kind: 'i2c' })
    const pwr = nl.edges.find((e) => e.id === 'pwr')
    expect(pwr!.bus).toBeUndefined()
  })
})

describe('buildNetlist — robustness', () => {
  it('surfaces a wire to a missing part / bad pin as dangling (never crashes)', () => {
    const nl = buildNetlist(
      robot([
        wire('ghost', ep('board', 'GP0', 3), ep('nope', 'X', 0)), // no such part
        wire('oob', ep('board', 'GP1', 4), ep('board', 'ZZ', 99)) // pad index out of range
      ]),
      BOARD,
      new Map()
    )
    expect(nl.dangling).toEqual(expect.arrayContaining([ep('nope', 'X', 0), ep('board', 'ZZ', 99)]))
    // The good endpoints still resolved; the bad wires were skipped, not fatal.
    expect(nl.nodeOf[ep('board', 'GP0', 3)]).toBeDefined()
    expect(nl.edges.some((e) => e.id === 'ghost')).toBe(false)
  })

  it('handles no board (web/simulator with parts only) without throwing', () => {
    const defs = new Map<string, PartDefinition>([['led', LED]])
    const nl = buildNetlist(robot([wire('w', ep('led', 'A', 0), ep('led', 'K', 1))]), null, defs)
    expect(nl.nodeOf[ep('led', 'A', 0)]).toBe(nl.nodeOf[ep('led', 'K', 1)])
    // board.* endpoints can't resolve with no board → dangling.
    const nl2 = buildNetlist(robot([wire('w', ep('board', 'GP0', 3), ep('led', 'A', 0))]), null, defs)
    expect(nl2.dangling).toContain(ep('board', 'GP0', 3))
  })

  it('is deterministic — node ids are stable across identical runs', () => {
    const defs = new Map<string, PartDefinition>([['r', RESISTOR]])
    const build = (): Netlist =>
      buildNetlist(robot([wire('w', ep('board', 'GP0', 3), ep('r', '1', 0))]), BOARD, defs)
    expect(build().nodeOf).toEqual(build().nodeOf)
  })
})

describe('remapConnectionsForBoard (MCU swap)', () => {
  // A different board layout: GP0 sits at a NEW index, GP1 is absent, and there is
  // only one GND / 3V3. Flattened: 0=GND 1=3V3 2=GP0 3=5V.
  const BOARD2: BoardDefinition = {
    id: 'testmcu2',
    name: 'Test MCU 2',
    mcu: 'RP2040',
    pcbColor: '#0f5a2e',
    aspect: 0.6,
    headers: [
      {
        edge: 'left',
        pins: [
          { label: 'GND', type: 'gnd' },
          { label: '3V3', type: 'vcc' },
          { label: 'GP0', type: 'gpio', gpio: 0 },
          { label: '5V', type: 'vcc' }
        ]
      }
    ]
  }

  it('moves a GPIO wire to the SAME gpio on the new board (different index)', () => {
    const r = remapConnectionsForBoard([wire('w', ep('board', 'GP0', 3), ep('led', 'A', 0))], BOARD, BOARD2)
    expect(r.removed).toEqual([])
    expect(r.connections[0].from).toBe('board.GP0#2') // GP0 moved from index 3 → 2
    expect(r.connections[0].to).toBe('led.A#0') // part endpoint untouched
  })

  it('matches power by rail and ground to any ground pad', () => {
    const r = remapConnectionsForBoard(
      [
        wire('p', ep('board', '3V3', 2), ep('sensor', 'VIN', 0)),
        wire('g', ep('board', 'GND', 5), ep('sensor', 'GND', 1)), // old 2nd GND (index 5)
        wire('v', ep('board', '5V', 0), ep('sensor', 'VIN', 0))
      ],
      BOARD,
      BOARD2
    )
    expect(r.removed).toEqual([])
    expect(r.connections.map((c) => c.from)).toEqual(['board.3V3#1', 'board.GND#0', 'board.5V#3'])
  })

  it('drops a wire whose GPIO is not on the new board, with a reason', () => {
    const r = remapConnectionsForBoard([wire('w', ep('board', 'GP1', 4), ep('led', 'A', 0))], BOARD, BOARD2)
    expect(r.connections).toEqual([])
    expect(r.removed).toHaveLength(1)
    expect(r.removed[0].reasons).toContain('GPIO 1')
  })

  it('leaves part-to-part wires untouched', () => {
    const w = wire('rr', ep('r', '1', 0), ep('r', '2', 1))
    const r = remapConnectionsForBoard([w], BOARD, BOARD2)
    expect(r.connections).toEqual([w])
    expect(r.removed).toEqual([])
  })

  it('keeps net / colour + recomputes the id from the new endpoints', () => {
    const w: RobotConnection = { id: 'x', from: ep('board', 'GP0', 3), to: ep('led', 'A', 0), net: 'signal', color: '#abc' }
    const r = remapConnectionsForBoard([w], BOARD, BOARD2)
    // id follows the new endpoints (`${from}__${to}`) so a later redraw won't dupe.
    expect(r.connections[0]).toEqual({ id: 'board.GP0#2__led.A#0', from: 'board.GP0#2', to: 'led.A#0', net: 'signal', color: '#abc' })
  })

  it('drops a self-loop when a board-to-board wire collapses onto one pad', () => {
    // Both endpoints are GND; the new board has one GND, so from === to.
    const r = remapConnectionsForBoard([wire('gg', ep('board', 'GND', 1), ep('board', 'GND', 5))], BOARD, BOARD2)
    expect(r.connections).toEqual([])
  })

  it('de-duplicates wires that collapse to the same endpoint pair', () => {
    const r = remapConnectionsForBoard(
      [
        wire('a', ep('led', 'K', 1), ep('board', 'GND', 1)), // → led.K#1 ↔ board.GND#0
        wire('b', ep('led', 'K', 1), ep('board', 'GND', 5)) // → led.K#1 ↔ board.GND#0 (same pair)
      ],
      BOARD,
      BOARD2
    )
    expect(r.connections).toHaveLength(1)
    expect(r.connections[0].from).toBe('led.K#1')
    expect(r.connections[0].to).toBe('board.GND#0')
  })

  it('matches near-equivalent power rail labels (3.3V ≡ 3V3)', () => {
    const B3: BoardDefinition = { ...BOARD2, id: 'b3', headers: [{ edge: 'left', pins: [{ label: '3.3V', type: 'vcc' }] }] }
    const r = remapConnectionsForBoard([wire('p', ep('board', '3V3', 2), ep('sensor', 'VIN', 0))], BOARD, B3)
    expect(r.removed).toEqual([])
    expect(r.connections[0].from).toBe('board.3.3V#0')
  })
})
