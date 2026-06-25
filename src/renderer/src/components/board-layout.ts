/**
 * SHARED BOARD-PINOUT LAYOUT (pure geometry for the Board Views)
 * =============================================================
 *
 * The pure layout math that turns a {@link BoardDefinition} into drawable pad
 * coordinates: the board outline rect (sized from `aspect`), one
 * {@link PadPoint} per pad of every {@link BoardHeader} laid evenly along its
 * edge, the onboard-LED dot position, and the token→pad resolver that maps a
 * parsed `Pin(...)` token to its physical pad.
 *
 * Extracted from {@link ./BoardView} so the node-graph {@link ./BoardGraph} can
 * draw the SAME full, physical pinout (every pad at its real edge position) and
 * wire each connection to its real pad — instead of synthesising left-edge pads
 * from the connection list. Both views import these helpers so the two boards
 * stay identical in shape.
 *
 * Kept React/DOM-free so it can be unit-tested in a plain node environment
 * (mirrors `parse-pins`, `board-viewport`, etc.).
 */

import type { BoardDefinition, BoardHeader, BoardPad } from './board-defs'

/** The drawn board outline rect (in the caller's SVG coordinate space). */
export interface BoardBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Geometry the {@link boardBox} fitter needs: the centre to position the board
 * around and the maximum footprint it may occupy. Each view supplies its own
 * (BoardView centres on its 760×480 mat; BoardGraph on its node-graph stage).
 */
export interface BoardBoxGeom {
  /** Centre X the board is positioned around. */
  cx: number
  /** Centre Y the board is positioned around. */
  cy: number
  /** Maximum outline width (the board never exceeds this). */
  maxW: number
  /** Maximum outline height (the board never exceeds this). */
  maxH: number
}

/**
 * Fit the board into `geom` from its aspect ratio (w/h), centred. The board is
 * scaled up to `maxW`, then shrunk if that would exceed `maxH`, so it always
 * fits the given footprint while preserving its real proportions.
 */
export function boardBox(aspect: number, geom: BoardBoxGeom): BoardBox {
  let w = geom.maxW
  let h = w / aspect
  if (h > geom.maxH) {
    h = geom.maxH
    w = h * aspect
  }
  return { x: geom.cx - w / 2, y: geom.cy - h / 2, w, h }
}

/** A resolved pad with its drawn coordinate + the edge it sits on. */
export interface PadPoint {
  x: number
  y: number
  edge: BoardHeader['edge'] | 'led'
  pad: BoardPad
}

/**
 * Compute every pad's drawn coordinate for a board (so they can be drawn +
 * matched). Pads are spread evenly along their header's edge, inset from the
 * corners, in header/array order. Empty headers are skipped.
 */
export function layoutPads(def: BoardDefinition, box: BoardBox): PadPoint[] {
  const points: PadPoint[] = []
  for (const header of def.headers) {
    const n = header.pins.length
    if (n === 0) continue
    header.pins.forEach((pad, i) => {
      // Spread pads evenly along the edge, inset from the corners.
      const t = n === 1 ? 0.5 : i / (n - 1)
      if (header.edge === 'left' || header.edge === 'right') {
        const y = box.y + 18 + t * (box.h - 36)
        const x = header.edge === 'left' ? box.x + 12 : box.x + box.w - 12
        points.push({ x, y, edge: header.edge, pad })
      } else {
        const x = box.x + 18 + t * (box.w - 36)
        const y = header.edge === 'top' ? box.y + 12 : box.y + box.h - 12
        points.push({ x, y, edge: header.edge, pad })
      }
    })
  }
  return points
}

/** The onboard-LED dot position (top-right corner of the board). */
export function ledPoint(box: BoardBox): { x: number; y: number } {
  return { x: box.x + box.w - 26, y: box.y + 26 }
}

/** How a pad's silk label is offset + anchored relative to the pad centre. */
export interface PadLabelPlacement {
  /** Horizontal offset from the pad centre to the label anchor (px). */
  dx: number
  /** Vertical offset from the pad centre to the label baseline (px). */
  dy: number
  /** SVG text-anchor so the text reads away from the board. */
  anchor: 'start' | 'middle' | 'end'
}

