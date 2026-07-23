/**
 * ELECTRICAL RULES CHECK (epic #597 Circuit Sim, issue #601).
 * =============================================================================
 * Static, pre-code, lint-style checks over the {@link Netlist} (#600). It catches
 * the wiring mistakes that kill a Pico — a dead short, two supplies bridged, an
 * LED with no current-limiting resistor, an I²C bus with no pull-ups — WITHOUT a
 * solver: every rule here is decidable from the topology + the parts' `electrical`
 * metadata alone. That's the whole point of shipping ERC before the DC solver
 * (#603): it delivers standalone value first.
 *
 * PURE + DOM-free (mirrors {@link ./board-pin-check}), so it unit-tests directly;
 * the badge + issues panel (#601 UI) just render what this returns. Every issue
 * carries a plain-English `message` AND a `why` explainer — an ERC that only says
 * "floating input" teaches nothing; one that says why it matters teaches.
 *
 * Rules are deliberately CONSERVATIVE: a false positive erodes trust faster than a
 * missed warning, so a rule only fires when the topology makes it unambiguous.
 */
import type { Netlist, NetlistNode, NetlistTerminal } from './netlist'
import type { ElectricalModel, PartDefinition } from './part'

/** Severity, worst-first: an `error` will damage hardware or can't work; a
 *  `warning` is likely wrong / risky; `info` is advisory best-practice. */
export type ErcSeverity = 'error' | 'warning' | 'info'

/** One electrical-rules finding. */
export interface ErcIssue {
  /** Stable rule id (e.g. `vcc-gnd-short`) — for de-dup, tests, "mute this rule". */
  rule: string
  severity: ErcSeverity
  /** Short headline (e.g. `VCC shorted to GND`). */
  title: string
  /** The specific, plain-English finding for THIS circuit. */
  message: string
  /** Why it matters — the teaching sentence shown under the message. */
  why: string
  /** Netlist node ids this issue implicates (for board highlighting). */
  nodes?: string[]
  /** Placed-part instance ids this issue implicates. */
  parts?: string[]
}

/** Order issues worst-first for the panel. */
const SEVERITY_RANK: Record<ErcSeverity, number> = { error: 0, warning: 1, info: 2 }

/** The electrical model of a terminal's part (`undefined` for board pads / passive). */
function modelOf(t: NetlistTerminal, partDefs: Map<string, PartDefinition>): ElectricalModel | undefined {
  if (t.key === 'board') return undefined
  return partDefs.get(t.key)?.electrical?.model
}

/** Does this node carry a terminal of the given electrical model? */
function nodeHasModel(node: NetlistNode, model: ElectricalModel, partDefs: Map<string, PartDefinition>): boolean {
  return node.terminals.some((t) => modelOf(t, partDefs) === model)
}

/** A friendly name for a placed part (its label/name if we can find it, else id). */
function partName(id: string, partDefs: Map<string, PartDefinition>): string {
  const def = partDefs.get(id)
  return def?.name || id
}

/** Nominal voltage of a KNOWN, fixed supply-rail label. Generic supply names
 *  (`VCC` / `VDD` / `V+` / `VIN` / `VSYS` / `VBAT` / `PWR` / `+`) are deliberately
 *  ABSENT — they're wildcards: a battery's `V+`, a sensor's `VCC` and a `5V` label
 *  are the SAME supply, not a short. Only labels that pin a specific voltage go here. */
const RAIL_VOLTS: Record<string, number> = {
  '1V8': 1.8,
  '1.8V': 1.8,
  '2V5': 2.5,
  '2.5V': 2.5,
  '3V3': 3.3,
  '3.3V': 3.3,
  '5V': 5,
  '5.0V': 5,
  VBUS: 5,
  '9V': 9,
  '12V': 12
}
/** The fixed voltage a rail label pins, or `undefined` for a generic/variable rail. */
function railVoltage(rail: string): number | undefined {
  return RAIL_VOLTS[rail.toUpperCase()]
}

