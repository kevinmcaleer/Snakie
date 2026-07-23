/**
 * DC SOLVER (Circuit Sim #603, epic #597) — a pure, dependency-free Modified Nodal
 * Analysis (MNA) steady-state solver.
 *
 * It takes a {@link SolverCircuit} — nodes + two-terminal elements each carrying a
 * behavioural {@link ElectricalModel} — and returns the steady-state node voltages
 * and per-element branch currents. It is deliberately SMALL and dense (a breadboard
 * has a few dozen nodes), self-built (we borrow the *idea* of Falstad, never GPL
 * code), and HEADLESSLY VERIFIABLE with hand-computed known-answer circuits.
 *
 * Design choices (matching the epic's #603 spec):
 *  - **MNA** — node voltages + ideal-voltage-source branch currents as unknowns.
 *  - **Nonlinear parts are piecewise-linear** (LEDs/diodes/switches), their operating
 *    region chosen by a bounded fixed-point sweep — NO Newton iteration.
 *  - **Graceful degradation** — a floating / ungrounded / singular circuit returns
 *    `{ ok: false, reason }` with all-zero results, never NaN, so the UI can't crash.
 *
 * The mapping from a board/parts {@link import('./netlist').Netlist} to a
 * `SolverCircuit` lives in {@link buildCircuit} (below) so this file is the whole
 * electrical engine; the worker (#603) and BoardGraph wiring consume it.
 */
import type { ElectricalModel, PartElectrical } from './part'
import type { Netlist, TerminalRole } from './netlist'

/** A two-terminal element in the circuit, its terminals mapped to node indices.
 *  `a` is the positive / power / anode terminal, `b` the negative / ground / cathode. */
export interface SolverElement {
  /** Stable id (part instance key) — the returned branch current is keyed by it. */
  id: string
  model: ElectricalModel
  /** Node index of the positive terminal (anode / V+ / pin `terminals.positive`). */
  a: number
  /** Node index of the negative terminal (cathode / GND / pin `terminals.negative`). */
  b: number
  /** Forward voltage drop (volts) — `led` / `diode`. */
  vf?: number
  /** Resistance (ohms) — `resistor`, or a `source`'s internal resistance. */
  resistanceOhms?: number
  /** Supply voltage (volts) — `source` (a battery nominal or a PSU's live set-point),
   *  or a `regulator`'s regulated output voltage (`a`=input rail, `b`=output rail). */
  supplyV?: number
  /** Steady current draw (amps) — `consumer` (modelled as a current sink a→b). */
  currentDrawA?: number
  /** Whether a `switch` element is closed (conducting). Absent ⇒ open. */
  closed?: boolean
}

/** A complete circuit to solve: how many nodes, which is ground (0V reference), and
 *  the elements between them. Nodes are `0..nodeCount-1`; `ground` is one of them. */
export interface SolverCircuit {
  nodeCount: number
  /** The reference (0V) node index. */
  ground: number
  elements: SolverElement[]
}

/** Why a solve degraded (all results zero when set). */
export type SolverDegradeReason = 'empty' | 'no-ground' | 'singular' | 'floating'

/** The steady-state solution (or a graceful degrade). */
export interface SolverState {
  /** False ⇒ the circuit couldn't be solved; `reason` says why, results are zero. */
  ok: boolean
  reason?: SolverDegradeReason
  /** Voltage at each node (index-aligned to `0..nodeCount-1`); ground is exactly 0. */
  nodeVoltages: number[]
  /** Branch current through each element (amps), keyed by element id. Positive means
   *  conventional current flows from the element's `a` terminal to its `b` terminal. */
  branchCurrents: Record<string, number>
}