/**
 * Place a pad's silk label on its OWN side, OUTSIDE the board (#109): a
 * `left`-edge pad's label sits to its LEFT (anchored at its end), a `right`-edge
 * pad's to its RIGHT (anchored at its start), and `top`/`bottom`/`led` labels
 * are centred above/below the pad. `gap` is the horizontal label inset (px).
 *
 * Pure so both Board Views (and the SVG export) share — and unit-test — the same
 * side-correct rule; the renderers add the box-relative pad coordinate.
 */
export function padLabelPlacement(
  edge: PadPoint['edge'],
  gap = 14
): PadLabelPlacement {
  switch (edge) {
    case 'left':
      return { dx: -gap, dy: 4, anchor: 'end' }
    case 'right':
      return { dx: gap, dy: 4, anchor: 'start' }
    case 'top':
      return { dx: 0, dy: -12, anchor: 'middle' }
    default:
      // bottom / led: centred below the pad.
      return { dx: 0, dy: 18, anchor: 'middle' }
  }
}

/**
 * Which column a connection's node card docks in for the node-graph Board View
 * (#148): a pad on the board's RIGHT or BOTTOM edge docks on the RIGHT (mirrors
 * BoardView's badge `docksLeft` rule), everything else (left / top / led) on the
 * LEFT. Pure so the live node-graph and its SVG export share one rule.
 */
export function nodeSide(edge: PadPoint['edge']): 'left' | 'right' {
  return edge === 'right' || edge === 'bottom' ? 'right' : 'left'
}

/** An axis-aligned box `{x, y, w, h}` in SVG coordinates. */
export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The bounding box around a set of pad coordinates, grown by `pad` px on every
 * side — used to draw the group outline that frames a bus's pins (#147) so a
 * `sda`/`scl` (or `sck`/`mosi`/…) set reads as one connection. Returns `null`
 * for fewer than two points (nothing to group). Pure + DOM-free for unit tests.
 */
export function padsBounds(points: { x: number; y: number }[], pad = 14): Bounds | null {
  if (points.length < 2) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

/**
 * The label for a bus connection — the type word plus its hardware bus number
 * when known: `I2C0`, `I2C1`, `SPI0`… For a non-bus type (or no `bus`) it's just
 * the uppercase type. Shared by both Board Views + the SVG export so the badge,
 * the group tag and the export all read the same.
 */
export function busLabel(type: string, bus: number | undefined): string {
  const base = type.toUpperCase()
  return bus === undefined ? base : `${base}${bus}`
}

/**
 * Resolve a parsed pin token to a drawn pad coordinate.
 * Matching: numeric token vs `pad.gpio`; else token vs `pad.label`
 * (case-insensitive, treating `GP12` and `12` as equivalent). The board's
 * `ledLabel` token taps the onboard-LED dot. Out-of-range numeric tokens fall
 * back to the nearest GPIO pad so a wire still draws.
 */
export function padForToken(
  token: string,
  def: BoardDefinition,
  pads: PadPoint[],
  box: BoardBox
): PadPoint {
  const t = token.trim()
  const lower = t.toLowerCase()

  // Onboard-LED token taps the LED dot.
  if (def.ledLabel && def.ledLabel.toLowerCase() === lower) {
    const p = ledPoint(box)
    return { x: p.x, y: p.y, edge: 'led', pad: { label: def.ledLabel } }
  }

  const isNum = /^\d+$/.test(t)
  const num = isNum ? Number(t) : NaN

  // Exact gpio match.
  if (isNum) {
    const byGpio = pads.find((p) => p.pad.gpio === num)
    if (byGpio) return byGpio
  }

  // Label match, allowing GP12 ↔ 12 equivalence.
  const norm = (s: string): string => s.toLowerCase().replace(/^gp/, '')
  const byLabel = pads.find((p) => {
    const lbl = p.pad.label.toLowerCase()
    if (lbl === lower) return true
    if (isNum && norm(p.pad.label) === t) return true
    return false
  })
  if (byLabel) return byLabel

  // Out-of-range numeric: nearest GPIO pad so a wire still draws.
  if (isNum) {
    const gpioPads = pads.filter((p) => typeof p.pad.gpio === 'number')
    if (gpioPads.length > 0) {
      let best = gpioPads[0]
      let bestDelta = Math.abs((best.pad.gpio as number) - num)
      for (const p of gpioPads) {
        const d = Math.abs((p.pad.gpio as number) - num)
        if (d < bestDelta) {
          best = p
          bestDelta = d
        }
      }
      return best
    }
  }

  // Last resort: first pad.
  return pads[0] ?? { x: box.x, y: box.y, edge: 'left', pad: { label: t } }
}
