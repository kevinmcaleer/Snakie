import type { JSX } from 'react'
import type { PartDefinition, PartEdge, PartPin } from '../../../shared/part'

/**
 * PART SCHEMATIC SYMBOL (#130)
 * ============================
 *
 * A simple line-drawing schematic symbol of a {@link PartDefinition}: a labelled
 * box with pin terminals projecting from its four sides — the schematic-view
 * counterpart to the breadboard {@link PartCanvas}. The Part Editor's recommended
 * authoring flow starts here ("define the pins") before moving to the breadboard
 * view, and the schematic ⇄ breadboard toggle flips between the two.
 *
 * Terminals are placed from the part's `schematic` pin→side mapping when present;
 * otherwise they're derived from the headers (a header on the `left` edge maps
 * its pins to the symbol's left side, and so on) so a part drawn in the
 * breadboard view gets a sensible schematic for free.
 *
 * Pure presentational SVG — no state, no IPC.
 */

const VIEW_W = 460
const VIEW_H = 420
const STUB = 26 // terminal stub length

interface Terminal {
  pin: PartPin
  side: PartEdge
  order: number
}

/** Resolve the terminals: explicit `schematic` mapping, else derived from headers. */
export function schematicTerminals(part: PartDefinition): Terminal[] {
  const byName = new Map<string, PartPin>()
  for (const h of part.headers ?? []) for (const p of h.pins) if (!byName.has(p.name)) byName.set(p.name, p)

  if (part.schematic?.pins?.length) {
    const out: Terminal[] = []
    for (const sp of part.schematic.pins) {
      const pin = byName.get(sp.pin)
      if (pin) out.push({ pin, side: sp.side, order: sp.order })
    }
    return out.sort((a, b) => a.order - b.order)
  }

  // Derive from headers: edge → symbol side, preserving order along the edge.
  const out: Terminal[] = []
  for (const h of part.headers ?? []) {
    h.pins.forEach((pin, i) => out.push({ pin, side: h.edge, order: i }))
  }
  return out
}

export interface PartSchematicViewProps {
  part: PartDefinition
  highlightPin?: string
}

export function PartSchematicView({ part, highlightPin }: PartSchematicViewProps): JSX.Element {
  const terminals = schematicTerminals(part)
  const bySide: Record<PartEdge, Terminal[]> = { left: [], right: [], top: [], bottom: [] }
  for (const t of terminals) bySide[t.side].push(t)
  for (const side of Object.keys(bySide) as PartEdge[]) {
    bySide[side].sort((a, b) => a.order - b.order)
  }

  // Size the symbol box so each side fits its terminals comfortably.
  const vRows = Math.max(bySide.left.length, bySide.right.length, 1)
  const hCols = Math.max(bySide.top.length, bySide.bottom.length, 1)
  const boxW = Math.min(300, Math.max(140, hCols * 46 + 60))
  const boxH = Math.min(300, Math.max(120, vRows * 30 + 40))
  const boxX = (VIEW_W - boxW) / 2
  const boxY = (VIEW_H - boxH) / 2

  /** Evenly spaced positions for `n` terminals between `a` and `b`. */
  const slots = (n: number, a: number, b: number): number[] => {
    if (n <= 0) return []
    if (n === 1) return [(a + b) / 2]
    return Array.from({ length: n }, (_, i) => a + ((i + 1) * (b - a)) / (n + 1))
  }

  const lY = slots(bySide.left.length, boxY, boxY + boxH)
  const rY = slots(bySide.right.length, boxY, boxY + boxH)
  const tX = slots(bySide.top.length, boxX, boxX + boxW)
  const bX = slots(bySide.bottom.length, boxX, boxX + boxW)

  const term = (t: Terminal, x1: number, y1: number, x2: number, y2: number, side: PartEdge): JSX.Element => {
    const hi = highlightPin && t.pin.name === highlightPin
    const labelX = side === 'left' ? x1 + 6 : side === 'right' ? x1 - 6 : x1
    const labelY = side === 'top' ? y1 + 14 : side === 'bottom' ? y1 - 8 : y1 - 4
    const anchor = side === 'left' ? 'start' : side === 'right' ? 'end' : 'middle'
    return (
      <g key={`${side}-${t.pin.name}-${t.order}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hi ? '#fff' : 'var(--sc-line, #cfd6dd)'} strokeWidth={hi ? 2.5 : 1.6} />
        <circle cx={x2} cy={y2} r={3} fill={hi ? '#fff' : 'var(--sc-line, #cfd6dd)'} />
        <text x={labelX} y={labelY} className="sc__pin-label" textAnchor={anchor}>
          {t.pin.name}
          {t.pin.number != null ? ` (${t.pin.number})` : ''}
        </text>
      </g>
    )
  }

  return (
    <svg
      className="sc__svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`Schematic symbol of ${part.name}`}
    >
      {/* Symbol body. */}
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={6}
        fill="var(--sc-fill, #11161a)"
        stroke="var(--sc-line, #cfd6dd)"
        strokeWidth={2}
      />
      <text x={VIEW_W / 2} y={boxY + boxH / 2} className="sc__title">
        {part.name}
      </text>
      {part.manufacturer && (
        <text x={VIEW_W / 2} y={boxY + boxH / 2 + 20} className="sc__sub">
          {part.manufacturer}
        </text>
      )}

      {bySide.left.map((t, i) => term(t, boxX, lY[i], boxX - STUB, lY[i], 'left'))}
      {bySide.right.map((t, i) => term(t, boxX + boxW, rY[i], boxX + boxW + STUB, rY[i], 'right'))}
      {bySide.top.map((t, i) => term(t, tX[i], boxY, tX[i], boxY - STUB, 'top'))}
      {bySide.bottom.map((t, i) => term(t, bX[i], boxY + boxH, bX[i], boxY + boxH + STUB, 'bottom'))}
    </svg>
  )
}