// A resistance floor so a "short" (closed switch, ideal wire) is a tiny resistor
// rather than a literal 0Ω that would blow up the conductance stamp.
const R_SHORT = 1e-3
// A resistance ceiling so an "open" (off diode, open switch) leaks ~nothing but
// still ties the node in (keeps the matrix non-singular where possible).
const R_OPEN = 1e12
// Default on-resistance of a conducting diode/LED (a few ohms of bulk + lead).
const R_DIODE_ON = 4
const MAX_REGION_SWEEPS = 40
// Gmin: a tiny conductance from EVERY node to ground (a SPICE staple, ~0.1nS/10GΩ).
// It guarantees the matrix is never singular — a floating / dangling node just
// settles near 0 instead of collapsing the WHOLE solve — while being negligible
// against any real component conductance, so driven voltages are unchanged.
const G_MIN = 1e-10

/** Solve a linear system `A x = z` (A is n×n, row-major) by Gaussian elimination
 *  with partial pivoting. Returns the solution vector, or `null` if A is singular
 *  (a pivot collapses to ~0 — a floating / ungrounded circuit). Pure + in-place on
 *  copies, so the caller's matrices are untouched. */
export function solveLinear(A: number[][], z: number[]): number[] | null {
  const n = z.length
  if (n === 0) return []
  // Work on copies (augmented matrix M = [A | z]).
  const M = A.map((row, i) => [...row, z[i]])
  for (let col = 0; col < n; col++) {
    // Partial pivot: pick the row with the largest magnitude in this column.
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null // singular
    if (pivot !== col) {
      const tmp = M[pivot]
      M[pivot] = M[col]
      M[col] = tmp
    }
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  // Back-substitute.
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let s = M[row][n]
    for (let c = row + 1; c < n; c++) s -= M[row][c] * x[c]
    x[row] = s / M[row][row]
  }
  return x.some((v) => !Number.isFinite(v)) ? null : x
}

/** Zero-result state for a graceful degrade. */
function degrade(nodeCount: number, reason: SolverDegradeReason): SolverState {
  return { ok: false, reason, nodeVoltages: new Array<number>(nodeCount).fill(0), branchCurrents: {} }
}

/** Effective linear resistance of an element in a chosen operating region. `on` is
 *  the diode/switch region flag from the sweep. */
function elementResistance(el: SolverElement, on: boolean): number {
  switch (el.model) {
    case 'resistor':
      return Math.max(R_SHORT, el.resistanceOhms ?? R_OPEN)
    case 'source':
      // A source's internals: its series resistance (0 ⇒ ideal, handled elsewhere).
      return Math.max(0, el.resistanceOhms ?? 0)
    case 'led':
    case 'diode':
      return on ? R_DIODE_ON : R_OPEN
    case 'switch':
      return on ? R_SHORT : R_OPEN
    default:
      return R_OPEN
  }
}

/**
 * Solve a DC circuit to steady state. Pure — no globals, no I/O.
 *
 * Elements are stamped into the MNA system:
 *  - `resistor` / `switch` / `consumer` — conductances (+ a current-source draw for
 *    `consumer`).
 *  - `source` — an ideal voltage source (MNA branch row) when its internal R is 0,
 *    else a Norton equivalent (current source ∥ conductance) so no extra node/row.
 *  - `led` / `diode` — a piecewise-linear companion (conductance ∥ an offset current
 *    source for the Vf drop) whose on/off region is resolved by a bounded sweep.
 */
