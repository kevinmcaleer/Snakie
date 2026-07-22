import { describe, it, expect } from 'vitest'
import { solveDC, solveLinear, buildCircuit, type SolverCircuit, type CircuitComponent } from '../src/shared/dc-solver'
import type { Netlist, NetlistNode, NetlistTerminal, TerminalRole } from '../src/shared/netlist'

// Minimal netlist fixtures (only the fields the adapter reads).
const term = (key: string, name: string, role: TerminalRole, index = 0): NetlistTerminal => ({
  endpoint: `${key}.${name}#${index}`,
  key,
  index,
  name,
  role
})
const node = (id: string, kind: NetlistNode['kind'], ...terminals: NetlistTerminal[]): NetlistNode => ({ id, kind, terminals })
const netlist = (...nodes: NetlistNode[]): Netlist => ({ nodes, edges: [], nodeOf: {}, dangling: [] })

/**
 * DC solver (#603) — known-answer circuits, hand-computed. Every expectation is a
 * value you can verify with Ohm's law / a divider on paper, so the MNA engine is
 * pinned to real physics, not to itself.
 *
 * Node convention in these fixtures: node 0 is GROUND; node 1 is the top rail.
 */

describe('solveLinear (Gaussian elimination)', () => {
  it('solves a 2×2 system', () => {
    // 2x + y = 5 ; x + 3y = 10 → x = 1, y = 3
    const x = solveLinear([[2, 1], [1, 3]], [5, 10])
    expect(x).not.toBeNull()
    expect(x![0]).toBeCloseTo(1, 9)
    expect(x![1]).toBeCloseTo(3, 9)
  })
  it('returns null for a singular matrix', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })
  it('handles the empty system', () => {
    expect(solveLinear([], [])).toEqual([])
  })
})

describe('solveDC — resistive circuits', () => {
  it('a single resistor across a 5V source draws V/R', () => {
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'R1', model: 'resistor', a: 1, b: 0, resistanceOhms: 1000 }
      ]
    }
    const r = solveDC(c)
    expect(r.ok).toBe(true)
    expect(r.nodeVoltages[1]).toBeCloseTo(5, 9)
    expect(r.nodeVoltages[0]).toBe(0)
    expect(r.branchCurrents.R1).toBeCloseTo(0.005, 9) // 5V / 1kΩ = 5mA
  })

  it('a two-resistor divider halves the voltage', () => {
    const c: SolverCircuit = {
      nodeCount: 3,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'R1', model: 'resistor', a: 1, b: 2, resistanceOhms: 1000 },
        { id: 'R2', model: 'resistor', a: 2, b: 0, resistanceOhms: 1000 }
      ]
    }
    const r = solveDC(c)
    expect(r.ok).toBe(true)
    expect(r.nodeVoltages[2]).toBeCloseTo(2.5, 6) // 6 digits: Gmin perturbs a divided node by ~1e-7 (physically nil)
    expect(r.branchCurrents.R1).toBeCloseTo(0.0025, 6) // 2.5mA through the series pair
    expect(r.branchCurrents.R2).toBeCloseTo(0.0025, 6)
  })

  it('parallel resistors each draw independently', () => {
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'Ra', model: 'resistor', a: 1, b: 0, resistanceOhms: 1000 },
        { id: 'Rb', model: 'resistor', a: 1, b: 0, resistanceOhms: 1000 }
      ]
    }
    const r = solveDC(c)
    expect(r.branchCurrents.Ra).toBeCloseTo(0.005, 9)
    expect(r.branchCurrents.Rb).toBeCloseTo(0.005, 9)
  })

  it('a source with internal resistance drops under load (Norton path)', () => {
    // 5V, 10Ω internal, into a 90Ω load → 50mA, terminal 4.5V.
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5, resistanceOhms: 10 },
        { id: 'Rload', model: 'resistor', a: 1, b: 0, resistanceOhms: 90 }
      ]
    }
    const r = solveDC(c)
    expect(r.nodeVoltages[1]).toBeCloseTo(4.5, 6)
    expect(r.branchCurrents.Rload).toBeCloseTo(0.05, 6)
    expect(r.branchCurrents.V1).toBeCloseTo(0.05, 6) // (5 − 4.5)/10
  })
})

