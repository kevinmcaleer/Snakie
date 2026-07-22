/**
 * CIRCUIT PROBE helpers (Circuit Sim #604) — the pure, testable core the visible
 * physics is built on: reading the DC solver's {@link SolverState} at a node / pad,
 * formatting a meter readout, colouring a node by its voltage, and estimating the
 * current on a wire. Kept dependency-light so the multimeter, clamp, and the
 * node-voltage / current-flow overlays all share one verified source of truth.
 */
import type { Netlist } from './netlist'
import type { SolverState } from './dc-solver'

/** Format a voltage for a meter readout: `3.30 V`, `850 mV`, `−1.20 V`, `0 V`. */
export function formatVoltage(v: number): string {
  if (!Number.isFinite(v)) return '— V'
  const a = Math.abs(v)
  if (a < 5e-4) return '0 V'
  if (a < 1) return `${Math.round(v * 1000)} mV`
  return `${v.toFixed(2)} V`
}

/** Format a current for a clamp readout: `1.20 A`, `12.5 mA`, `450 µA`, `0 A`. Uses
 *  the magnitude for the unit; a caller shows direction separately. */
export function formatCurrent(i: number): string {
  if (!Number.isFinite(i)) return '— A'
  const a = Math.abs(i)
  if (a < 5e-7) return '0 A'
  if (a < 1e-3) return `${Math.round(a * 1e6)} µA`
  if (a < 1) return `${(a * 1e3).toFixed(1)} mA`
  return `${a.toFixed(2)} A`
}

/** Map each netlist node id → its solved voltage (empty when the solve degraded). */
export function nodeVoltages(netlist: Netlist, state: SolverState): Map<string, number> {
  const m = new Map<string, number>()
  if (!state.ok) return m
  netlist.nodes.forEach((node, i) => m.set(node.id, state.nodeVoltages[i] ?? 0))
  return m
}

/** The solved voltage at a wiring endpoint (its pad), via the node it belongs to, or
 *  `null` when the endpoint isn't in the netlist / the solve degraded. */
export function endpointVoltage(netlist: Netlist, state: SolverState, endpoint: string): number | null {
  if (!state.ok) return null
  const nodeId = netlist.nodeOf[endpoint]
  if (!nodeId) return null
  const i = netlist.nodes.findIndex((n) => n.id === nodeId)
  return i >= 0 ? state.nodeVoltages[i] ?? null : null
}

/** A node voltage → colour on a blue(0V / ground) → red(≥ ref) scale, for the node-
 *  voltage overlay. `refV` is the circuit's headline supply (so a 3.3V rail and a
 *  12V rail both read full-scale). Negative rails deepen toward violet. */
export function voltageColour(v: number, refV = 5): string {
  const ref = Math.max(1e-3, Math.abs(refV))
  const t = Math.max(-0.2, Math.min(1, v / ref)) // −0.2..1 of the ref
  // Hue sweeps 210° (blue, ground) → 0° (red, full rail); below ground → violet.
  const hue = t < 0 ? 260 : 210 - 210 * t
  const light = 42 + 16 * Math.max(0, t) // brighter as it climbs
  return `hsl(${Math.round(hue)}, 82%, ${Math.round(light)}%)`
}

/**
 * Estimate the current magnitude + direction on a wire from the solver's per-element
 * branch currents. A wire joins two endpoints into one electrical node, so it has no
 * current of its own — but a wire that is a part's SOLE connection to a node carries
 * that part's whole branch current (the common series-circuit case). We attribute
 * the wire the branch current of the element terminating at either of its endpoints;
 * ambiguous rail taps fall back to 0 (shown as no flow) rather than a wrong number.
 *
 * `endpointElement` maps a wiring endpoint → the element id whose terminal sits there
 * (built by the caller from the parts' terminal pins). Returns signed amps: positive
 * = conventional current flowing from `from` toward `to`.
 */
export function wireCurrent(
  from: string,
  to: string,
  branchCurrents: Record<string, number>,
  endpointElement: Map<string, { id: string; terminal: 'a' | 'b' }>
): number {
  // Prefer an element that terminates on exactly one of the two endpoints.
  for (const [ep, sign] of [
    [from, 1],
    [to, -1]
  ] as const) {
    const hit = endpointElement.get(ep)
    if (!hit) continue
    const i = branchCurrents[hit.id]
    if (i === undefined) continue
    // Branch current is defined a→b; the endpoint at the element's `a` terminal
    // carries current OUT of the element into the wire.
    const dir = hit.terminal === 'a' ? 1 : -1
    return sign * dir * i
  }
  return 0
}
