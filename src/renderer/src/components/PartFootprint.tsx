import type { JSX } from 'react'
import type { PartDefinition, PartPin, PartPinType } from '../../../shared/part'

/**
 * PART FOOTPRINT (#130)
 * =====================
 *
 * A top-down "footprint" drawing of a {@link PartDefinition}: the physical board
 * outline (polygon or rounded rect), the pin pads laid along their edges
 * (castellated vs regular, coloured by electrical role, numbered + named),
 * mounting holes (rings) and buttons. This is the engineering counterpart to the
 * Board View's life-like, full-colour representation — the Part Editor shows both
 * (#130 "Show both the footprint and a life-like representation"), and the Parts
 * panel reuses it as the part-detail thumbnail.
 *
 * Pure presentational SVG — no state, no IPC. Coordinates are derived entirely
 * from the part, so the same component renders identically in the editor preview,
 * the panel and (potentially) an exported asset.
 */

const VIEW_W = 420
const VIEW_H = 420
const MAX_W = 240
const MAX_H = 300

/** Pad fill by electrical role (kept close to the Board View's palette). */
const PAD_FILL: Record<PartPinType, string> = {
  io: '#d6a531',
  pwr: '#c0392b',
  gnd: '#3a3f44',
  other: '#8a8f96'
}

export interface PartFootprintProps {
  part: PartDefinition
  /** Draw the 2.54mm (or part pinSpacing) snap grid behind the board. */
  showGrid?: boolean
  /** Highlight a pin by name (the editor uses this for the selected pin). */
  highlightPin?: string
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Fit a board of the given aspect (w/h) centred within the SVG mat. */
function fitBox(aspect: number): Box {
  let w = MAX_W
  let h = w / aspect
  if (h > MAX_H) {
    h = MAX_H
    w = h * aspect
  }
  return { x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h }
}

/** Map a normalised 0..1 point into the board box. */
function pt(box: Box, nx: number, ny: number): [number, number] {
  return [box.x + nx * box.w, box.y + ny * box.h]
}

/** Even fractional positions for `n` pins along an edge (inset from the ends). */
function spread(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0.5]
  const inset = 0.5 / n
  return Array.from({ length: n }, (_, i) => inset + (i * (1 - 2 * inset)) / (n - 1))
}

/** One drawn pad: centre point, edge it sits on, and the pin. */
interface DrawnPad {
  x: number
  y: number
  edge: 'left' | 'right' | 'top' | 'bottom'
  pin: PartPin
}

