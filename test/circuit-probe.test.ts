import { describe, it, expect } from 'vitest'
import {
  formatVoltage,
  formatCurrent,
  nodeVoltages,
  endpointVoltage,
  voltageColour,
  wireCurrent
} from '../src/shared/circuit-probe'
import type { Netlist, NetlistNode, NetlistTerminal, TerminalRole } from '../src/shared/netlist'
import type { SolverState } from '../src/shared/dc-solver'

const term = (key: string, name: string, role: TerminalRole, index = 0): NetlistTerminal => ({
  endpoint: `${key}.${name}#${index}`,
  key,
  index,
  name,
  role
})
const node = (id: string, kind: NetlistNode['kind'], ...terminals: NetlistTerminal[]): NetlistNode => ({ id, kind, terminals })
const netlist = (nodes: NetlistNode[], nodeOf: Record<string, string> = {}): Netlist => ({ nodes, edges: [], nodeOf, dangling: [] })
const solved = (nodeVoltages: number[]): SolverState => ({ ok: true, nodeVoltages, branchCurrents: {} })

describe('formatVoltage', () => {
  it('picks V / mV by magnitude and keeps sign', () => {
    expect(formatVoltage(3.3)).toBe('3.30 V')
    expect(formatVoltage(0.85)).toBe('850 mV')
    expect(formatVoltage(-1.2)).toBe('-1.20 V')
    expect(formatVoltage(0)).toBe('0 V')
    expect(formatVoltage(0.0001)).toBe('0 V')
    expect(formatVoltage(NaN)).toBe('— V')
  })
})

describe('formatCurrent', () => {
  it('picks A / mA / µA by magnitude', () => {
    expect(formatCurrent(1.2)).toBe('1.20 A')
    expect(formatCurrent(0.0125)).toBe('12.5 mA')
    expect(formatCurrent(0.00045)).toBe('450 µA')
    expect(formatCurrent(-0.05)).toBe('50.0 mA') // magnitude only
    expect(formatCurrent(0)).toBe('0 A')
  })
})

describe('voltageColour', () => {
  it('maps ground → blue and the rail → red', () => {
    expect(voltageColour(0, 5)).toBe('hsl(210, 82%, 42%)')
    expect(voltageColour(5, 5)).toBe('hsl(0, 82%, 58%)')
  })
  it('scales to the reference supply', () => {
    // Half of a 3.3V rail → mid hue (~105°).
    expect(voltageColour(1.65, 3.3)).toBe('hsl(105, 82%, 50%)')
  })
})

describe('nodeVoltages / endpointVoltage', () => {
  const nl = netlist(
    [node('N0', 'ground', term('board', 'GND', 'gnd')), node('N1', 'power', term('bat', '+', 'pwr'))],
    { 'board.GND#0': 'N0', 'bat.+#0': 'N1' }
  )

  it('maps node id → voltage', () => {
    const m = nodeVoltages(nl, solved([0, 5]))
    expect(m.get('N0')).toBe(0)
    expect(m.get('N1')).toBe(5)
  })

  it('reads the voltage at a wiring endpoint', () => {
    expect(endpointVoltage(nl, solved([0, 5]), 'bat.+#0')).toBe(5)
    expect(endpointVoltage(nl, solved([0, 5]), 'board.GND#0')).toBe(0)
  })

  it('returns null for an unknown endpoint or a degraded solve', () => {
    expect(endpointVoltage(nl, solved([0, 5]), 'nope.X#0')).toBeNull()
    const degraded: SolverState = { ok: false, reason: 'no-ground', nodeVoltages: [0, 0], branchCurrents: {} }
    expect(endpointVoltage(nl, degraded, 'bat.+#0')).toBeNull()
    expect(nodeVoltages(nl, degraded).size).toBe(0)
  })
})

describe('wireCurrent', () => {
  it('attributes a leaf wire the branch current of the element it terminates', () => {
    // Wire from the resistor's `a` terminal to the rail; R1 carries 5mA a→b.
    const endpointElement = new Map<string, { id: string; terminal: 'a' | 'b' }>([
      ['r1.a#0', { id: 'r1', terminal: 'a' }]
    ])
    const branchCurrents = { r1: 0.005 }
    // from = the element's `a` endpoint → current flows OUT of the element into the wire.
    expect(wireCurrent('r1.a#0', 'rail.x#0', branchCurrents, endpointElement)).toBeCloseTo(0.005, 9)
    // Reversed wire direction flips the sign.
    expect(wireCurrent('rail.x#0', 'r1.a#0', branchCurrents, endpointElement)).toBeCloseTo(-0.005, 9)
  })

  it('is 0 when neither endpoint terminates a known element', () => {
    expect(wireCurrent('a.x#0', 'b.y#0', { r1: 0.005 }, new Map())).toBe(0)
  })
})
