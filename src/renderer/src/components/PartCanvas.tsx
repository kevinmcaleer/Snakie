import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_SHAPE_STROKE_WIDTH,
  addComponentOnTop,
  derivePinPosition,
  insertPolygonPoint,
  nearestCenter,
  nearestPolygonEdge,
  orderedComponents,
  pinShapeOf,
  resolvedPins,
  type ResolvedPin
} from './part-editor.util'
import type { ComponentShape, ComponentShapeKind, PartDefinition, PartPinType } from '../../../shared/part'
import { capabilityBadges, castellatedPad, pinLabelLayout } from './part-body'
import './PartCanvas.css'

/**
 * PART CANVAS (#130) — a layered, interactive board editor.
 * =========================================================
 *
 * Layers, bottom → top (the user's mental model: "build up the board"):
 *
 *   1. PCB        — the board outline (rect / polygon) + the board IMAGE, which
 *                   sits on this layer and is CLIPPED to the outline.
 *   2. Holes      — mounting holes that CUT THROUGH the PCB + image (an SVG mask
 *                   punches them out), with a plating ring on top. You cannot
 *                   place a pin inside a hole.
 *   3. Pins       — free-placed pads (absolute x/y), coloured by role.
 *   4. Components — labelled rectangles (parts on the board) + text labels.
 *
 * Each layer can be toggled via the `visible` prop (the editor's Layers panel);
 * the footprint view is just the PCB image hidden. Pure free placement: every
 * object carries an absolute normalised position and is dragged directly.
 * `readOnly` renders the same scene non-interactively (the Parts panel detail).
 */

const VIEW_W = 460
const VIEW_H = 460
const MAX_W = 300
const MAX_H = 340

/** Pad fill by electrical role (kept close to the Board View's palette). */
const PAD_FILL: Record<PartPinType, string> = {
  io: '#d6a531',
  pwr: '#c0392b',
  gnd: '#3a3f44',
  other: '#8a8f96'
}

/** The toolbar / layer-add tools, in display order. `rect`/`circle`/`cpoly` add
 *  component shapes; `shape` edits the board outline polygon. */
export type CanvasTool =
  | 'select'
  | 'move'
  | 'shape'
  | 'pin'
  | 'hole'
  | 'text'
  | 'rect'
  | 'circle'
  | 'cpoly'

/** Which layers are currently shown (driven by the Layers panel). */
export interface LayerVisibility {
  /** The PCB body (outline + fill) — separate from the photo so a board-less part
   *  (e.g. a motor) can hide it. */
  pcb: boolean
  image: boolean
  holes: boolean
  pins: boolean
  components: boolean
}

export const DEFAULT_LAYERS: LayerVisibility = { pcb: true, image: true, holes: true, pins: true, components: true }

/** Per-layer edit lock (same keys as {@link LayerVisibility}). A locked layer is
 *  still drawn, but its items can't be selected, moved, resized, or created — so
 *  you can't accidentally nudge the background PCB while wiring pins. */
export type LayerLocks = LayerVisibility
export const DEFAULT_LOCKS: LayerLocks = { pcb: false, image: false, holes: false, pins: false, components: false }

/** What is currently selected (drives the editor's contextual inspector). */
export type CanvasSelection =
  | { type: 'pin'; hi: number; pi: number }
  | { type: 'hole'; index: number }
  | { type: 'shape'; index: number }
  | { type: 'shape-vertex'; index: number; vi: number }
  | { type: 'label'; index: number }
  | { type: 'vertex'; index: number }
  | { type: 'image' }
  | null

export interface PartCanvasProps {
  part: PartDefinition
  /** Per-layer visibility. Defaults to all visible. */
  visible?: LayerVisibility
  /** Per-layer edit lock. A locked layer can't be selected/moved/edited. */
  locked?: LayerLocks
  /** Draw the pin-spacing grid behind the board. */
  showGrid?: boolean
  /** Non-interactive render (the Parts panel detail). */
  readOnly?: boolean
  /** Active tool (interactive only). */
  tool?: CanvasTool
  /** Current selection (interactive only). */
  selection?: CanvasSelection
  /** Snap placed/moved positions to the pin-spacing grid. */
  snap?: boolean
  /** Keep the image layer's width:height ratio fixed while resizing it. */
  lockAspect?: boolean
  /** The board image's NATIVE pixel aspect (w/h); used so a locked resize keeps
   *  the photo's true proportions rather than whatever it was stretched to. */
  imageNativeAspect?: number | null
  /** Mutate the part (interactive only). */
  onChange?: (next: PartDefinition) => void
  /** Selection changed. */
  onSelect?: (sel: CanvasSelection) => void
  /** Surface a transient message (e.g. "can't place a pin in a hole"). */
  onNotify?: (msg: string) => void
  /** Toggle the pin-spacing grid (the zoom-overlay grid button). */
  onToggleGrid?: () => void
  /** Toggle snap-to-grid (the zoom-overlay snap button). */
  onToggleSnap?: () => void
  /** Bump this number to reset pan/zoom to the default (a "Fit" button). */
  resetSignal?: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boardAspect(part: PartDefinition): number {
  // Physical dimensions are the source of truth for the outline, so editing
  // width/height reshapes the PCB. `aspect` is only a fallback when there are no
  // dimensions (e.g. a hand-authored part).
  if (part.dimensions && part.dimensions.width > 0 && part.dimensions.height > 0) {
    return part.dimensions.width / part.dimensions.height
  }
  if (typeof part.aspect === 'number' && part.aspect > 0) return part.aspect
  return 0.6
}

/** The alignment/distribute modes the toolbar offers. */
type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distX' | 'distY'

/**
 * A representative align/distribute icon (#170): a reference line on the alignment
 * side + three bars of different lengths snapped to it (à la objects-align-left),
 * so the icon reads as its function rather than a bare arrow.
 */
function alignIcon(mode: AlignMode): JSX.Element {
  const bar = (x: number, y: number, w: number, h: number): JSX.Element => (
    <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} rx={0.6} fill="currentColor" />
  )
  const line = (x1: number, y1: number, x2: number, y2: number): JSX.Element => (
    <line key="ln" x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
  )
  const W = [9, 5.5, 11] // three different bar lengths
  const C = [3, 6.7, 10.4] // three cross-axis slots
  const T = 2.4 // bar thickness
  let content: JSX.Element[]
  switch (mode) {
    case 'left':
      content = [line(2.2, 2, 2.2, 14), ...W.map((w, i) => bar(3.4, C[i], w, T))]
      break
    case 'right':
      content = [line(13.8, 2, 13.8, 14), ...W.map((w, i) => bar(12.6 - w, C[i], w, T))]
      break
    case 'centerX':
      content = [line(8, 2, 8, 14), ...W.map((w, i) => bar(8 - w / 2, C[i], w, T))]
      break
    case 'top':
      content = [line(2, 2.2, 14, 2.2), ...W.map((w, i) => bar(C[i], 3.4, T, w))]
      break
    case 'bottom':
      content = [line(2, 13.8, 14, 13.8), ...W.map((w, i) => bar(C[i], 12.6 - w, T, w))]
      break
    case 'centerY':
      content = [line(2, 8, 14, 8), ...W.map((w, i) => bar(C[i], 8 - w / 2, T, w))]
      break
    case 'distX':
      content = [bar(2.2, 3, T, 10), bar(6.8, 3, T, 10), bar(11.4, 3, T, 10)]
      break
    default: // distY
      content = [bar(3, 2.2, 10, T), bar(3, 6.8, 10, T), bar(3, 11.4, 10, T)]
      break
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {content}
    </svg>
  )
}

