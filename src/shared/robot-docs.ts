/**
 * Generated project documentation from the Robot Definition File (#127 epic —
 * #142 Bill of Materials, #143 pinouts table).
 *
 * Pure + dependency-free (no DOM / Electron) so it is unit-testable and can run
 * in any process. The Board Viewer turns a project's `robot.yml` into two
 * portable **Markdown** artifacts a beginner can paste into a README:
 *
 *  - a **Bill of Materials** — the microcontroller + every placed part, grouped
 *    by type with a quantity and the metadata authored in each `parts.yml`.
 *  - a **pinouts table** — every wired connection, MCU-pin-first where the wire
 *    touches the board, plus any part↔part wires.
 *
 * Part metadata is resolved through a caller-supplied {@link PartResolver} so this
 * module stays decoupled from how libraries are stored.
 */
import type { RobotDefinition } from './robot'
import type { PartDefinition } from './part'

/** Resolve a placed part's library definition (for its name/manufacturer/etc.). */
export type PartResolver = (lib: string, part: string) => PartDefinition | null

/** One aggregated Bill-of-Materials line (a part TYPE, with a quantity). */
export interface BomRow {
  qty: number
  name: string
  description: string
  manufacturer: string
  family: string
  partNumber: string
}

/** One pinout row for a wire that touches the microcontroller. */
export interface PinoutRow {
  mcuPin: string
  part: string
  partPin: string
  net: string
}

/** One row for a wire between two parts (neither endpoint is the board). */
export interface OtherWireRow {
  from: string
  to: string
  net: string
}

const DASH = '—'

/** Strip the internal `#index` disambiguator: `"dist1.SDA#3"` → `"dist1.SDA"`. */
function stripIndex(ep: string): string {
  const hash = ep.lastIndexOf('#')
  return hash >= 0 ? ep.slice(0, hash) : ep
}

/** Split an endpoint into its subject key + pin name (`"dist1.SDA#3"`). The key
 *  is everything before the FIRST dot (`board` or a part id); the pin is the
 *  rest (pin names themselves never contain a dot in practice, but joining the
 *  remainder is safe if they did). */
export function parseEndpoint(ep: string): { key: string; pin: string } {
  const clean = stripIndex(ep)
  const dot = clean.indexOf('.')
  if (dot < 0) return { key: clean, pin: '' }
  return { key: clean.slice(0, dot), pin: clean.slice(dot + 1) }
}

/** Human label for a placed part id: its instance label, else the library part
 *  name, else the raw part id. `"board"` resolves to the MCU name when given. */
function partLabel(robot: RobotDefinition, resolve: PartResolver, key: string, mcuName?: string): string {
  if (key === 'board') return mcuName || 'Board'
  const rp = robot.parts.find((p) => p.id === key)
  if (!rp) return key
  return rp.label || resolve(rp.lib, rp.part)?.name || rp.part
}

/** Uppercase net label for a connection (defaults to SIGNAL). */
function netLabel(net: string | undefined): string {
  return (net ?? 'signal').toUpperCase()
}

/** `"<label>.<pin>"`, or just the label when the pin is empty (malformed wire). */
function endpointLabel(label: string, pin: string): string {
  return pin ? `${label}.${pin}` : label
}

/**
 * Aggregate the project's parts into Bill-of-Materials rows: the microcontroller
 * first (when supplied), then every placed part grouped by `lib/part` with a
 * quantity, sorted by name. Metadata comes from each part's library definition.
 */