describe('solveDC — piecewise-linear LEDs / diodes', () => {
  it('a forward LED drops Vf and passes (5−Vf)/R', () => {
    // 5V → 1kΩ → LED(Vf=2) → GND. I ≈ (5−2)/(1000+Ron) ≈ 2.99mA.
    const c: SolverCircuit = {
      nodeCount: 3,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'R1', model: 'resistor', a: 1, b: 2, resistanceOhms: 1000 },
        { id: 'LED', model: 'led', a: 2, b: 0, vf: 2 }
      ]
    }
    const r = solveDC(c)
    expect(r.ok).toBe(true)
    expect(r.branchCurrents.LED).toBeGreaterThan(0.0029)
    expect(r.branchCurrents.LED).toBeLessThan(0.0030)
    expect(r.nodeVoltages[2]).toBeGreaterThan(2) // just above Vf
    expect(r.nodeVoltages[2]).toBeLessThan(2.05)
  })

  it('a reverse-biased LED blocks (≈0 current)', () => {
    // LED anode at GND, cathode at +5 → reverse → off.
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'LED', model: 'led', a: 0, b: 1, vf: 2 }
      ]
    }
    const r = solveDC(c)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.branchCurrents.LED)).toBeLessThan(1e-6)
  })

  it('a diode below its Vf does not conduct', () => {
    // 1.5V source, diode Vf 2.0 → stays off.
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 1.5 },
        { id: 'D1', model: 'diode', a: 1, b: 0, vf: 2 }
      ]
    }
    const r = solveDC(c)
    expect(Math.abs(r.branchCurrents.D1)).toBeLessThan(1e-6)
  })
})

describe('solveDC — switches, consumers', () => {
  it('a closed switch conducts; an open one does not', () => {
    const build = (closed: boolean): SolverCircuit => ({
      nodeCount: 3,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'SW', model: 'switch', a: 1, b: 2, closed },
        { id: 'R1', model: 'resistor', a: 2, b: 0, resistanceOhms: 1000 }
      ]
    })
    const on = solveDC(build(true))
    expect(on.nodeVoltages[2]).toBeCloseTo(5, 3)
    expect(on.branchCurrents.R1).toBeCloseTo(0.005, 4)
    const off = solveDC(build(false))
    expect(off.nodeVoltages[2]).toBeCloseTo(0, 3)
    expect(Math.abs(off.branchCurrents.R1)).toBeLessThan(1e-6)
  })

  it('a consumer draws its rated current from an ideal rail', () => {
    const c: SolverCircuit = {
      nodeCount: 2,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'Servo', model: 'consumer', a: 1, b: 0, currentDrawA: 0.1 }
      ]
    }
    const r = solveDC(c)
    expect(r.nodeVoltages[1]).toBeCloseTo(5, 9) // ideal rail holds
    expect(r.branchCurrents.Servo).toBeCloseTo(0.1, 9)
  })
})