// --- individual rules --------------------------------------------------------

/** Rule: a node that ties a power terminal directly to a ground terminal is a
 *  dead short across the supply. */
function checkShorts(netlist: Netlist): ErcIssue[] {
  const out: ErcIssue[] = []
  for (const node of netlist.nodes) {
    const hasPwr = node.terminals.some((t) => t.role === 'pwr')
    const hasGnd = node.terminals.some((t) => t.role === 'gnd')
    if (hasPwr && hasGnd) {
      const rail = node.terminals.find((t) => t.role === 'pwr')?.rail ?? 'a supply'
      out.push({
        rule: 'vcc-gnd-short',
        severity: 'error',
        title: 'Power shorted to ground',
        message: `${rail} is wired directly to GND (node ${node.id}).`,
        why: 'A supply tied straight to ground is a dead short — it browns out the board, and on real hardware the wire or the regulator gets hot enough to damage something.',
        nodes: [node.id]
      })
    }
  }
  return out
}

/** Rule: a node that bridges two DIFFERENT power rails (e.g. 5V wired to 3V3)
 *  shorts two supplies together. */
function checkRailConflicts(netlist: Netlist): ErcIssue[] {
  const out: ErcIssue[] = []
  for (const node of netlist.nodes) {
    const rails = [
      ...new Set(node.terminals.filter((t) => t.role === 'pwr').map((t) => t.rail).filter(Boolean) as string[])
    ]
    // A REAL conflict is two rails at KNOWN, DIFFERENT voltages (e.g. 3V3 ↔ 5V).
    // Generic supply labels (V+/VCC/VDD/VIN…) are wildcards — a battery's `V+`, a
    // device's `VCC` and a `5V` label are one supply, so bridging them is correct,
    // not a short. (A false positive erodes trust more than a missed warning — see
    // the file header; the old rule flagged every distinct LABEL and cried wolf.)
    const known = rails
      .map((rail) => ({ rail, v: railVoltage(rail) }))
      .filter((x): x is { rail: string; v: number } => x.v !== undefined)
    const distinctV = new Set(known.map((k) => k.v))
    if (distinctV.size > 1) {
      const list = known.map((k) => k.rail).join(' and ')
      const volts = [...distinctV].sort((a, b) => a - b).map((v) => `${v}V`).join(' vs ')
      out.push({
        rule: 'rail-conflict',
        severity: 'error',
        title: 'Different power rails shorted together',
        message: `${list} are wired to the same node (${node.id}) — ${volts}.`,
        why: 'These rails sit at different fixed voltages. Bridging them forces current from the higher into the lower — it can back-feed a regulator or exceed a device’s voltage rating. (A generic V+/VCC pin sharing a 5V or 3V3 rail is fine — that’s the same supply.)',
        nodes: [node.id]
      })
    }
  }
  return out
}

/** Rule: an LED with no current-limiting resistor sharing one of its nodes. A
 *  series resistor MUST share exactly one node with the LED, so "no resistor on
 *  either node" means nothing is limiting the current. */
function checkLedResistors(netlist: Netlist, partDefs: Map<string, PartDefinition>): ErcIssue[] {
  const out: ErcIssue[] = []
  // Group nodes by the LED instances that touch them.
  const ledInstances = new Set<string>()
  for (const node of netlist.nodes) {
    for (const t of node.terminals) if (modelOf(t, partDefs) === 'led') ledInstances.add(t.key)
  }
  for (const led of ledInstances) {
    // The nodes this LED's terminals belong to.
    const ledNodes = netlist.nodes.filter((n) => n.terminals.some((t) => t.key === led))
    const hasSeriesResistor = ledNodes.some((n) => nodeHasModel(n, 'resistor', partDefs))
    if (!hasSeriesResistor) {
      out.push({
        rule: 'led-no-resistor',
        severity: 'warning',
        title: 'LED has no current-limiting resistor',
        message: `${partName(led, partDefs)} is wired without a series resistor.`,
        why: 'An LED is a diode — with nothing to limit the current it draws far more than its rated ~20 mA, which burns out the LED and can overload the GPIO driving it. Add a resistor (~220–330 Ω at 3.3 V) in series.',
        parts: [led],
        nodes: ledNodes.map((n) => n.id)
      })
    }
  }
  return out
}