export function solveDC(circuit: SolverCircuit): SolverState {
  const { nodeCount, ground, elements } = circuit
  if (nodeCount <= 0 || elements.length === 0) return degrade(Math.max(0, nodeCount), 'empty')
  if (ground < 0 || ground >= nodeCount) return degrade(nodeCount, 'no-ground')

  // Compact node indices excluding ground (MNA unknowns are non-ground nodes).
  const idx = new Array<number>(nodeCount).fill(-1)
  let n = 0
  for (let i = 0; i < nodeCount; i++) if (i !== ground) idx[i] = n++
  if (n === 0) return degrade(nodeCount, 'floating') // only a ground node, nothing to solve

  // Ideal voltage sources (internal R == 0) each add one MNA branch-current unknown.
  const vsources = elements.filter((e) => e.model === 'source' && (e.resistanceOhms ?? 0) <= 0)

  // Which nodes are POWERED — reachable from a source terminal through conducting
  // elements (a source ties both its nodes; resistors / closed switches carry on)?
  // Used two ways: a regulator only regulates when its INPUT rail is powered (no
  // manufacturing energy from a floating input), and a consumer only draws when its
  // net is powered (a current sink on a Gmin-only-tied node would otherwise blow up
  // to ±1e8 V — the "floating VCC" garbage reading).
  const powered = new Set<number>()
  const activeRegIds = new Set<string>()
  {
    const adj = new Map<number, number[]>()
    const link = (a: number, b: number): void => {
      if (!adj.has(a)) adj.set(a, [])
      if (!adj.has(b)) adj.set(b, [])
      adj.get(a)!.push(b)
      adj.get(b)!.push(a)
    }
    const seeds: number[] = []
    for (const el of elements) {
      if (el.model === 'source') {
        seeds.push(el.a, el.b)
        link(el.a, el.b)
      } else if (el.model === 'resistor') link(el.a, el.b)
      else if (el.model === 'switch' && el.closed) link(el.a, el.b)
    }
    const flood = (from: number[]): void => {
      const stack = [...from]
      while (stack.length) {
        const node = stack.pop()!
        if (powered.has(node)) continue
        powered.add(node)
        for (const nb of adj.get(node) ?? []) if (!powered.has(nb)) stack.push(nb)
      }
    }
    flood(seeds)
    // A regulated rail is powered too: activate a regulator once its INPUT rail is
    // powered, then flood its OUTPUT rail (and anything resistively hanging off it).
    // Iterate to a fixpoint so a regulator fed by another regulator's rail resolves.
    let changed = true
    while (changed) {
      changed = false
      for (const el of elements) {
        if (el.model !== 'regulator' || activeRegIds.has(el.id)) continue
        if (powered.has(el.a)) {
          activeRegIds.add(el.id)
          flood([el.b])
          changed = true
        }
      }
    }
  }
  // Active regulators each add one MNA branch-current unknown alongside the sources.
  const m = vsources.length + activeRegIds.size
  const size = n + m

  // Region state for diodes/switches: start diodes ON (optimistic), switches by
  // their `closed` flag. The sweep flips these until self-consistent.
  const region = new Map<string, boolean>()
  for (const el of elements) {
    if (el.model === 'led' || el.model === 'diode') region.set(el.id, true)
    else if (el.model === 'switch') region.set(el.id, !!el.closed)
  }

  let solution: number[] | null = null
  for (let sweep = 0; sweep < MAX_REGION_SWEEPS; sweep++) {
    const A: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
    const z = new Array<number>(size).fill(0)

    const stampG = (a: number, b: number, g: number): void => {
      const ia = idx[a]
      const ib = idx[b]
      if (ia >= 0) A[ia][ia] += g
      if (ib >= 0) A[ib][ib] += g
      if (ia >= 0 && ib >= 0) {
        A[ia][ib] -= g
        A[ib][ia] -= g
      }
    }
    // A current source of `i` amps flowing a→b: it removes current from `a` and
    // injects it into `b` (RHS is net current INTO each node).
    const stampI = (a: number, b: number, i: number): void => {
      const ia = idx[a]
      const ib = idx[b]
      if (ia >= 0) z[ia] -= i
      if (ib >= 0) z[ib] += i
    }

    let vs = 0
    let rg = 0
    for (const el of elements) {
      if (el.model === 'regulator') {
        if (!activeRegIds.has(el.id)) continue // input rail unpowered → regulator off
        // A gyrator-like stamp: branch `k` holds V(output) − V(ground) = Vout, while the
        // SAME current couples to the input rail (+Ibr into output KCL, −Ibr into input
        // KCL) — so the load current on the regulated rail is drawn back from the input.
        const k = n + vsources.length + rg++
        const io = idx[el.b] // output rail node
        const ii = idx[el.a] // input rail node
        if (io >= 0) {
          A[io][k] += 1 // branch current feeds the output node
          A[k][io] += 1 // constraint row: V(output) − V(ground) = Vout
        }
        if (ii >= 0) A[ii][k] -= 1 // ...returned from the input node
        z[k] += el.supplyV ?? 0
        continue
      }
      if (el.model === 'source') {
        const rInt = el.resistanceOhms ?? 0
        const v = el.supplyV ?? 0
        if (rInt <= 0) {
          // Ideal voltage source → MNA branch row/col `k` enforcing Va - Vb = V.
          const k = n + vs++
          const ia = idx[el.a]
          const ib = idx[el.b]
          if (ia >= 0) {
            A[ia][k] += 1
            A[k][ia] += 1
          }
          if (ib >= 0) {
            A[ib][k] -= 1
            A[k][ib] -= 1
          }
          z[k] += v
        } else {
          // Norton: current source V/R (pushing out of `a`) ∥ conductance 1/R.
          const g = 1 / rInt
          stampG(el.a, el.b, g)
          stampI(el.b, el.a, v * g) // inject into `a`, draw from `b`
        }
        continue
      }
      if (el.model === 'consumer') {
        // A fixed load: a current source drawing `currentDrawA` from a (pwr) to b (gnd).
        // Only draws when its net is actually powered — a sink on a floating rail has
        // no supply to pull from and would drag that node to ±1e8 V against Gmin.
        if (powered.has(el.a) && powered.has(el.b)) stampI(el.a, el.b, Math.max(0, el.currentDrawA ?? 0))
        continue
      }
      if (el.model === 'led' || el.model === 'diode') {
        const on = region.get(el.id) ?? true
        const r = elementResistance(el, on)
        const g = 1 / r
        stampG(el.a, el.b, g)
        // Companion offset for the Vf drop: I = g·(Va−Vb−Vf). The conductance stamps
        // g·(Va−Vb), so add g·Vf back INTO the anode (a current source b→a).
        if (on) stampI(el.b, el.a, (el.vf ?? 0) * g)
        continue
      }
      if (el.model === 'switch') {
        stampG(el.a, el.b, 1 / elementResistance(el, region.get(el.id) ?? false))
        continue
      }
      if (el.model === 'resistor') {
        stampG(el.a, el.b, 1 / elementResistance(el, true))
        continue
      }
      // 'passive' and anything else: no electrical contribution.
    }

    // Gmin: tie every node to ground so a floating/dangling node can't make the
    // system singular — it settles near 0 rather than blanking the whole solve.
    for (let i = 0; i < n; i++) A[i][i] += G_MIN

    solution = solveLinear(A, z)
    if (!solution) return degrade(nodeCount, 'singular')

    // Node voltages from this candidate solution (for the region check).
    const vAt = (node: number): number => (node === ground ? 0 : solution![idx[node]])

    // Re-evaluate diode regions: a diode ON but reverse-biased (Va-Vb < Vf) turns
    // OFF; one OFF but forward-biased (Va-Vb > Vf) turns ON. Switches are fixed.
    let changed = false
    for (const el of elements) {
      if (el.model !== 'led' && el.model !== 'diode') continue
      const across = vAt(el.a) - vAt(el.b)
      const vf = el.vf ?? 0
      const on = region.get(el.id) ?? true
      const wantOn = across > vf + 1e-9
      if (on !== wantOn) {
        region.set(el.id, wantOn)
        changed = true
      }
    }
    if (!changed) break
  }

  if (!solution) return degrade(nodeCount, 'singular')

  // Assemble node voltages (ground exactly 0).
  const nodeVoltages = new Array<number>(nodeCount).fill(0)
  for (let i = 0; i < nodeCount; i++) nodeVoltages[i] = i === ground ? 0 : solution[idx[i]]

  // Branch currents (conventional, a→b) per element.
  const branchCurrents: Record<string, number> = {}
  const vAt = (node: number): number => nodeVoltages[node]
  let vs = 0
  let rg = 0
  for (const el of elements) {
    const va = vAt(el.a)
    const vb = vAt(el.b)
    switch (el.model) {
      case 'regulator':
        // Branch current is defined input→output; negate the MNA unknown so a positive
        // value means the regulator is SUPPLYING current out of its output rail.
        branchCurrents[el.id] = activeRegIds.has(el.id) ? -solution[n + vsources.length + rg++] : 0
        break
      case 'source': {
        const rInt = el.resistanceOhms ?? 0
        if (rInt <= 0) {
          // The MNA branch current for this ideal source (unknown n+vs).
          branchCurrents[el.id] = solution[n + vs++]
        } else {
          branchCurrents[el.id] = ((el.supplyV ?? 0) - (va - vb)) / rInt
        }
        break
      }
      case 'consumer':
        branchCurrents[el.id] =
          powered.has(el.a) && powered.has(el.b) ? Math.max(0, el.currentDrawA ?? 0) : 0
        break
      case 'led':
      case 'diode': {
        const on = region.get(el.id) ?? true
        branchCurrents[el.id] = on ? (va - vb - (el.vf ?? 0)) / R_DIODE_ON : 0
        break
      }
      case 'switch':
        branchCurrents[el.id] = (region.get(el.id) ?? false) ? (va - vb) / R_SHORT : 0
        break
      case 'resistor':
        branchCurrents[el.id] = (va - vb) / Math.max(R_SHORT, el.resistanceOhms ?? R_OPEN)
        break
      default:
        branchCurrents[el.id] = 0
    }
  }

  return { ok: true, nodeVoltages, branchCurrents }
}