/** Fit a board of the given aspect centred within the SVG mat. */
function fitBox(aspect: number): Box {
  let w = MAX_W
  let h = w / aspect
  if (h > MAX_H) {
    h = MAX_H
    w = h * aspect
  }
  return { x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Drag state while a pointer is down. */
interface Drag {
  kind: 'move-obj' | 'pan' | 'resize-image' | 'move-vertex' | 'move-shape-vertex' | 'create-array' | 'marquee'
  sel: CanvasSelection
  corner?: number
  startNX: number
  startNY: number
  ox: number
  oy: number
  ow?: number
  oh?: number
  panX?: number
  panY?: number
  panTX?: number
  panTY?: number
  moved?: boolean
  /** When set, a dragged pin snaps to this anchor's 2.54mm array grid. */
  anchor?: { x: number; y: number }
  /** A modifier (shift/ctrl)-click on a pin: toggle its alignment-selection
   *  membership on a no-move release; a drag instead moves it (#170). */
  toggleSel?: boolean
}

export function PartCanvas({
  part,
  visible: visibleProp,
  locked = DEFAULT_LOCKS,
  showGrid = false,
  readOnly = false,
  tool = 'select',
  selection = null,
  snap = false,
  lockAspect = false,
  imageNativeAspect = null,
  onChange,
  onSelect,
  onNotify,
  onToggleGrid,
  onToggleSnap,
  resetSignal
}: PartCanvasProps): JSX.Element {
  // When no explicit visibility is passed (the Parts Library read-only preview),
  // honour the part's own saved layer visibility so hidden layers (e.g. a traced
  // PCB image) stay hidden. The editor passes `visible` explicitly.
  const visible: LayerVisibility = visibleProp ?? { ...DEFAULT_LAYERS, ...(part.layerVisibility ?? {}) }
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  // Live preview of the pins a "drag from the selected pin" gesture will create.
  const [createPreview, setCreatePreview] = useState<{ axis: 'x' | 'y'; dir: number; n: number } | null>(null)
  // Multi-select of pins (marquee / shift-click) for the alignment toolbar.
  const [selectedPins, setSelectedPins] = useState<{ hi: number; pi: number }[]>([])
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // Smart alignment guides (#169): green center-lines shown while dragging a pin /
  // hole that lines up with another's centre. Normalised x (vertical line) / y.
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null)
  // The pin under the pointer — shows its capability badges (breadboard view).
  const [hoverPin, setHoverPin] = useState<{ hi: number; pi: number } | null>(null)
  const rawId = useId()
  const uid = rawId.replace(/:/g, '') // colons are awkward in funcIRI refs
  const clipId = `pcb-clip-${uid}`
  const maskId = `pcb-holes-${uid}`

  useEffect(() => {
    if (resetSignal !== undefined) setView({ tx: 0, ty: 0, scale: 1 })
  }, [resetSignal])

  const box = fitBox(boardAspect(part))
  const pins = resolvedPins(part)
  const holes = part.mountingHoles ?? []
  const features = part.features ?? [] // legacy chips (read-only; migrated on edit)
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54
  const interactive = !readOnly && !!onChange

  const layer = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }

  // --- geometry helpers -----------------------------------------------------
  const px = (nx: number): number => box.x + nx * box.w
  const py = (ny: number): number => box.y + ny * box.h
  /** A hole's drawn (and collision) radius in viewBox units. */
  const holeR = (diameter: number): number =>
    part.dimensions && part.dimensions.width > 0
      ? Math.max(3, (diameter / part.dimensions.width) * box.w)
      : 6

  // --- coordinate helpers ---------------------------------------------------
  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse())
    return { x: (local.x - view.tx) / view.scale, y: (local.y - view.ty) / view.scale }
  }
  const toNorm = (e: { clientX: number; clientY: number }): { nx: number; ny: number } => {
    const w = toWorld(e)
    return { nx: (w.x - box.x) / box.w, ny: (w.y - box.y) / box.h }
  }
  /**
   * Number of pin-pitch cells along an axis — the SINGLE source of truth shared
   * by both the snap lattice and the drawn grid (so snapped objects land on the
   * lines). Derived from the physical size / pin spacing, with a sensible
   * fallback when the part has no dimensions, and clamped so it never explodes.
   */
  const gridSteps = (axis: 'x' | 'y'): number => {
    const sizeMm = axis === 'x' ? part.dimensions?.width : part.dimensions?.height
    const n = sizeMm && sizeMm > 0 ? Math.round(sizeMm / spacing) : axis === 'x' ? 8 : 16
    return Math.min(axis === 'x' ? 60 : 80, Math.max(2, n))
  }
  const snapVal = (v: number, axis: 'x' | 'y'): number => {
    if (!snap) return clamp01(v)
    const steps = gridSteps(axis)
    return clamp01(Math.round(v * steps) / steps)
  }
  const snapX = (v: number): number => snapVal(v, 'x')
  const snapY = (v: number): number => snapVal(v, 'y')

  // --- ghost pin array (#…): a 2.54mm grid centred on the selected pin --------
  const ARRAY_REACH = 4 // ghost pins shown in each direction
  const stepNX = 1 / gridSteps('x') // one pin-pitch in normalised x
  const stepNY = 1 / gridSteps('y') // one pin-pitch in normalised y
  /** The selected pin — the ghost array's anchor — if exactly one pin is selected. */
  const selPin = selection?.type === 'pin' ? pins.find((p) => p.hi === selection.hi && p.pi === selection.pi) ?? null : null
  /** Snap a value to the anchor's array grid (anchor ± k·step). */
  const snapToAnchor = (v: number, anchor: number, step: number): number => clamp01(anchor + Math.round((v - anchor) / step) * step)

  /** Distance between two normalised points, in viewBox units. */
  const dist = (ax: number, ay: number, bx: number, by: number): number =>
    Math.hypot((ax - bx) * box.w, (ay - by) * box.h)

  /** True if a normalised point lands inside (or just on) a mounting hole. */
  const inHole = (nx: number, ny: number): boolean =>
    holes.some((h) => dist(nx, ny, h.x, h.y) < holeR(h.diameter) + 7)
  /** True if a normalised point (with a hole of radius `r`) would touch a pin. */
  const onPin = (nx: number, ny: number, r: number): boolean =>
    pins.some((p) => dist(nx, ny, p.x, p.y) < r + 6)

  // --- smart alignment guides (#169) ----------------------------------------
  /** Snap distance (viewBox px) for a dragged centre to line up with another's. */
  const ALIGN_PX = 6
  /**
   * While dragging a pin/hole, snap its centre to another pin/hole's centre line
   * (x and/or y) when within {@link ALIGN_PX}, returning the (possibly snapped)
   * point + which guide lines to draw. `off` (Ctrl/Cmd held) bypasses alignment
   * and just applies the normal grid snap.
   */
  const alignDrag = (
    nx: number,
    ny: number,
    kind: 'pin' | 'hole',
    exclude: { hi?: number; pi?: number; index?: number },
    off: boolean
  ): { x: number; y: number; gx?: number; gy?: number } => {
    if (off) return { x: snapX(nx), y: snapY(ny) }
    const centres =
      kind === 'pin'
        ? pins.filter((p) => !(p.hi === exclude.hi && p.pi === exclude.pi)).map((p) => ({ x: p.x, y: p.y }))
        : holes.filter((_, i) => i !== exclude.index).map((h) => ({ x: h.x, y: h.y }))
    const gx = nearestCenter(centres.map((c) => c.x), nx, box.w, ALIGN_PX)
    const gy = nearestCenter(centres.map((c) => c.y), ny, box.h, ALIGN_PX)
    return { x: gx ?? snapX(nx), y: gy ?? snapY(ny), gx: gx ?? undefined, gy: gy ?? undefined }
  }

  // --- mutation helpers -----------------------------------------------------
  const commit = (next: PartDefinition): void => onChange?.(next)

  const movePinTo = (hi: number, pi: number, nx: number, ny: number, anchor?: { x: number; y: number }, presnapped = false): void => {
    // With an anchor (another pin is selected), lock to its 2.54mm array grid;
    // `presnapped` (alignment-guide drag) means the caller already chose x/y, so
    // don't re-snap; otherwise snap to the global grid. Test the stored point.
    const sx = anchor ? snapToAnchor(nx, anchor.x, stepNX) : presnapped ? nx : snapX(nx)
    const sy = anchor ? snapToAnchor(ny, anchor.y, stepNY) : presnapped ? ny : snapY(ny)
    if (inHole(sx, sy)) return
    commit({
      ...part,
      headers: part.headers.map((h, i) =>
        i === hi ? { ...h, pins: h.pins.map((p, j) => (j === pi ? { ...p, x: sx, y: sy } : p)) } : h
      )
    })
  }
  const moveHoleTo = (index: number, nx: number, ny: number, presnapped = false): void => {
    const sx = presnapped ? nx : snapX(nx)
    const sy = presnapped ? ny : snapY(ny)
    // The reverse invariant: a hole can't be dragged onto a pin.
    if (onPin(sx, sy, holeR(holes[index]?.diameter ?? 2.5))) return
    commit({ ...part, mountingHoles: holes.map((h, i) => (i === index ? { ...h, x: sx, y: sy } : h)) })
  }
  const moveShapeTo = (index: number, nx: number, ny: number): void => {
    const sx = snapX(nx)
    const sy = snapY(ny)
    commit({
      ...part,
      shapes: shapes.map((s, i) => {
        if (i !== index) return s
        // Polygons are drawn from `points`, so translate every vertex by the
        // delta too (otherwise dragging the body would be a no-op).
        if (s.kind === 'polygon' && s.points?.length) {
          const ddx = sx - s.x
          const ddy = sy - s.y
          return { ...s, x: sx, y: sy, points: s.points.map((p) => ({ x: clamp01(p.x + ddx), y: clamp01(p.y + ddy) })) }
        }
        return { ...s, x: sx, y: sy }
      })
    })
  }
  const moveShapeVertexTo = (index: number, vi: number, nx: number, ny: number): void => {
    commit({
      ...part,
      shapes: shapes.map((s, i) =>
        i === index ? { ...s, points: (s.points ?? []).map((p, j) => (j === vi ? { x: clamp01(nx), y: clamp01(ny) } : p)) } : s
      )
    })
  }
  const moveLabelTo = (index: number, nx: number, ny: number): void => {
    commit({ ...part, labels: labels.map((l, i) => (i === index ? { ...l, x: snapX(nx), y: snapY(ny) } : l)) })
  }
  const moveVertexTo = (index: number, nx: number, ny: number): void => {
    commit({ ...part, polygon: (part.polygon ?? []).map((p, i) => (i === index ? { x: clamp01(nx), y: clamp01(ny) } : p)) })
  }
  /** Click-to-delete a board-polygon vertex (a polygon needs ≥ 3 points). */
  const deleteVertex = (index: number): void => {
    const poly = part.polygon ?? []
    if (poly.length <= 3) {
      onNotify?.('A polygon needs at least 3 points.')
      return
    }
    commit({ ...part, polygon: poly.filter((_, i) => i !== index) })
    onSelect?.(null)
  }
  /** Click-to-delete a component-polygon vertex (keeps ≥ 3 points). */
  const deleteShapeVertex = (index: number, vi: number): void => {
    const pts = shapes[index]?.points ?? []
    if (pts.length <= 3) {
      onNotify?.('A polygon needs at least 3 points.')
      return
    }
    commit({ ...part, shapes: shapes.map((s, i) => (i === index ? { ...s, points: pts.filter((_, j) => j !== vi) } : s)) })
    onSelect?.({ type: 'shape', index })
  }
  /** Insert a vertex into a component polygon after edge `edgeI` (click-on-edge). */
  const insertShapeVertex = (index: number, edgeI: number, nx: number, ny: number): void => {
    const pts = shapes[index]?.points ?? []
    const next = insertPolygonPoint(pts, edgeI, clamp01(nx), clamp01(ny))
    commit({ ...part, shapes: shapes.map((s, i) => (i === index ? { ...s, points: next } : s)) })
    onSelect?.({ type: 'shape-vertex', index, vi: edgeI + 1 })
  }
  /** Insert a vertex into the board outline after edge `edgeI` (click-on-edge). */
  const insertVertexAt = (edgeI: number, nx: number, ny: number): void => {
    const poly = part.polygon ?? []
    const next = insertPolygonPoint(poly, edgeI, clamp01(nx), clamp01(ny))
    commit({ ...part, polygon: next, shape: { kind: 'polygon' } })
    onSelect?.({ type: 'vertex', index: edgeI + 1 })
  }
  const moveImage = (nx: number, ny: number): void => commit({ ...part, imageLayer: { ...layer, x: nx, y: ny } })
  const resizeImage = (x: number, y: number, w: number, h: number): void =>
    commit({ ...part, imageLayer: { ...layer, x, y, w, h } })

  const addPin = (nx: number, ny: number): void => {
    const sx = snapX(nx)
    const sy = snapY(ny)
    if (inHole(sx, sy)) {
      onNotify?.(
        visible.holes
          ? "Can't place a pin in a mounting hole."
          : 'A hidden mounting hole is there — toggle the Holes layer to see it.'
      )
      return
    }
    const n = pins.length
    const newPin = { name: `P${n}`, type: 'io' as const, gpio: n, capabilities: ['digital' as const], x: sx, y: sy }
    const headers = part.headers.length ? part.headers : [{ edge: 'left' as const, pins: [] }]
    commit({ ...part, headers: headers.map((h, i) => (i === 0 ? { ...h, pins: [...h.pins, newPin] } : h)) })
    onSelect?.({ type: 'pin', hi: 0, pi: headers[0].pins.length })
  }
  /** Add several pins at once (the ghost-array "drag to create" gesture). */
  const addPinsArray = (positions: { x: number; y: number }[]): void => {
    const valid = positions.filter((p) => !inHole(p.x, p.y))
    if (!valid.length) return
    const n0 = pins.length
    const newPins = valid.map((p, i) => ({
      name: `P${n0 + i}`,
      type: 'io' as const,
      gpio: n0 + i,
      capabilities: ['digital' as const],
      x: p.x,
      y: p.y
    }))
    const headers = part.headers.length ? part.headers : [{ edge: 'left' as const, pins: [] }]
    commit({ ...part, headers: headers.map((h, i) => (i === 0 ? { ...h, pins: [...h.pins, ...newPins] } : h)) })
  }

  // --- multi-select + alignment (#…) ----------------------------------------
  const pinKey = (hi: number, pi: number): string => `${hi}-${pi}`
  const toggleSelectedPin = (hi: number, pi: number): void =>
    setSelectedPins((cur) =>
      cur.some((s) => s.hi === hi && s.pi === pi) ? cur.filter((s) => !(s.hi === hi && s.pi === pi)) : [...cur, { hi, pi }]
    )

  /** Commit x/y updates for several pins in a single change. */
  const commitPins = (updates: Map<string, { x?: number; y?: number }>): void =>
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const u = updates.get(pinKey(hi, pi))
          return u ? { ...p, ...(u.x !== undefined ? { x: u.x } : {}), ...(u.y !== undefined ? { y: u.y } : {}) } : p
        })
      }))
    })

  const selectedResolved = (): { hi: number; pi: number; x: number; y: number }[] =>
    selectedPins
      .map((s) => {
        const rp = pins.find((p) => p.hi === s.hi && p.pi === s.pi)
        return rp ? { hi: s.hi, pi: s.pi, x: rp.x, y: rp.y } : null
      })
      .filter((v): v is { hi: number; pi: number; x: number; y: number } => v !== null)

  const alignSelected = (mode: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'): void => {
    const sel = selectedResolved()
    if (sel.length < 2) return
    const horiz = mode === 'left' || mode === 'right' || mode === 'centerX'
    const vals = sel.map((s) => (horiz ? s.x : s.y))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    // left/top → min edge, right/bottom → max edge, centerX/centerY → midpoint.
    const target = mode === 'left' || mode === 'top' ? min : mode === 'right' || mode === 'bottom' ? max : (min + max) / 2
    const updates = new Map<string, { x?: number; y?: number }>()
    for (const s of sel) updates.set(pinKey(s.hi, s.pi), horiz ? { x: target } : { y: target })
    commitPins(updates)
  }

  const distributeSelected = (axis: 'x' | 'y'): void => {
    const sel = selectedResolved()
    if (sel.length < 3) return // ≥3 to space evenly (2 are already "distributed")
    const sorted = [...sel].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
    const min = axis === 'x' ? sorted[0].x : sorted[0].y
    const max = axis === 'x' ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y
    const step = (max - min) / (sorted.length - 1)
    const updates = new Map<string, { x?: number; y?: number }>()
    sorted.forEach((s, i) => updates.set(pinKey(s.hi, s.pi), axis === 'x' ? { x: min + i * step } : { y: min + i * step }))
    commitPins(updates)
  }

  /** Container-pixel position of the LAST selected pin, so the align toolbar can
   *  float just above it (#170). Null when it can't be resolved (CTM/ref missing). */
  const alignAnchorPx = (): { left: number; top: number } | null => {
    const last = selectedPins[selectedPins.length - 1]
    const svg = svgRef.current
    if (!last || !svg) return null
    const rp = pins.find((p) => p.hi === last.hi && p.pi === last.pi)
    const ctm = svg.getScreenCTM()
    if (!rp || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = view.tx + px(rp.x) * view.scale
    pt.y = view.ty + py(rp.y) * view.scale
    const s = pt.matrixTransform(ctm)
    // The toolbar is absolutely positioned inside .pcv__wrap, so measure relative to
    // that container — not the SVG, which is flex-centred and may be letterboxed.
    const base = (svg.closest('.pcv__wrap') as HTMLElement | null) ?? svg
    const rect = base.getBoundingClientRect()
    return { left: s.x - rect.left, top: s.y - rect.top }
  }
  const addHole = (nx: number, ny: number): void => {
    const sx = snapX(nx)
    const sy = snapY(ny)
    if (onPin(sx, sy, holeR(2.5))) {
      onNotify?.("Can't place a mounting hole on a pin.")
      return
    }
    const next = [...holes, { x: sx, y: sy, diameter: 2.5 }]
    commit({ ...part, mountingHoles: next })
    onSelect?.({ type: 'hole', index: next.length - 1 })
  }
  const addShape = (kind: ComponentShapeKind, nx: number, ny: number): void => {
    const base = {
      kind,
      label: '',
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH
    }
    let shape: ComponentShape
    if (kind === 'circle') {
      shape = { ...base, x: clamp01(nx), y: clamp01(ny), r: 0.08 }
    } else if (kind === 'polygon') {
      const cx = clamp01(nx)
      const cy = clamp01(ny)
      shape = {
        ...base,
        x: cx,
        y: cy,
        points: [
          { x: clamp01(cx), y: clamp01(cy - 0.08) },
          { x: clamp01(cx + 0.09), y: clamp01(cy + 0.06) },
          { x: clamp01(cx - 0.09), y: clamp01(cy + 0.06) }
        ]
      }
    } else {
      shape = { ...base, x: clamp01(nx - 0.1), y: clamp01(ny - 0.07), w: 0.2, h: 0.14 }
    }
    // addComponentOnTop renormalises z so the new shape lands strictly on top.
    const nextPart = addComponentOnTop(part, 'shape', shape)
    commit(nextPart)
    onSelect?.({ type: 'shape', index: (nextPart.shapes?.length ?? 1) - 1 })
  }
  const addLabel = (nx: number, ny: number): void => {
    const nextPart = addComponentOnTop(part, 'label', { text: 'Label', x: clamp01(nx), y: clamp01(ny), fontSize: 12 })
    commit(nextPart)
    onSelect?.({ type: 'label', index: (nextPart.labels?.length ?? 1) - 1 })
  }
  const addVertex = (nx: number, ny: number): void => {
    const poly = part.polygon ?? [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ]
    commit({ ...part, polygon: [...poly, { x: clamp01(nx), y: clamp01(ny) }], shape: { kind: 'polygon' } })
  }

  // --- hit testing (topmost VISIBLE selectable object) ----------------------
  const HIT = 14
  // Edge-click-to-insert uses a thinner band than the vertex grab so a click in
  // the interior of a SMALL polygon still moves the body instead of inserting.
  const EDGE_HIT = 7
  /** True if a normalised point is inside a component shape. */
  const inShape = (s: ComponentShape, nx: number, ny: number): boolean => {
    if (s.kind === 'rect') return nx >= s.x && nx <= s.x + (s.w ?? 0) && ny >= s.y && ny <= s.y + (s.h ?? 0)
    if (s.kind === 'circle') return dist(nx, ny, s.x, s.y) <= (s.r ?? 0) * box.w + 2
    // polygon: ray-cast point-in-polygon over the points (normalised)
    const pts = s.points ?? []
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      if (a.y > ny !== b.y > ny && nx < ((b.x - a.x) * (ny - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }
  const hitTest = (nx: number, ny: number): CanvasSelection => {
    // A locked layer is skipped entirely — its items can't be picked up.
    if (visible.components && !locked.components) {
      // Walk the unified z-order top-most first so a click selects what's visually
      // on top (shapes and labels interleave by `z`).
      const ord = orderedComponents(part)
      for (let k = ord.length - 1; k >= 0; k--) {
        const c = ord[k]
        if (c.kind === 'label') {
          if (dist(nx, ny, labels[c.index].x, labels[c.index].y) < HIT * 1.4) return { type: 'label', index: c.index }
        } else if (inShape(shapes[c.index], nx, ny)) {
          return { type: 'shape', index: c.index }
        }
      }
    }
    if (visible.pins && !locked.pins)
      for (let i = pins.length - 1; i >= 0; i--)
        if (dist(nx, ny, pins[i].x, pins[i].y) < HIT) return { type: 'pin', hi: pins[i].hi, pi: pins[i].pi }
    if (visible.holes && !locked.holes)
      for (let i = holes.length - 1; i >= 0; i--)
        if (dist(nx, ny, holes[i].x, holes[i].y) < HIT) return { type: 'hole', index: i }
    if (visible.image && !locked.image && part.imageData && nx >= layer.x && nx <= layer.x + layer.w && ny >= layer.y && ny <= layer.y + layer.h)
      return { type: 'image' }
    return null
  }

  // --- pointer handlers -----------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!interactive) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const { nx, ny } = toNorm(e)

    if (tool === 'move') {
      dragRef.current = { kind: 'pan', sel: null, startNX: nx, startNY: ny, ox: 0, oy: 0, panX: e.clientX, panY: e.clientY, panTX: view.tx, panTY: view.ty }
      return
    }
    // Creation tools no-op on a locked layer.
    if (tool === 'pin') return locked.pins ? undefined : addPin(nx, ny)
    if (tool === 'hole') return locked.holes ? undefined : addHole(nx, ny)
    if (tool === 'rect') return locked.components ? undefined : addShape('rect', nx, ny)
    if (tool === 'circle') return locked.components ? undefined : addShape('circle', nx, ny)
    if (tool === 'cpoly') return locked.components ? undefined : addShape('polygon', nx, ny)
    if (tool === 'text') return locked.components ? undefined : addLabel(nx, ny)
    if (tool === 'shape') {
      if (locked.image) return
      const poly = part.polygon ?? []
      for (let i = poly.length - 1; i >= 0; i--) {
        if (dist(nx, ny, poly[i].x, poly[i].y) < HIT) {
          onSelect?.({ type: 'vertex', index: i })
          dragRef.current = { kind: 'move-vertex', sel: { type: 'vertex', index: i }, startNX: nx, startNY: ny, ox: poly[i].x, oy: poly[i].y }
          return
        }
      }
      // Click ON an edge inserts a vertex there; clicking elsewhere appends one.
      const ne = poly.length >= 2 ? nearestPolygonEdge(poly, nx, ny, box.w, box.h) : { index: -1, dist: Infinity }
      if (ne.index >= 0 && ne.dist < EDGE_HIT) insertVertexAt(ne.index, nx, ny)
      else addVertex(nx, ny)
      return
    }

    // select tool — a selected polygon shape's vertex handles first
    if ((selection?.type === 'shape' || selection?.type === 'shape-vertex') && visible.components && !locked.components) {
      const si = selection.index
      const poly = shapes[si]
      if (poly?.kind === 'polygon') {
        const pts = poly.points ?? []
        // A vertex click takes priority (drag = move, no-move click = delete)…
        for (let v = pts.length - 1; v >= 0; v--) {
          if (dist(nx, ny, pts[v].x, pts[v].y) < HIT) {
            onSelect?.({ type: 'shape-vertex', index: si, vi: v })
            dragRef.current = { kind: 'move-shape-vertex', sel: { type: 'shape-vertex', index: si, vi: v }, startNX: nx, startNY: ny, ox: pts[v].x, oy: pts[v].y }
            return
          }
        }
        // …else a click ON an edge (within the thin EDGE_HIT band, so the body
        // stays draggable) inserts a new vertex there. No drag, so the no-move-
        // delete in onPointerUp can't immediately undo it.
        const ne = nearestPolygonEdge(pts, nx, ny, box.w, box.h)
        if (ne.index >= 0 && ne.dist < EDGE_HIT) {
          insertShapeVertex(si, ne.index, nx, ny)
          return
        }
      }
    }

    // select tool — image resize handles (when the image is selected)
    if (selection?.type === 'image' && visible.image && !locked.image && part.imageData) {
      const corners = [
        [layer.x, layer.y],
        [layer.x + layer.w, layer.y],
        [layer.x + layer.w, layer.y + layer.h],
        [layer.x, layer.y + layer.h]
      ]
      for (let c = 0; c < 4; c++) {
        if (dist(nx, ny, corners[c][0], corners[c][1]) < HIT) {
          dragRef.current = { kind: 'resize-image', sel: { type: 'image' }, corner: c, startNX: nx, startNY: ny, ox: layer.x, oy: layer.y, ow: layer.w, oh: layer.h }
          return
        }
      }
    }

    const hit = hitTest(nx, ny)

    // Multi-select (#170): shift OR ctrl/cmd click on a pin adds/removes it from
    // the alignment group on a no-move RELEASE; a drag instead moves it (so
    // ctrl-drag still free-moves, #169). The toggle fires in onPointerUp.
    const modSelect = e.shiftKey || e.ctrlKey || e.metaKey
    if (hit?.type === 'pin' && modSelect) {
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox: rp?.x ?? nx, oy: rp?.y ?? ny, toggleSel: true }
      return
    }
    // Any plain (non-modifier) interaction clears an existing multi-selection.
    if (!modSelect && selectedPins.length) setSelectedPins([])

    // Ghost-array gestures (a pin is selected = the array anchor):
    if (hit?.type === 'pin' && selPin) {
      if (hit.hi === selPin.hi && hit.pi === selPin.pi) {
        // Drag FROM the anchor pin → lay down a row/column of new pins.
        dragRef.current = { kind: 'create-array', sel: hit, startNX: nx, startNY: ny, ox: selPin.x, oy: selPin.y, anchor: { x: selPin.x, y: selPin.y } }
        return
      }
      // Drag a DIFFERENT pin → align it to the anchor's grid; keep the anchor
      // selected (a no-move click re-anchors, handled in onPointerUp).
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox: rp?.x ?? nx, oy: rp?.y ?? ny, anchor: { x: selPin.x, y: selPin.y } }
      return
    }

    onSelect?.(hit)
    if (!hit) {
      // Empty canvas (select tool) → rubber-band marquee to select pins. Skipped
      // when the pin layer is locked (there'd be nothing selectable to gather).
      if (!locked.pins) {
        dragRef.current = { kind: 'marquee', sel: null, startNX: nx, startNY: ny, ox: nx, oy: ny }
        setMarquee({ x0: nx, y0: ny, x1: nx, y1: ny })
      }
      return
    }
    let ox = 0
    let oy = 0
    if (hit.type === 'pin') {
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      ox = rp?.x ?? nx
      oy = rp?.y ?? ny
    } else if (hit.type === 'hole') {
      ox = holes[hit.index]?.x ?? nx
      oy = holes[hit.index]?.y ?? ny
    } else if (hit.type === 'shape') {
      ox = shapes[hit.index]?.x ?? nx
      oy = shapes[hit.index]?.y ?? ny
    } else if (hit.type === 'label') {
      ox = labels[hit.index]?.x ?? nx
      oy = labels[hit.index]?.y ?? ny
    } else if (hit.type === 'image') {
      ox = layer.x
      oy = layer.y
    }
    dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox, oy }
  }

  const viewBoxScale = (): number => {
    const ctm = svgRef.current?.getScreenCTM()
    return ctm && ctm.a ? ctm.a : 1
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d || !interactive) return
    if (d.kind === 'pan') {
      const s = viewBoxScale()
      setView((v) => ({ ...v, tx: (d.panTX ?? 0) + (e.clientX - (d.panX ?? 0)) / s, ty: (d.panTY ?? 0) + (e.clientY - (d.panY ?? 0)) / s }))
      return
    }
    const { nx, ny } = toNorm(e)
    const dx = nx - d.startNX
    const dy = ny - d.startNY
    // Only count a real drag (so a click on a vertex stays a click → delete).
    if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) d.moved = true
    if (d.kind === 'marquee') {
      setMarquee({ x0: d.startNX, y0: d.startNY, x1: nx, y1: ny })
      return
    }
    if (d.kind === 'create-array' && d.anchor) {
      // Lay pins along the dominant drag axis at array positions (preview only;
      // committed on pointer-up).
      const ax = nx - d.anchor.x
      const ay = ny - d.anchor.y
      const horiz = Math.abs(ax) >= Math.abs(ay)
      const step = horiz ? stepNX : stepNY
      const delta = horiz ? ax : ay
      const n = Math.min(ARRAY_REACH, Math.max(0, Math.round(Math.abs(delta) / step)))
      setCreatePreview(n > 0 ? { axis: horiz ? 'x' : 'y', dir: delta >= 0 ? 1 : -1, n } : null)
      return
    }
    if (d.kind === 'resize-image' && d.ow !== undefined && d.oh !== undefined) {
      let x = d.ox
      let y = d.oy
      let w = d.ow
      let h = d.oh
      const right = d.ox + d.ow
      const bottom = d.oy + d.oh
      if (lockAspect && d.oh > 0) {
        // Keep the image's NATIVE pixel aspect (so it's never distorted): size the
        // layer box so (w·boxW)/(h·boxH) === native. Falls back to the current
        // on-screen ratio if the native aspect isn't known yet.
        const native =
          imageNativeAspect && imageNativeAspect > 0 ? imageNativeAspect : (d.ow * box.w) / (d.oh * box.h)
        const grow = d.corner === 0 || d.corner === 3 ? -dx : dx
        w = Math.max(0.06, d.ow + grow)
        h = (w * box.w) / (native * box.h)
        x = d.corner === 0 || d.corner === 3 ? right - w : d.ox
        y = d.corner === 0 || d.corner === 1 ? bottom - h : d.oy
      } else if (d.corner === 0) {
        x = d.ox + dx
        y = d.oy + dy
        w = right - x
        h = bottom - y
      } else if (d.corner === 1) {
        y = d.oy + dy
        w = d.ow + dx
        h = bottom - y
      } else if (d.corner === 2) {
        w = d.ow + dx
        h = d.oh + dy
      } else if (d.corner === 3) {
        x = d.ox + dx
        w = right - x
        h = d.oh + dy
      }
      if (w > 0.05 && h > 0.05) resizeImage(x, y, w, h)
      return
    }
    if (d.kind === 'move-vertex' && d.sel?.type === 'vertex') {
      moveVertexTo(d.sel.index, d.ox + dx, d.oy + dy)
      return
    }
    if (d.kind === 'move-shape-vertex' && d.sel?.type === 'shape-vertex') {
      moveShapeVertexTo(d.sel.index, d.sel.vi, d.ox + dx, d.oy + dy)
      return
    }
    if (d.kind === 'move-obj' && d.sel) {
      const x = d.ox + dx
      const y = d.oy + dy
      const noSnap = e.ctrlKey || e.metaKey // Ctrl/Cmd disables alignment snapping
      if (d.sel.type === 'pin' && d.anchor) {
        // Ghost-array drag keeps its 2.54mm lock; no alignment guides.
        movePinTo(d.sel.hi, d.sel.pi, x, y, d.anchor)
        setGuides(null)
      } else if (d.sel.type === 'pin') {
        const a = alignDrag(x, y, 'pin', { hi: d.sel.hi, pi: d.sel.pi }, noSnap)
        setGuides(a.gx !== undefined || a.gy !== undefined ? { x: a.gx, y: a.gy } : null)
        movePinTo(d.sel.hi, d.sel.pi, a.x, a.y, undefined, true)
      } else if (d.sel.type === 'hole') {
        const a = alignDrag(x, y, 'hole', { index: d.sel.index }, noSnap)
        setGuides(a.gx !== undefined || a.gy !== undefined ? { x: a.gx, y: a.gy } : null)
        moveHoleTo(d.sel.index, a.x, a.y, true)
      } else if (d.sel.type === 'shape') moveShapeTo(d.sel.index, x, y)
      else if (d.sel.type === 'label') moveLabelTo(d.sel.index, x, y)
      else if (d.sel.type === 'image') moveImage(x, y)
    }
  }

  const onPointerUp = (): void => {
    const d = dragRef.current
    dragRef.current = null
    const preview = createPreview
    setCreatePreview(null)
    setGuides(null) // drop any alignment guides
    if (!d || !interactive) return

    // Marquee → select the pins inside the box.
    if (d.kind === 'marquee') {
      const m = marquee
      setMarquee(null)
      if (m) {
        const minX = Math.min(m.x0, m.x1)
        const maxX = Math.max(m.x0, m.x1)
        const minY = Math.min(m.y0, m.y1)
        const maxY = Math.max(m.y0, m.y1)
        const inside = pins
          .filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
          .map((p) => ({ hi: p.hi, pi: p.pi }))
        setSelectedPins(inside)
        if (inside.length) onSelect?.(null)
      }
      return
    }

    // Commit the ghost-array "drag to create" gesture.
    if (d.kind === 'create-array' && d.anchor && preview && preview.n > 0) {
      const positions: { x: number; y: number }[] = []
      for (let k = 1; k <= preview.n; k++) {
        const x = preview.axis === 'x' ? d.anchor.x + preview.dir * k * stepNX : d.anchor.x
        const y = preview.axis === 'y' ? d.anchor.y + preview.dir * k * stepNY : d.anchor.y
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) positions.push({ x, y })
      }
      addPinsArray(positions)
      return
    }
    if (d.moved) return
    // A no-move modifier-click toggles the pin's alignment-selection membership.
    if (d.kind === 'move-obj' && d.toggleSel && d.sel?.type === 'pin') {
      toggleSelectedPin(d.sel.hi, d.sel.pi)
      onSelect?.(null)
      return
    }
    // A no-move click on a pin (while another was the anchor) re-anchors to it.
    if (d.kind === 'move-obj' && d.anchor && d.sel?.type === 'pin') {
      onSelect?.(d.sel)
      return
    }
    // A click (no drag) on a polygon vertex deletes it.
    if (d.kind === 'move-vertex' && d.sel?.type === 'vertex') deleteVertex(d.sel.index)
    else if (d.kind === 'move-shape-vertex' && d.sel?.type === 'shape-vertex') deleteShapeVertex(d.sel.index, d.sel.vi)
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    if (!interactive) return
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const scale = Math.min(4, Math.max(0.4, v.scale * factor))
      if (!ctm) return { ...v, scale }
      const pt = svg!.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse())
      const wx = (local.x - v.tx) / v.scale
      const wy = (local.y - v.ty) / v.scale
      return { scale, tx: local.x - wx * scale, ty: local.y - wy * scale }
    })
  }
  /** Zoom by a factor about the canvas centre (the zoom buttons). */
  const zoomBy = (factor: number): void =>
    setView((v) => {
      const scale = Math.min(4, Math.max(0.4, v.scale * factor))
      const cx = VIEW_W / 2
      const cy = VIEW_H / 2
      const wx = (cx - v.tx) / v.scale
      const wy = (cy - v.ty) / v.scale
      return { scale, tx: cx - wx * scale, ty: cy - wy * scale }
    })

  // --- board outline path ---------------------------------------------------
  const usePolygon = part.shape?.kind === 'polygon' && (part.polygon?.length ?? 0) >= 3
  // Honour an explicit 0 (square corners); only fall back when truly unset.
  const cornerR =
    part.shape?.cornerRadius != null ? part.shape.cornerRadius * Math.min(box.w, box.h) : 8
  const polyPoints = (part.polygon ?? []).map((p) => `${px(p.x)},${py(p.y)}`).join(' ')

  /** The board outline as a shape element, with the given paint props. */
  const shapeEl = (props: Record<string, unknown>): JSX.Element =>
    usePolygon ? (
      <polygon points={polyPoints} {...props} />
    ) : (
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={cornerR} {...props} />
    )

  const cutHoles = visible.holes && holes.length > 0

  // The pin-pitch grid (visible lines at the current `spacing`, default 2.54mm).
  const gridLines: JSX.Element[] = []
  if (showGrid) {
    const cols = gridSteps('x')
    const rows = gridSteps('y')
    for (let c = 1; c < cols; c++)
      gridLines.push(<line key={`gc${c}`} x1={px(c / cols)} y1={box.y} x2={px(c / cols)} y2={box.y + box.h} stroke="var(--bc-grid, #ffffff30)" strokeWidth={0.5} />)
    for (let r = 1; r < rows; r++)
      gridLines.push(<line key={`gr${r}`} x1={box.x} y1={py(r / rows)} x2={box.x + box.w} y2={py(r / rows)} stroke="var(--bc-grid, #ffffff30)" strokeWidth={0.5} />)
  }

  const isSel = (s: CanvasSelection): boolean => !!selection && JSON.stringify(selection) === JSON.stringify(s)

  const svg = (
    <svg
      ref={svgRef}
      className={`pcv__svg${interactive ? ' pcv__svg--interactive' : ''} pcv__tool-${tool}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`Board view of ${part.name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        {/* Clip the image to the board outline (image sits ON the PCB). */}
        <clipPath id={clipId}>{shapeEl({})}</clipPath>
        {/* Punch the mounting holes through the PCB + image. */}
        {cutHoles && (
          <mask id={maskId}>
            {shapeEl({ fill: 'white' })}
            {holes.map((h, i) => (
              <circle key={i} cx={px(h.x)} cy={py(h.y)} r={holeR(h.diameter)} fill="black" />
            ))}
          </mask>
        )}
      </defs>

      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
        {/* Layer 1: PCB (outline + image), with holes cut through via the mask */}
        <g mask={cutHoles ? `url(#${maskId})` : undefined}>
          {visible.pcb && shapeEl({ fill: part.pcbColor || '#0f5a2e', stroke: '#0008', strokeWidth: 2 })}
          {visible.image && part.imageData && (
            <image
              href={part.imageData}
              x={px(layer.x)}
              y={py(layer.y)}
              width={layer.w * box.w}
              height={layer.h * box.h}
              opacity={layer.opacity ?? 1}
              preserveAspectRatio="none"
              clipPath={`url(#${clipId})`}
              style={{ pointerEvents: 'none' }}
            />
          )}
        </g>

        {/* The pin-pitch grid, on top of the image so you can align to it. */}
        {showGrid && (
          <g aria-hidden="true" clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
            {gridLines}
          </g>
        )}

        {/* Layer 2: hole plating rings (on top of the cutout) */}
        {visible.holes &&
          holes.map((h, i) => (
            <circle
              key={`h${i}`}
              cx={px(h.x)}
              cy={py(h.y)}
              r={holeR(h.diameter)}
              fill="none"
              stroke={isSel({ type: 'hole', index: i }) ? '#fff' : '#cfd6dd'}
              strokeWidth={isSel({ type: 'hole', index: i }) ? 3 : 2}
            />
          ))}

        {/* Layer 3: pins (square / round / castellated / header) */}
        {visible.pins &&
          pins.map((rp: ResolvedPin, i) => {
            const fill = PAD_FILL[rp.pin.type] ?? PAD_FILL.other
            const sel = isSel({ type: 'pin', hi: rp.hi, pi: rp.pi })
            const size = 12
            const cx = px(rp.x)
            const cy = py(rp.y)
            const stroke = sel ? '#fff' : '#0008'
            const sw = sel ? 3 : 1
            const shape = pinShapeOf(rp.pin)
            let pad: JSX.Element
            if (shape === 'round') {
              pad = <circle cx={cx} cy={cy} r={size / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
            } else if (shape === 'castellated') {
              pad = castellatedPad(cx, cy, size, rp.x, rp.pin.type === 'gnd', stroke, sw, rp.pin.rotation)
            } else if (shape === 'header') {
              // A through-hole header pad: copper annular ring with the drill hole.
              pad = (
                <>
                  <circle cx={cx} cy={cy} r={size / 2} fill="#c79a4e" stroke={stroke} strokeWidth={sw} />
                  <circle cx={cx} cy={cy} r={size / 2 - 3.5} fill="var(--bc-mat, #0c0f12)" />
                </>
              )
            } else {
              pad = (
                <>
                  <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />
                  <circle cx={cx} cy={cy} r={2.3} fill="var(--bc-mat, #0c0f12)" />
                </>
              )
            }
            const text = `${rp.pin.number != null ? `${rp.pin.number} ` : ''}${rp.pin.label || rp.pin.name}`
            // Node-graph style: grey label pushed OUTWARD from the pin's edge, turned
            // 90° on the top/bottom edges (never upside-down) so rows don't collide.
            const ll = pinLabelLayout(cx, cy, rp.pin.rotation, rp.x, rp.y, size, box)
            return (
              <g
                key={`p${i}`}
                onPointerEnter={() => setHoverPin({ hi: rp.hi, pi: rp.pi })}
                onPointerLeave={() => setHoverPin((h) => (h?.hi === rp.hi && h?.pi === rp.pi ? null : h))}
              >
                {pad}
                {text && (
                  <text
                    x={ll.lx}
                    y={ll.ly}
                    className="pcv__pin-label"
                    textAnchor={ll.anchor}
                    transform={ll.rotate ? `rotate(${ll.rotate} ${ll.lx} ${ll.ly})` : undefined}
                  >
                    {text}
                  </text>
                )}
              </g>
            )
          })}

        {/* Ghost pin array (#…): a faint 2.54mm grid centred on the selected pin,
            so nearby pins snap to it and a drag-from-it lays down a row of pins. */}
        {interactive && selPin && visible.pins && !locked.pins && (
          <g className="pcv__ghosts" aria-hidden="true" style={{ pointerEvents: 'none' }}>
            {([1, 2, 3, 4] as const).flatMap((k) => {
              const opacity = 0.34 * (1 - (k - 1) * 0.2) // fades out further from centre
              const spots = [
                { x: selPin.x + k * stepNX, y: selPin.y },
                { x: selPin.x - k * stepNX, y: selPin.y },
                { x: selPin.x, y: selPin.y + k * stepNY },
                { x: selPin.x, y: selPin.y - k * stepNY }
              ]
              return spots
                .filter((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)
                .map((s, j) => (
                  <circle key={`g${k}-${j}`} cx={px(s.x)} cy={py(s.y)} r={5} fill="#d6a531" opacity={opacity} />
                ))
            })}
          </g>
        )}

        {/* Live preview of the pins a "drag from the selected pin" will create. */}
        {interactive && selPin && createPreview && (
          <g className="pcv__create-preview" aria-hidden="true" style={{ pointerEvents: 'none' }}>
            {Array.from({ length: createPreview.n }, (_, i) => i + 1).map((k) => {
              const x = createPreview.axis === 'x' ? selPin.x + createPreview.dir * k * stepNX : selPin.x
              const y = createPreview.axis === 'y' ? selPin.y + createPreview.dir * k * stepNY : selPin.y
              if (x < 0 || x > 1 || y < 0 || y > 1) return null
              return <circle key={`cp${k}`} cx={px(x)} cy={py(y)} r={6} fill="#d6a531" stroke="#fff" strokeWidth={1.2} opacity={0.85} />
            })}
          </g>
        )}

        {/* Multi-select: rings on the selected pins + the rubber-band box. */}
        {interactive &&
          selectedPins.length > 0 &&
          selectedResolved().map((s) => (
            <circle key={`sel-${s.hi}-${s.pi}`} cx={px(s.x)} cy={py(s.y)} r={9} className="pcv__sel-ring" />
          ))}
        {interactive && marquee && (
          <rect
            x={px(Math.min(marquee.x0, marquee.x1))}
            y={py(Math.min(marquee.y0, marquee.y1))}
            width={Math.abs(marquee.x1 - marquee.x0) * box.w}
            height={Math.abs(marquee.y1 - marquee.y0) * box.h}
            className="pcv__marquee"
          />
        )}

        {/* Smart alignment guides (#169): green centre-lines while dragging. */}
        {interactive && guides && (
          <g className="pcv__guides" style={{ pointerEvents: 'none' }}>
            {guides.x !== undefined && (
              <line x1={px(guides.x)} y1={box.y} x2={px(guides.x)} y2={box.y + box.h} className="pcv__guide" />
            )}
            {guides.y !== undefined && (
              <line x1={box.x} y1={py(guides.y)} x2={box.x + box.w} y2={py(guides.y)} className="pcv__guide" />
            )}
          </g>
        )}

        {/* Hover badges (#…): the hovered pin's capabilities, in pastel chips. */}
        {interactive &&
          hoverPin &&
          !dragRef.current &&
          (() => {
            const rp = pins.find((p) => p.hi === hoverPin.hi && p.pi === hoverPin.pi)
            if (!rp) return null
            return capabilityBadges(px(rp.x), py(rp.y), rp.pin.capabilities)
          })()}

        {/* Layer 4a: legacy feature chips (read-only; migrated to shapes on edit) */}
        {visible.components &&
          features.map((f, i) => (
            <g key={`f${i}`} style={{ pointerEvents: 'none' }}>
              <rect x={px(f.x)} y={py(f.y)} width={f.w * box.w} height={f.h * box.h} rx={3} fill="#1c2227" stroke="#0006" />
              <text x={px(f.x) + (f.w * box.w) / 2} y={py(f.y) + (f.h * box.h) / 2} className="pcv__feat-label">
                {f.label}
              </text>
            </g>
          ))}

        {/* Layer 4b/4c: shapes + text labels, drawn in one unified z-order so they
            can be stacked (top of the Components list = highest z = drawn last). */}
        {visible.components &&
          orderedComponents(part).map((c) => {
            if (c.kind === 'label') {
              const i = c.index
              const l = labels[i]
              return (
                <text key={`l${i}`} x={px(l.x)} y={py(l.y)} className="pcv__label" fontSize={l.fontSize ?? 12} fill={isSel({ type: 'label', index: i }) ? '#fff' : 'var(--text, #e9edf1)'} textAnchor="middle">
                  {l.text}
                </text>
              )
            }
            const i = c.index
            const s = shapes[i]
            const sel = isSel({ type: 'shape', index: i }) || selection?.type === 'shape-vertex'
            const fill = s.fill ?? DEFAULT_SHAPE_FILL
            const stroke = sel && isSel({ type: 'shape', index: i }) ? '#4ea1ff' : (s.stroke ?? DEFAULT_SHAPE_STROKE)
            const sw = (s.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH) + (isSel({ type: 'shape', index: i }) ? 1.5 : 0)
            let el: JSX.Element
            let lcx: number
            let lcy: number
            if (s.kind === 'circle') {
              const r = (s.r ?? 0.08) * box.w
              el = <circle cx={px(s.x)} cy={py(s.y)} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
              lcx = px(s.x)
              lcy = py(s.y)
            } else if (s.kind === 'polygon') {
              const pts = s.points ?? []
              el = <polygon points={pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} />
              lcx = pts.length ? px(pts.reduce((a, p) => a + p.x, 0) / pts.length) : px(s.x)
              lcy = pts.length ? py(pts.reduce((a, p) => a + p.y, 0) / pts.length) : py(s.y)
            } else {
              const w = (s.w ?? 0.2) * box.w
              const h = (s.h ?? 0.15) * box.h
              el = <rect x={px(s.x)} y={py(s.y)} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={sw} />
              lcx = px(s.x) + w / 2
              lcy = py(s.y) + h / 2
            }
            return (
              <g key={`s${i}`}>
                {el}
                {s.label && (
                  <text x={lcx} y={lcy} className="pcv__feat-label">
                    {s.label}
                  </text>
                )}
              </g>
            )
          })}

        {/* Selection chrome: image box + handles */}
        {interactive && selection?.type === 'image' && visible.image && !locked.image && part.imageData && (
          <g>
            <rect x={px(layer.x)} y={py(layer.y)} width={layer.w * box.w} height={layer.h * box.h} fill="none" stroke="#4ea1ff" strokeDasharray="4 3" strokeWidth={1.5} />
            {[
              [layer.x, layer.y],
              [layer.x + layer.w, layer.y],
              [layer.x + layer.w, layer.y + layer.h],
              [layer.x, layer.y + layer.h]
            ].map(([hx, hy], c) => (
              <rect key={c} x={px(hx) - 5} y={py(hy) - 5} width={10} height={10} fill="#4ea1ff" stroke="#fff" />
            ))}
          </g>
        )}

        {/* Board polygon vertex handles (shape tool) */}
        {interactive &&
          tool === 'shape' &&
          !locked.image &&
          usePolygon &&
          (part.polygon ?? []).map((p, i) => (
            <rect key={`v${i}`} x={px(p.x) - 5} y={py(p.y) - 5} width={10} height={10} fill={isSel({ type: 'vertex', index: i }) ? '#fff' : '#4ea1ff'} stroke="#0008" />
          ))}

        {/* Component-polygon vertex handles (a polygon shape is selected) */}
        {interactive &&
          !locked.components &&
          (selection?.type === 'shape' || selection?.type === 'shape-vertex') &&
          shapes[selection.index]?.kind === 'polygon' &&
          (shapes[selection.index].points ?? []).map((p, vi) => (
            <rect
              key={`sv${vi}`}
              x={px(p.x) - 5}
              y={py(p.y) - 5}
              width={10}
              height={10}
              fill={isSel({ type: 'shape-vertex', index: selection.index, vi }) ? '#fff' : '#4ea1ff'}
              stroke="#0008"
            />
          ))}
      </g>
    </svg>
  )

  return (
    <div className="pcv__wrap">
      {svg}
      {/* Alignment toolbar — floats above the LAST selected pin (≥2 selected). */}
      {interactive &&
        selectedPins.length >= 2 &&
        (() => {
          const anchor = alignAnchorPx()
          const style = anchor
            ? { left: `${anchor.left}px`, top: `${anchor.top}px`, transform: 'translate(-50%, calc(-100% - 14px))' }
            : undefined
          return (
            <div className="pcv__align" role="toolbar" aria-label="Align pins" style={style}>
              <span className="pcv__align-count">{selectedPins.length}</span>
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('left')} title="Align left edges">
                {alignIcon('left')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('centerX')} title="Align horizontal centres">
                {alignIcon('centerX')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('right')} title="Align right edges">
                {alignIcon('right')}
              </button>
              <span className="pcv__align-sep" />
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('top')} title="Align top edges">
                {alignIcon('top')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('centerY')} title="Align vertical centres">
                {alignIcon('centerY')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => alignSelected('bottom')} title="Align bottom edges">
                {alignIcon('bottom')}
              </button>
              <span className="pcv__align-sep" />
              <button type="button" className="pcv__align-btn" onClick={() => distributeSelected('x')} title="Distribute horizontally" disabled={selectedPins.length < 3}>
                {alignIcon('distX')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => distributeSelected('y')} title="Distribute vertically" disabled={selectedPins.length < 3}>
                {alignIcon('distY')}
              </button>
            </div>
          )
        })()}
      {interactive && (
        <div className="pcv__zoom" aria-label="View controls">
          {onToggleGrid && (
            <button
              type="button"
              className={`pcv__zoom-btn${showGrid ? ' is-active' : ''}`}
              onClick={onToggleGrid}
              title={`${showGrid ? 'Hide' : 'Show'} the ${spacing}mm grid`}
              aria-label="Toggle grid"
              aria-pressed={showGrid}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M1.5 6h13M1.5 10h13M6 1.5v13M10 1.5v13" />
                </g>
              </svg>
            </button>
          )}
          {onToggleSnap && (
            <button
              type="button"
              className={`pcv__zoom-btn${snap ? ' is-active' : ''}`}
              onClick={onToggleSnap}
              title={`Snap to the grid: ${snap ? 'on' : 'off'}`}
              aria-label="Toggle snap to grid"
              aria-pressed={snap}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4 2v6a4 4 0 0 0 8 0V2h-2.5v6a1.5 1.5 0 0 1-3 0V2z" fill="currentColor" />
              </svg>
            </button>
          )}
          <span className="pcv__zoom-sep" />
          <button type="button" className="pcv__zoom-btn" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <span className="pcv__zoom-pct">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="pcv__zoom-btn" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
            +
          </button>
          <button type="button" className="pcv__zoom-btn" onClick={() => setView({ tx: 0, ty: 0, scale: 1 })} title="Reset view" aria-label="Reset view">
            ⤢
          </button>
        </div>
      )}
    </div>
  )
}

export { derivePinPosition }
