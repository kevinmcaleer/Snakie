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

/** Stable identity for a drawn pad by its rounded coordinate (used to mark which
 *  pads a connection resolves to). Shared by every board renderer. */
export function padKey(p: { x: number; y: number }): string {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
}

/** A board pad in flattened (header→pin) order — the canonical pin enumeration. */
export interface BoardPadRef {
  pad: BoardPad
  edge: BoardHeader['edge']
  /** Flattened index — authoritative; the wiring endpoint `#index` for the MCU. */
  index: number
  /** Position within its own header (for even edge spreading). */
  i: number
  /** Pin count of its header. */
  n: number
}

/**
 * Flatten a board's pads in header→pin order, **skipping empty headers**. This is
 * the single source of truth for board pad ORDER, shared by {@link layoutPads}
 * (life-like) and the MCU schematic symbol, so the wiring endpoint `board.*#index`
 * resolves to the same physical pad in BOTH views. Pure + DOM-free for tests.
 */
export function enumerateBoardPads(def: BoardDefinition): BoardPadRef[] {
  const out: BoardPadRef[] = []
  let index = 0
  for (const header of def.headers) {
    const n = header.pins.length
    if (n === 0) continue
    header.pins.forEach((pad, i) => {
      out.push({ pad, edge: header.edge, index, i, n })
      index += 1
    })
  }
  return out
}

/**
 * Compute every pad's drawn coordinate for a board (so they can be drawn +
 * matched). Pads are spread evenly along their header's edge, inset from the
 * corners, in {@link enumerateBoardPads} order (empty headers skipped).
 */
export function layoutPads(def: BoardDefinition, box: BoardBox): PadPoint[] {
  return enumerateBoardPads(def).map(({ pad, edge, i, n }) => {
    // Spread pads evenly along the edge, inset from the corners.
    const t = n === 1 ? 0.5 : i / (n - 1)
    if (edge === 'left' || edge === 'right') {
      const y = box.y + 18 + t * (box.h - 36)
      const x = edge === 'left' ? box.x + 12 : box.x + box.w - 12
      return { x, y, edge, pad }
    }
    const x = box.x + 18 + t * (box.w - 36)
    const y = edge === 'top' ? box.y + 12 : box.y + box.h - 12
    return { x, y, edge, pad }
  })
}

/** Which edge a freely-placed pad faces, from its normalised position — biased to
 *  left/right (the common column layout) unless it's clearly near the top/bottom. */
export function edgeFromXY(x: number, y: number): 'left' | 'right' | 'top' | 'bottom' {
  if (x < 0.3) return 'left'
  if (x > 0.7) return 'right'
  return y < 0.5 ? 'top' : 'bottom'
}

/**
 * Pad coordinates preferring the AUTHORED part body's REAL pin x/y, so the board
 * views match the Part Editor exactly. When a board's pads carry positions (an
 * authored Microcontroller part) each pad is placed at `box + (x,y)·box`, the
 * same formula {@link PartBody} draws its pins with — so wires/labels line up on
 * the life-like body. Built-in boards with no positioned pads fall back to the
 * even edge-laid {@link layoutPads}. Used by BOTH the mini board view and the
 * node-graph so they can never drift apart.
 */