// --- netlist → circuit adapter -----------------------------------------------

/** A placed part with electrical behaviour, plus any live-state overrides, ready to
 *  map onto the netlist. `key` MUST match the part-instance key the netlist uses in
 *  its terminals (`"board"` for the MCU, else the placed part's instance id). */
export interface CircuitComponent {
  key: string
  /** The part's electrical model + terminal hints (from `parts.yml`). */
  electrical: PartElectrical
  /** Live supply voltage override — a bench PSU's set-point wins over the nominal. */
  supplyV?: number
  /** Live switch state — whether a `switch` element is conducting. */
  closed?: boolean
  /** Live wiper position 0..1 of a `potentiometer` (0 = wiper at −, 1 = at +).
   *  Absent ⇒ centred (0.5). */
  wiperPos?: number
}

/**
 * Build a {@link SolverCircuit} from an extracted {@link Netlist} and the electrical
 * parts on the board. Pure — the solver stays testable without the board machinery.
 *
 * Each netlist node becomes a solver node; the ground node is the first one the
 * netlist classified as `ground`. Every non-`passive` component becomes a two-
 * terminal element whose `+`/`−` map to the nodes its terminal pins sit on —
 * resolved by `electrical.terminals` (pin names) or, absent that, the part's
 * `pwr` / `gnd` pin roles (per the schema). A component that isn't wired in, or
 * whose two terminals can't be resolved to distinct nodes, is skipped (it has no
 * electrical effect until wired).
 */