/** Rule: an I²C bus with no pull-up resistors to a supply. Advisory (`info`),
 *  because most breakout boards include their own pull-ups — but a bare bus needs
 *  them. Fires when an i2c bus edge exists and neither bus line shares a node with
 *  a resistor that also reaches a power rail. */
function checkI2cPullups(netlist: Netlist, partDefs: Map<string, PartDefinition>): ErcIssue[] {
  const busEdges = netlist.edges.filter((e) => e.bus?.kind === 'i2c')
  if (busEdges.length === 0) return []
  // The nodes carrying the i2c bus lines (SDA/SCL endpoints).
  const busNodeIds = new Set<string>()
  for (const e of busEdges) {
    const a = netlist.nodeOf[e.from]
    const b = netlist.nodeOf[e.to]
    if (a) busNodeIds.add(a)
    if (b) busNodeIds.add(b)
  }
  const busNodes = netlist.nodes.filter((n) => busNodeIds.has(n.id))
  // A pull-up = a resistor sharing a bus node AND (its other leg) a power node.
  const powerNodeIds = new Set(netlist.nodes.filter((n) => n.kind === 'power').map((n) => n.id))
  const resistorInstancesOnBus = new Set<string>()
  for (const n of busNodes) {
    for (const t of n.terminals) if (modelOf(t, partDefs) === 'resistor') resistorInstancesOnBus.add(t.key)
  }
  const hasPullup = [...resistorInstancesOnBus].some((r) => {
    const rNodes = netlist.nodes.filter((n) => n.terminals.some((t) => t.key === r))
    return rNodes.some((n) => powerNodeIds.has(n.id)) && rNodes.some((n) => busNodeIds.has(n.id))
  })
  if (hasPullup) return []
  const bus = busEdges[0].bus?.label ?? 'I2C'
  return [
    {
      rule: 'i2c-no-pullups',
      severity: 'info',
      title: `${bus} bus may have no pull-up resistors`,
      message: `No pull-up resistors were found on the ${bus} bus lines.`,
      why: 'I²C lines are open-drain: without pull-ups to the supply (~4.7 kΩ to 3V3) the bus can’t reach a valid high and may read garbage. Most breakout boards include pull-ups — if yours doesn’t, add them.',
      nodes: [...busNodeIds]
    }
  ]
}

// --- the checker -------------------------------------------------------------

/**
 * Run every electrical rule over a netlist. Pure: no DOM, no IO, no solver.
 * Returns the issues worst-severity first, then by rule for a stable order.
 *
 * @param netlist   the extracted netlist (#600)
 * @param partDefs  placed-part instance id → its {@link PartDefinition} (for the
 *                  parts' `electrical` metadata — same map `buildNetlist` took)
 */
export function runErc(netlist: Netlist, partDefs: Map<string, PartDefinition>): ErcIssue[] {
  const issues = [
    ...checkShorts(netlist),
    ...checkRailConflicts(netlist),
    ...checkLedResistors(netlist, partDefs),
    ...checkI2cPullups(netlist, partDefs)
  ]
  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.rule.localeCompare(b.rule))
}

/** Roll issues up into a badge summary (counts per severity + the worst present). */
export interface ErcSummary {
  total: number
  errors: number
  warnings: number
  infos: number
  worst: ErcSeverity | null
}

/** Summarise issues for the board-view badge. */
export function ercSummary(issues: ErcIssue[]): ErcSummary {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const infos = issues.filter((i) => i.severity === 'info').length
  const worst: ErcSeverity | null = errors ? 'error' : warnings ? 'warning' : infos ? 'info' : null
  return { total: issues.length, errors, warnings, infos, worst }
}