export function authoredPads(def: BoardDefinition, box: BoardBox): PadPoint[] {
  const refs = enumerateBoardPads(def)
  if (!refs.some((r) => r.pad.x != null && r.pad.y != null)) return layoutPads(def, box)
  const edgeLaid = layoutPads(def, box)
  return refs.map((r, idx) =>
    r.pad.x != null && r.pad.y != null
      ? {
          x: box.x + r.pad.x * box.w,
          y: box.y + r.pad.y * box.h,
          edge: edgeFromXY(r.pad.x, r.pad.y),
          pad: r.pad
        }
      : edgeLaid[idx]
  )
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

// --- MCU schematic symbol (#140) -------------------------------------------
// The microcontroller drawn as a generic IC block (a rectangle with labelled pin
// stubs) for the Schematic wiring view. Built on enumerateBoardPads so a
// terminal's flatIndex == the layoutPads index == the wiring endpoint `#index`.

/** A microcontroller IC-block terminal (schematic view). */
export interface McuTerminal {
  pad: BoardPad
  side: BoardHeader['edge']
  /** Flattened pad index — the wiring endpoint `#index` for the MCU. */
  flatIndex: number
  /** All flatIndices sharing this terminal (a rail merges several pads into one). */
  railIndices: number[]
  /** Box-edge attach point, local to the symbol box origin. */
  inner: { x: number; y: number }
  /** Stub end = the wire/dot attach point, local. */
  outer: { x: number; y: number }
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  /** False for the extra ground pads merged into the single GND terminal — the
   *  symbol/dots draw only the `primary` one, but every pad keeps its own
   *  flatIndex so any `board.GND#n` wire still resolves to the shared terminal. */
  primary: boolean
}

export interface McuSymbolLayout {
  box: { w: number; h: number }
  terminals: McuTerminal[]
}

/** Evenly spaced positions for `n` terminals between `a` and `b` (inset). */
function mcuSlots(n: number, a: number, b: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [(a + b) / 2]
  return Array.from({ length: n }, (_, i) => a + ((i + 1) * (b - a)) / (n + 1))
}

/** A pad on the ground net (by type, or a ground-ish label as a fallback). */
function isGndPad(pad: BoardPad): boolean {
  return pad.type === 'gnd' || /^(gnd|ground|vss|vee|agnd|dgnd)$/i.test(pad.label ?? '')
}
/** A pad on a power rail (by type, or a supply-ish label as a fallback). */
function isPwrPad(pad: BoardPad): boolean {
  return pad.type === 'vcc' || /^(3v3|3\.3v|5v|vcc|vdd|vbus|vsys|vin|v\+|avdd)$/i.test(pad.label ?? '')
}
/** The rail a pad belongs to (merged in the schematic): one GND, one terminal per
 *  distinct power-rail label (so several `3V3` pads share a terminal but `VBUS` and
 *  `VSYS` stay separate). Signals return null (never merged). */
function railKey(pad: BoardPad): string | null {
  if (isGndPad(pad)) return 'GND'
  if (isPwrPad(pad)) return `PWR:${(pad.label ?? '').toUpperCase()}`
  return null
}

/**
 * Lay out the MCU as an IC block at the origin. Schematic convention: power rails
 * on top, a single combined GND at the bottom, signals on the sides (single-header
 * boards split left/right). Pads on the same rail (all grounds; all `3V3`; …)
 * collapse to ONE terminal — each keeps its own flatIndex (so `board.<pin>#n`
 * wires still resolve to the shared terminal) but only the first is `primary`
 * (drawn). Pure + DOM-free.
 */
export function mcuSymbolLayout(def: BoardDefinition, opts?: { stub?: number }): McuSymbolLayout {
  const stub = opts?.stub ?? 26
  const refs = enumerateBoardPads(def)

  // Group pads by rail; non-rail pads (signals) stay individual.
  const groups = new Map<string, BoardPadRef[]>()
  const singles: BoardPadRef[] = []
  for (const r of refs) {
    const k = railKey(r.pad)
    if (k) {
      const g = groups.get(k)
      if (g) g.push(r)
      else groups.set(k, [r])
    } else {
      singles.push(r)
    }
  }

  interface VT {
    side: BoardHeader['edge']
    refs: BoardPadRef[]
  }
  const vts: VT[] = []
  // Signals always split EVENLY between the left and right sides (in pad order) so
  // the IC block stays balanced and never grows into one tall column.
  const sigHalf = Math.ceil(singles.length / 2)
  singles.forEach((r, i) => vts.push({ side: i < sigHalf ? 'left' : 'right', refs: [r] }))
  // Power rails on top (board order), the combined GND at the bottom.
  for (const [k, g] of groups) if (k !== 'GND') vts.push({ side: 'top', refs: g })
  const gndGroup = groups.get('GND')
  if (gndGroup) vts.push({ side: 'bottom', refs: gndGroup })

  const bySide: Record<BoardHeader['edge'], VT[]> = { left: [], right: [], top: [], bottom: [] }
  for (const vt of vts) bySide[vt.side].push(vt)

  // Box size from a per-pin pitch so labels never overlap (≈26px rows, ≈58px cols):
  // height from the busiest L/R side, width from the busiest top/bottom row.
  const vRows = Math.max(bySide.left.length, bySide.right.length, 1)
  const hCols = Math.max(bySide.top.length, bySide.bottom.length, 1)
  const boxW = Math.max(170, (hCols + 1) * 58)
  const boxH = Math.max(150, (vRows + 1) * 26)

  const lY = mcuSlots(bySide.left.length, 0, boxH)
  const rY = mcuSlots(bySide.right.length, 0, boxH)
  const tX = mcuSlots(bySide.top.length, 0, boxW)
  const bX = mcuSlots(bySide.bottom.length, 0, boxW)

  const terminals: McuTerminal[] = []
  const place = (vt: VT, side: BoardHeader['edge'], x1: number, y1: number, x2: number, y2: number): void => {
    const labelX = side === 'left' ? x1 + 6 : side === 'right' ? x1 - 6 : x1
    const labelY = side === 'top' ? y1 + 14 : side === 'bottom' ? y1 - 8 : y1 - 4
    const anchor: 'start' | 'middle' | 'end' = side === 'left' ? 'start' : side === 'right' ? 'end' : 'middle'
    const railIndices = vt.refs.map((r) => r.index)
    vt.refs.forEach((r, k) =>
      terminals.push({
        pad: r.pad,
        side,
        flatIndex: r.index,
        railIndices,
        inner: { x: x1, y: y1 },
        outer: { x: x2, y: y2 },
        label: { x: labelX, y: labelY, anchor },
        primary: k === 0
      })
    )
  }
  bySide.left.forEach((vt, i) => place(vt, 'left', 0, lY[i], -stub, lY[i]))
  bySide.right.forEach((vt, i) => place(vt, 'right', boxW, rY[i], boxW + stub, rY[i]))
  bySide.top.forEach((vt, i) => place(vt, 'top', tX[i], 0, tX[i], -stub))
  bySide.bottom.forEach((vt, i) => place(vt, 'bottom', bX[i], boxH, bX[i], boxH + stub))
  terminals.sort((a, b) => a.flatIndex - b.flatIndex)
  return { box: { w: boxW, h: boxH }, terminals }
}