export function buildCircuit(netlist: Netlist, components: CircuitComponent[]): SolverCircuit {
  const nodeCount = netlist.nodes.length

  // Per-instance terminals with the node index they resolve to.
  const byKey = new Map<string, { name: string; role: TerminalRole; node: number }[]>()
  netlist.nodes.forEach((node, i) => {
    for (const t of node.terminals) {
      const list = byKey.get(t.key)
      if (list) list.push({ name: t.name, role: t.role, node: i })
      else byKey.set(t.key, [{ name: t.name, role: t.role, node: i }])
    }
  })

  // Ground = the ground-classified node with the MOST terminals — i.e. the main
  // ground RAIL that sources/loads actually return to. Picking merely the *first*
  // ground node grabbed isolated GND pins (an unconnected part's ground), which
  // left the real ground floating symmetrically about it via Gmin (the tell-tale
  // "ground reads −V/2, rail reads +V/2"). -1 ⇒ no ground ⇒ degrade ('no-ground').
  let ground = -1
  let groundTerms = 0
  netlist.nodes.forEach((n, i) => {
    if (n.kind === 'ground' && n.terminals.length > groundTerms) {
      groundTerms = n.terminals.length
      ground = i
    }
  })

  const elements: SolverElement[] = []
  for (const comp of components) {
    const el = comp.electrical
    if (!el || el.model === 'passive') continue
    const terms = byKey.get(comp.key)
    if (!terms) continue // this part isn't wired into any node yet

    const resolve = (byName: string | undefined, byRole: TerminalRole): number | undefined => {
      if (byName) {
        const m = terms.find((t) => t.name === byName)
        if (m) return m.node
      }
      return terms.find((t) => t.role === byRole)?.node
    }
    // A potentiometer is a 3-terminal divider — expand it into TWO resistors either
    // side of the wiper tap (VCC↔wiper = R·(1−t), wiper↔GND = R·t), so the wiper
    // reads VCC·t. Interactive: `wiperPos` re-solves as it's dragged.
    if (el.model === 'potentiometer') {
      const vcc = resolve(el.terminals?.positive, 'pwr')
      const gnd = resolve(el.terminals?.negative, 'gnd')
      const wiper = el.wiper
        ? terms.find((t) => t.name === el.wiper)?.node
        : terms.find((t) => t.role === 'io')?.node
      if (
        vcc !== undefined &&
        gnd !== undefined &&
        wiper !== undefined &&
        vcc !== gnd &&
        wiper !== vcc &&
        wiper !== gnd
      ) {
        const R = Math.max(1, el.resistanceOhms ?? 10000)
        const t = Math.max(0, Math.min(1, comp.wiperPos ?? 0.5))
        elements.push({ id: `${comp.key}#top`, model: 'resistor', a: vcc, b: wiper, resistanceOhms: Math.max(1, R * (1 - t)) })
        elements.push({ id: `${comp.key}#bot`, model: 'resistor', a: wiper, b: gnd, resistanceOhms: Math.max(1, R * t) })
      }
      continue
    }

    // A regulator (on-board LDO/buck) bridges two RAILS: it holds its output rail at
    // `outputV` (vs ground) while pulling the load current back from its input rail —
    // so e.g. a board's 3V3 pins actually source current, drawn from VBUS. Rails are
    // resolved by the netlist's rail label (all like-named power pads = one node).
    if (el.model === 'regulator') {
      const railNode = (rail: string | undefined): number | undefined => {
        if (!rail) return undefined
        const R = rail.toUpperCase()
        const i = netlist.nodes.findIndex(
          (nd) => (nd.rail ?? '').toUpperCase() === R && nd.terminals.some((t) => t.key === comp.key)
        )
        return i >= 0 ? i : undefined
      }
      const input = railNode(el.inputRail)
      const output = railNode(el.outputRail)
      if (input !== undefined && output !== undefined && input !== output && el.outputV !== undefined) {
        elements.push({ id: `${comp.key}#reg`, model: 'regulator', a: input, b: output, supplyV: el.outputV })
      }
      continue
    }

    const a = resolve(el.terminals?.positive, 'pwr')
    const b = resolve(el.terminals?.negative, 'gnd')
    if (a === undefined || b === undefined || a === b) continue

    elements.push({
      id: comp.key,
      model: el.model,
      a,
      b,
      vf: el.vf,
      resistanceOhms: el.resistanceOhms,
      supplyV: comp.supplyV ?? el.supplyV,
      currentDrawA: el.currentDrawA,
      closed: comp.closed
    })
  }

  return { nodeCount, ground, elements }
}