export function buildBomRows(
  robot: RobotDefinition,
  resolve: PartResolver,
  opts: { mcu?: PartDefinition | null; mcuName?: string } = {}
): BomRow[] {
  const rows: BomRow[] = []

  // The microcontroller is the headline component — list it first.
  if (opts.mcu || opts.mcuName) {
    const m = opts.mcu
    rows.push({
      qty: 1,
      name: m?.name || opts.mcuName || 'Microcontroller',
      description: m?.description ?? '',
      manufacturer: m?.manufacturer ?? '',
      family: m?.family ?? 'Microcontroller',
      partNumber: m?.partNumber ?? ''
    })
  }

  // Group placed parts by their (lib, part) type, counting instances.
  const groups = new Map<string, { count: number; def: PartDefinition | null; part: string }>()
  for (const rp of robot.parts) {
    const key = `${rp.lib}/${rp.part}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { count: 1, def: resolve(rp.lib, rp.part), part: rp.part })
  }

  const partRows = [...groups.values()].map(({ count, def, part }) => ({
    qty: count,
    name: def?.name || part,
    description: def?.description ?? '',
    manufacturer: def?.manufacturer ?? '',
    family: def?.family ?? '',
    partNumber: def?.partNumber ?? ''
  }))
  partRows.sort((a, b) => a.name.localeCompare(b.name))
  rows.push(...partRows)
  return rows
}

/**
 * Build the pinout rows: connections that touch the board become MCU-pin-first
 * rows (sorted by pin); all other wires (part↔part) are returned separately.
 */
export function buildPinoutRows(
  robot: RobotDefinition,
  resolve: PartResolver,
  opts: { mcuName?: string } = {}
): { mcu: PinoutRow[]; other: OtherWireRow[] } {
  const mcu: PinoutRow[] = []
  const other: OtherWireRow[] = []

  for (const c of robot.connections) {
    const a = parseEndpoint(c.from)
    const b = parseEndpoint(c.to)
    const net = netLabel(c.net)
    if (a.key === 'board' || b.key === 'board') {
      const board = a.key === 'board' ? a : b
      const part = a.key === 'board' ? b : a
      mcu.push({
        mcuPin: board.pin || board.key,
        part: partLabel(robot, resolve, part.key, opts.mcuName),
        partPin: part.pin,
        net
      })
    } else {
      other.push({
        from: endpointLabel(partLabel(robot, resolve, a.key, opts.mcuName), a.pin),
        to: endpointLabel(partLabel(robot, resolve, b.key, opts.mcuName), b.pin),
        net
      })
    }
  }

  // GPIO pins (GP2, 14, …) first sorted by number, then named pins (3V3, GND, …)
  // alphabetically — so power/ground rails don't interleave with the GPIOs.
  mcu.sort((x, y) => {
    const kx = pinSortKey(x.mcuPin)
    const ky = pinSortKey(y.mcuPin)
    if (kx.group !== ky.group) return kx.group - ky.group
    if (kx.group === 0) return kx.num - ky.num
    return x.mcuPin.localeCompare(y.mcuPin)
  })
  return { mcu, other }
}

/** Sort key for a board pin: group 0 = a numbered GPIO (`GP14`, `GPIO2`, `IO34`,
 *  or a bare `14`) sorted by its number; group 1 = any other named pin (`3V3`,
 *  `GND`, `A0`) sorted by text. */
function pinSortKey(pin: string): { group: 0 | 1; num: number } {
  const m = pin.match(/^(?:gpio|gp|io)?(\d+)$/i)
  return m ? { group: 0, num: Number(m[1]) } : { group: 1, num: 0 }
}

/** Escape a value for a Markdown table cell (pipes + newlines), `—` when empty. */
function cell(value: string | number): string {
  const s = String(value).trim()
  if (!s) return DASH
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** Render a Markdown table from a header + rows (each row already a string[]). */
function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')
  return body ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`
}

/** Project title prefix for a doc heading (the project name, else "Project"). */
function title(robot: RobotDefinition): string {
  return robot.name?.trim() || 'Project'
}

/** The Bill of Materials as a Markdown document (#142). */
export function bomMarkdown(
  robot: RobotDefinition,
  resolve: PartResolver,
  opts: { mcu?: PartDefinition | null; mcuName?: string } = {}
): string {
  const rows = buildBomRows(robot, resolve, opts)
  const table = mdTable(
    ['Qty', 'Part', 'Description', 'Manufacturer', 'Family', 'Part #'],
    rows.map((r) => [String(r.qty), r.name, r.description, r.manufacturer, r.family, r.partNumber])
  )
  const lines = [`# ${title(robot)} — Bill of Materials`, '']
  if (rows.length === 0) lines.push('_No parts in this project yet._')
  else lines.push(table)
  return `${lines.join('\n')}\n`
}

/** The pinouts table as a Markdown document (#143). */
export function pinoutMarkdown(
  robot: RobotDefinition,
  resolve: PartResolver,
  opts: { mcuName?: string } = {}
): string {
  const { mcu, other } = buildPinoutRows(robot, resolve, opts)
  const lines = [`# ${title(robot)} — Pinouts`, '']
  if (mcu.length === 0 && other.length === 0) {
    lines.push('_No connections in this project yet._')
    return `${lines.join('\n')}\n`
  }
  if (mcu.length > 0) {
    lines.push(
      mdTable(
        ['MCU Pin', 'Part', 'Part Pin', 'Net'],
        mcu.map((r) => [r.mcuPin, r.part, r.partPin, r.net])
      )
    )
  }
  if (other.length > 0) {
    if (mcu.length > 0) lines.push('', '## Other connections', '')
    lines.push(
      mdTable(
        ['From', 'To', 'Net'],
        other.map((r) => [r.from, r.to, r.net])
      )
    )
  }
  return `${lines.join('\n')}\n`
}