export function PartFootprint({
  part,
  showGrid = false,
  highlightPin
}: PartFootprintProps): JSX.Element {
  const aspect =
    typeof part.aspect === 'number' && part.aspect > 0
      ? part.aspect
      : part.dimensions && part.dimensions.height > 0
        ? part.dimensions.width / part.dimensions.height
        : 0.5
  const box = fitBox(aspect)

  // Lay each header's pins evenly along its edge, just inside the outline.
  const pads: DrawnPad[] = []
  for (const header of part.headers ?? []) {
    const fr = spread(header.pins.length)
    header.pins.forEach((pin, i) => {
      const f = fr[i]
      let x: number
      let y: number
      if (header.edge === 'left') [x, y] = pt(box, 0, f)
      else if (header.edge === 'right') [x, y] = pt(box, 1, f)
      else if (header.edge === 'top') [x, y] = pt(box, f, 0)
      else [x, y] = pt(box, f, 1)
      pads.push({ x, y, edge: header.edge, pin })
    })
  }

  // Grid dots at the physical pin pitch (falls back to a fixed grid).
  const gridDots: JSX.Element[] = []
  if (showGrid) {
    const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54
    const cols = part.dimensions ? Math.max(2, Math.round(part.dimensions.width / spacing)) : 8
    const rows = part.dimensions ? Math.max(2, Math.round(part.dimensions.height / spacing)) : 16
    const cc = Math.min(cols, 24)
    const rr = Math.min(rows, 30)
    for (let c = 1; c < cc; c++) {
      for (let r = 1; r < rr; r++) {
        const [gx, gy] = pt(box, c / cc, r / rr)
        gridDots.push(<circle key={`g${c}-${r}`} cx={gx} cy={gy} r={0.8} fill="var(--bc-grid, #ffffff22)" />)
      }
    }
  }

  return (
    <svg
      className="pf__svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`Footprint of ${part.name}`}
    >
      {/* Board outline: polygon when authored, else a rounded rect. */}
      {part.polygon && part.polygon.length >= 3 ? (
        <polygon
          points={part.polygon.map((p) => pt(box, p.x, p.y).join(',')).join(' ')}
          fill={part.pcbColor || '#0f5a2e'}
          stroke="#0008"
          strokeWidth={2}
        />
      ) : (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={8}
          fill={part.pcbColor || '#0f5a2e'}
          stroke="#0008"
          strokeWidth={2}
        />
      )}

      {showGrid && <g aria-hidden="true">{gridDots}</g>}

      {/* Decorative features (chips/cans), drawn faintly so pins stay legible. */}
      {(part.features ?? []).map((f, i) => {
        const [fx, fy] = pt(box, f.x, f.y)
        return (
          <g key={`f${i}`} opacity={0.85}>
            <rect x={fx} y={fy} width={f.w * box.w} height={f.h * box.h} rx={3} fill="#1c2227" stroke="#0006" />
            <text x={fx + (f.w * box.w) / 2} y={fy + (f.h * box.h) / 2} className="pf__feat-label">
              {f.label}
            </text>
          </g>
        )
      })}

      {/* Mounting holes — rings sized from their mm diameter relative to board. */}
      {(part.mountingHoles ?? []).map((h, i) => {
        const [hx, hy] = pt(box, h.x, h.y)
        const rPx =
          part.dimensions && part.dimensions.width > 0
            ? Math.max(3, (h.diameter / part.dimensions.width) * box.w)
            : 5
        return (
          <g key={`h${i}`}>
            <circle cx={hx} cy={hy} r={rPx} fill="var(--bc-mat, #0c0f12)" stroke="#cfd6dd" strokeWidth={2} />
            <circle cx={hx} cy={hy} r={Math.max(1.5, rPx * 0.45)} fill="#cfd6dd" />
          </g>
        )
      })}

      {/* Buttons — small squares with their label. */}
      {(part.buttons ?? []).map((b, i) => {
        const [bx, by] = pt(box, b.x, b.y)
        return (
          <g key={`b${i}`}>
            <rect x={bx - 10} y={by - 8} width={20} height={16} rx={3} fill="#cfd6dd" stroke="#0007" />
            <text x={bx} y={by + 18} className="pf__btn-label">
              {b.label}
            </text>
          </g>
        )
      })}

      {/* Pin pads. */}
      {pads.map((d, i) => {
        const fill = PAD_FILL[d.pin.type] ?? PAD_FILL.other
        const hi = highlightPin && d.pin.name === highlightPin
        const size = 11
        const labelDx = d.edge === 'left' ? -10 : d.edge === 'right' ? 10 : 0
        const labelDy = d.edge === 'top' ? -10 : d.edge === 'bottom' ? 18 : 4
        const anchor = d.edge === 'left' ? 'end' : d.edge === 'right' ? 'start' : 'middle'
        return (
          <g key={`p${i}`}>
            {d.pin.castellated ? (
              // Castellated: a half-rounded edge pad (the plated notch look).
              <rect
                x={d.x - size / 2}
                y={d.y - size / 2}
                width={size}
                height={size}
                rx={size / 2}
                fill={fill}
                stroke={hi ? '#fff' : '#0008'}
                strokeWidth={hi ? 2.5 : 1}
              />
            ) : (
              // Regular through-hole pad: square with a centre hole.
              <>
                <rect
                  x={d.x - size / 2}
                  y={d.y - size / 2}
                  width={size}
                  height={size}
                  rx={2}
                  fill={fill}
                  stroke={hi ? '#fff' : '#0008'}
                  strokeWidth={hi ? 2.5 : 1}
                />
                <circle cx={d.x} cy={d.y} r={2.2} fill="var(--bc-mat, #0c0f12)" />
              </>
            )}
            <text
              x={d.x + labelDx}
              y={d.y + labelDy}
              className="pf__pin-label"
              textAnchor={anchor}
            >
              {d.pin.number != null ? `${d.pin.number} ` : ''}
              {d.pin.label || d.pin.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