describe('solveDC — graceful degradation (never NaN)', () => {
  it('no elements ⇒ empty', () => {
    const r = solveDC({ nodeCount: 2, ground: 0, elements: [] })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
    expect(r.nodeVoltages.every((v) => v === 0)).toBe(true)
  })

  it('an out-of-range ground ⇒ no-ground', () => {
    const r = solveDC({ nodeCount: 2, ground: 5, elements: [{ id: 'R', model: 'resistor', a: 0, b: 1, resistanceOhms: 100 }] })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no-ground')
  })

  it('a floating sub-circuit no longer blanks the whole solve (Gmin robustness)', () => {
    // Source + resistor float between nodes 1 and 2; ground (0) is unconnected. Gmin
    // ties both nodes weakly to ground, so it SOLVES (finite) instead of degrading —
    // the point of Gmin: a dangling node must not blank the overlay for the whole board.
    const r = solveDC({
      nodeCount: 3,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 2, supplyV: 5 },
        { id: 'R1', model: 'resistor', a: 1, b: 2, resistanceOhms: 1000 }
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.nodeVoltages.every((v) => Number.isFinite(v))).toBe(true)
    expect(r.nodeVoltages[1] - r.nodeVoltages[2]).toBeCloseTo(5, 3) // the source constraint still holds
  })

  it('an isolated node settles to 0 without disturbing a driven rail (Gmin)', () => {
    // node 1 is a driven 5V rail; node 2 has NO element on it → only Gmin ties it,
    // so it settles to ~0 while the rail stays exactly 5V and nothing goes singular.
    const r = solveDC({
      nodeCount: 3,
      ground: 0,
      elements: [
        { id: 'V1', model: 'source', a: 1, b: 0, supplyV: 5 },
        { id: 'R1', model: 'resistor', a: 1, b: 0, resistanceOhms: 1000 }
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.nodeVoltages[1]).toBeCloseTo(5, 6) // driven rail unchanged
    expect(r.nodeVoltages[2]).toBeCloseTo(0, 6) // isolated node → ground
  })
})

describe('buildCircuit — netlist → SolverCircuit (adapter)', () => {
  it('maps a battery → resistor → LED and solves end-to-end (terminals by name)', () => {
    // N0 ground: board GND + battery − + LED cathode. N1 rail: battery + + R1.a.
    // N2: R1.b + LED anode.
    const nl = netlist(
      node('N0', 'ground', term('board', 'GND', 'gnd'), term('bat', '-', 'gnd'), term('led1', 'K', 'other')),
      node('N1', 'power', term('bat', '+', 'pwr'), term('r1', 'a', 'other')),
      node('N2', 'signal', term('r1', 'b', 'other'), term('led1', 'A', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'bat', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } },
      { key: 'r1', electrical: { model: 'resistor', resistanceOhms: 1000, terminals: { positive: 'a', negative: 'b' } } },
      { key: 'led1', electrical: { model: 'led', vf: 2, terminals: { positive: 'A', negative: 'K' } } }
    ]
    const circuit = buildCircuit(nl, comps)
    expect(circuit.nodeCount).toBe(3)
    expect(circuit.ground).toBe(0) // N0 is the ground-classified node
    expect(circuit.elements.map((e) => e.id).sort()).toEqual(['bat', 'led1', 'r1'])

    const r = solveDC(circuit)
    expect(r.ok).toBe(true)
    expect(r.branchCurrents.led1).toBeGreaterThan(0.0029)
    expect(r.branchCurrents.led1).toBeLessThan(0.003)
  })

  it('infers ± terminals from pwr/gnd roles when no terminals field is given', () => {
    const nl = netlist(
      node('N0', 'ground', term('bat', 'GND', 'gnd'), term('r', 'n', 'other')),
      node('N1', 'power', term('bat', 'VCC', 'pwr'), term('r', 'p', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'bat', electrical: { model: 'source', supplyV: 5 } }, // no terminals → role inference
      { key: 'r', electrical: { model: 'resistor', resistanceOhms: 1000, terminals: { positive: 'p', negative: 'n' } } }
    ]
    const r = solveDC(buildCircuit(nl, comps))
    expect(r.ok).toBe(true)
    expect(r.branchCurrents.r).toBeCloseTo(0.005, 6)
  })

  it("a bench-PSU supplyV override wins over the part's nominal", () => {
    const nl = netlist(
      node('N0', 'ground', term('psu', '-', 'gnd'), term('r', 'n', 'other')),
      node('N1', 'power', term('psu', '+', 'pwr'), term('r', 'p', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'psu', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } }, supplyV: 3.3 },
      { key: 'r', electrical: { model: 'resistor', resistanceOhms: 330, terminals: { positive: 'p', negative: 'n' } } }
    ]
    const r = solveDC(buildCircuit(nl, comps))
    expect(r.nodeVoltages[1]).toBeCloseTo(3.3, 6) // the live 3.3V, not the 5V nominal
    expect(r.branchCurrents.r).toBeCloseTo(0.01, 6) // 3.3V / 330Ω
  })

  it('a potentiometer divides the rail by its wiper position', () => {
    const nl = netlist(
      node('N0', 'ground', term('bat', '-', 'gnd'), term('pot', 'GND', 'gnd')),
      node('N1', 'power', term('bat', '+', 'pwr'), term('pot', 'VCC', 'pwr')),
      node('N2', 'signal', term('pot', 'OUT', 'io'))
    )
    const comps = (t: number): CircuitComponent[] => [
      { key: 'bat', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } },
      {
        key: 'pot',
        electrical: { model: 'potentiometer', resistanceOhms: 10000, wiper: 'OUT', terminals: { positive: 'VCC', negative: 'GND' } },
        wiperPos: t
      }
    ]
    // The pot expands into two resistors → the wiper (N2) reads 5V·t.
    expect(solveDC(buildCircuit(nl, comps(0.5))).nodeVoltages[2]).toBeCloseTo(2.5, 4)
    expect(solveDC(buildCircuit(nl, comps(0.2))).nodeVoltages[2]).toBeCloseTo(1.0, 4)
    expect(solveDC(buildCircuit(nl, comps(0.9))).nodeVoltages[2]).toBeCloseTo(4.5, 3)
  })

  it('a regulator drops the input rail to its output rail and sources the load current', () => {
    // PSU 5V → VBUS; an on-board regulator holds 3V3 at 3.3V; a 100Ω load hangs off
    // 3V3 → GND. The load pulls 33mA, which the regulator draws back from VBUS — so
    // the PSU (on VBUS) delivers that same 33mA. This is the "current flows from 3V3"
    // behaviour: without the regulator, 3V3 has no source and can't drive anything.
    const nl = netlist(
      { ...node('N0', 'ground', term('psu', '-', 'gnd'), term('board', 'GND', 'gnd'), term('load', 'b', 'gnd')), rail: 'GND' },
      { ...node('N1', 'power', term('psu', '+', 'pwr'), term('board', 'VBUS', 'pwr')), rail: 'VBUS' },
      { ...node('N2', 'power', term('board', '3V3', 'pwr'), term('load', 'a', 'pwr')), rail: '3V3' }
    )
    const comps: CircuitComponent[] = [
      { key: 'psu', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } },
      { key: 'board', electrical: { model: 'regulator', inputRail: 'VBUS', outputRail: '3V3', outputV: 3.3 } },
      { key: 'load', electrical: { model: 'resistor', resistanceOhms: 100, terminals: { positive: 'a', negative: 'b' } } }
    ]
    const circuit = buildCircuit(nl, comps)
    expect(circuit.elements.map((e) => e.id)).toContain('board#reg')
    const r = solveDC(circuit)
    expect(r.nodeVoltages[1]).toBeCloseTo(5, 6) // VBUS held by the PSU
    expect(r.nodeVoltages[2]).toBeCloseTo(3.3, 6) // 3V3 regulated
    expect(r.branchCurrents['board#reg']).toBeCloseTo(0.033, 4) // supplying 33mA out of 3V3
    expect(Math.abs(r.branchCurrents['psu'])).toBeCloseTo(0.033, 4) // ...drawn back from VBUS
  })

  it('a regulator stays off when its input rail is unpowered (no free energy)', () => {
    // Same board + 3V3 load, but NO source on VBUS. The regulator must not manufacture
    // 3.3V from a floating input — 3V3 settles to ~0 and the regulator carries no current.
    const nl = netlist(
      { ...node('N0', 'ground', term('board', 'GND', 'gnd'), term('load', 'b', 'gnd')), rail: 'GND' },
      { ...node('N1', 'power', term('board', 'VBUS', 'pwr')), rail: 'VBUS' },
      { ...node('N2', 'power', term('board', '3V3', 'pwr'), term('load', 'a', 'pwr')), rail: '3V3' }
    )
    const comps: CircuitComponent[] = [
      { key: 'board', electrical: { model: 'regulator', inputRail: 'VBUS', outputRail: '3V3', outputV: 3.3 } },
      { key: 'load', electrical: { model: 'resistor', resistanceOhms: 100, terminals: { positive: 'a', negative: 'b' } } }
    ]
    const r = solveDC(buildCircuit(nl, comps))
    expect(r.nodeVoltages[2]).toBeCloseTo(0, 6) // 3V3 dead — regulator gated off
    expect(r.branchCurrents['board#reg']).toBe(0)
  })

  it('skips passive parts, unwired parts, and self-shorted terminals', () => {
    const nl = netlist(
      node('N0', 'ground', term('bat', '-', 'gnd')),
      node('N1', 'power', term('bat', '+', 'pwr'), term('short', 'a', 'other'), term('short', 'b', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'bat', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } },
      { key: 'deco', electrical: { model: 'passive' } }, // passive → skipped
      { key: 'ghost', electrical: { model: 'resistor', resistanceOhms: 100, terminals: { positive: 'x', negative: 'y' } } }, // not in netlist → skipped
      { key: 'short', electrical: { model: 'resistor', resistanceOhms: 100, terminals: { positive: 'a', negative: 'b' } } } // both on N1 → skipped
    ]
    const circuit = buildCircuit(nl, comps)
    expect(circuit.elements.map((e) => e.id)).toEqual(['bat'])
  })

  it('anchors ground on the MAIN rail, not an isolated GND pin (no symmetric float)', () => {
    // N0 is an isolated ground pin (first); N1 is the real ground rail the source
    // returns to. Anchoring N0 would float the circuit symmetrically (ground −2.5,
    // rail +2.5); anchoring the busy rail keeps ground at 0 and the rail at the full 5V.
    const nl = netlist(
      node('N0', 'ground', term('sensor', 'GND', 'gnd')),
      node('N1', 'ground', term('psu', '-', 'gnd'), term('board', 'GND', 'gnd'), term('r', 'n', 'other')),
      node('N2', 'power', term('psu', '+', 'pwr'), term('r', 'p', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'psu', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } },
      { key: 'r', electrical: { model: 'resistor', resistanceOhms: 1000, terminals: { positive: 'p', negative: 'n' } } }
    ]
    const circuit = buildCircuit(nl, comps)
    expect(circuit.ground).toBe(1) // the busy rail, not the isolated pin N0
    const r = solveDC(circuit)
    expect(r.nodeVoltages[1]).toBeCloseTo(0, 6) // main ground = 0V
    expect(r.nodeVoltages[2]).toBeCloseTo(5, 4) // rail = full 5V (NOT a floated 2.5)
    expect(Math.abs(r.nodeVoltages[0])).toBeLessThan(0.01) // isolated pin ≈ 0, not −2.5
  })

  it('a netlist with no ground node ⇒ ground -1 ⇒ solver degrades, not NaN', () => {
    const nl = netlist(
      node('N0', 'power', term('bat', '+', 'pwr')),
      node('N1', 'signal', term('bat', '-', 'gnd'), term('r', 'p', 'other'), term('r2', 'n', 'other'))
    )
    const comps: CircuitComponent[] = [
      { key: 'bat', electrical: { model: 'source', supplyV: 5, terminals: { positive: '+', negative: '-' } } }
    ]
    const circuit = buildCircuit(nl, comps)
    expect(circuit.ground).toBe(-1)
    const r = solveDC(circuit)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no-ground')
  })
})
