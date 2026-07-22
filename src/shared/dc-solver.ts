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
import type { ElectricalModel } from './part'

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
  /** Supply voltage (volts) — `source` (a battery nominal or a PSU's live set-point). */
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
  const m = vsources.length
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
    for (const el of elements) {
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
        stampI(el.a, el.b, Math.max(0, el.currentDrawA ?? 0))
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
  for (const el of elements) {
    const va = vAt(el.a)
    const vb = vAt(el.b)
    switch (el.model) {
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
        branchCurrents[el.id] = Math.max(0, el.currentDrawA ?? 0)
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
