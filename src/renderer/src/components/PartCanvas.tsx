import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'
import {
  DEFAULT_SHAPE_CORNER,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_SHAPE_STROKE_WIDTH,
  addComponentOnTop,
  captureStyle,
  collectUsedColors,
  derivePinPosition,
  dissolveGroup,
  groupMembers,
  groupRootId,
  groupTreeIds,
  insertPolygonPoint,
  nearestCenter,
  nearestPolygonEdge,
  nextComponentZ,
  orderedItems,
  pasteStyle,
  pinShapeOf,
  resolvedPins,
  type GroupMemberRef,
  type PartStyleClipboard,
  type ResolvedPin,
  type StyleTarget
} from './part-editor.util'
import type {
  ComponentShape,
  ComponentShapeKind,
  MountingHole,
  PartDefinition,
  PartLabel,
  PartPin,
  PartPinType,
  TextAlign
} from '../../../shared/part'
import { boxedPinLabel, capabilityChips, castellatedPad, componentLabelTransform, connectorGlyph, connectorLabel, connectorSize, octagonalPad, onboardLedGlyph, onboardLedLabel, partButtonGlyph, PART_BUTTON_SIZE, pinOutwardDir, pinThroughHoles, styledText } from './part-body'
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

/** Label the grid-mode modifier by platform: ⌘ on macOS, Ctrl elsewhere. Both
 *  are handled (`e.metaKey || e.ctrlKey`); this just shows the native key. */
const cmdOrCtrlLabel =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl'

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
  | 'servo-header'
  | 'hole'
  | 'button'
  | 'text'
  | 'rect'
  | 'circle'
  | 'cpoly'
  | 'erasebg'

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
  | { type: 'button'; index: number }
  | { type: 'led'; index: number }
  | { type: 'connector'; index: number }
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
  /** A request to select a whole group by id (from the Layers panel) — the
   *  `nonce` makes repeat selects of the same group re-fire the effect (#631). */
  groupSelect?: { id: string; nonce: number }
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
  /** Erase-background click: the pointer landed on the image at normalised board
   *  coords (nx, ny) while the `erasebg` tool is active. The editor maps it to an
   *  image pixel and flood-fills the background there. */
  onEraseImageAt?: (nx: number, ny: number) => void
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
 * Group / ungroup icon (#629): a rounded frame with four corner ticks (the classic
 * "selection group" glyph). The ungroup variant dashes the frame so it reads as
 * "break apart".
 */
function groupIcon(ungroup: boolean): JSX.Element {
  const tick = (x: number, y: number, dx: number, dy: number): JSX.Element => (
    <path
      key={`${x},${y}`}
      d={`M ${x + dx} ${y} L ${x} ${y} L ${x} ${y + dy}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  )
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect
        x={3}
        y={3}
        width={10}
        height={10}
        rx={1.4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={0.5}
        strokeDasharray={ungroup ? '2 1.6' : undefined}
      />
      {tick(2, 2, 2.2, 2.2)}
      {tick(14, 2, -2.2, 2.2)}
      {tick(2, 14, 2.2, -2.2)}
      {tick(14, 14, -2.2, -2.2)}
    </svg>
  )
}

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
  kind:
    | 'move-obj'
    | 'move-group'
    | 'move-label'
    | 'pan'
    | 'resize-image'
    | 'resize-shape'
    | 'move-vertex'
    | 'move-shape-vertex'
    | 'create-array'
    | 'servo-strip'
    | 'marquee'
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
  /** When the dragged pin belongs to a servo-header group, the offsets of every
   *  group pin from the dragged one — so the whole trio moves rigidly as a unit. */
  groupOffsets?: { hi: number; pi: number; dx: number; dy: number }[]
  /** A `move-group` drag: every member's offset from the pointer's start, so the
   *  whole group tree (pins + shapes + labels, recursive) moves rigidly (#630). */
  groupBundle?: {
    pins: { hi: number; pi: number; dx: number; dy: number }[]
    shapes: { index: number; dx: number; dy: number }[]
    labels: { index: number; dx: number; dy: number }[]
  }
}

export function PartCanvas({
  part,
  visible: visibleProp,
  locked = DEFAULT_LOCKS,
  showGrid = false,
  readOnly = false,
  tool = 'select',
  selection = null,
  groupSelect,
  snap = false,
  lockAspect = false,
  imageNativeAspect = null,
  onChange,
  onSelect,
  onNotify,
  onEraseImageAt,
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
  // Ctrl/Cmd held = "grid mode": show the selected pin's 2.54mm row/column and let
  // a drag from it lay pins (anchor locked). Without it, a pin drag just moves it.
  const [gridKey, setGridKey] = useState(false)
  // Live preview of the pins a "drag from the selected pin" gesture will create.
  const [createPreview, setCreatePreview] = useState<{ axis: 'x' | 'y'; dir: number; n: number } | null>(null)
  // Live count while dragging out a servo-header strip (start pad + how many).
  const [stripPreview, setStripPreview] = useState<{ x: number; y: number; n: number } | null>(null)
  // Multi-select of pins (marquee / shift-click) for the alignment toolbar.
  const [selectedPins, setSelectedPins] = useState<{ hi: number; pi: number }[]>([])
  // Multi-select of components (shapes + labels) — same marquee / shift-click
  // gesture, same alignment toolbar.
  const [selComponents, setSelComponents] = useState<{ type: 'shape' | 'label'; index: number }[]>([])
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // Smart alignment guides (#169): green center-lines shown while dragging a pin /
  // hole that lines up with another's centre. Normalised x (vertical line) / y.
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null)
  // The selected-component toolbar's border dropdown (width + colour).
  const [borderMenuOpen, setBorderMenuOpen] = useState(false)
  const [fillMenuOpen, setFillMenuOpen] = useState(false)
  const [textMenuOpen, setTextMenuOpen] = useState(false)
  // The selected mounting hole's size (diameter) dropdown.
  const [holeMenuOpen, setHoleMenuOpen] = useState(false)
  // Per-type "style clipboard" (copy style / paste style). State (not a ref) so a
  // copy re-renders the toolbars and enables their "Paste style" button. Persists
  // across selections + part switches within a session.
  const [styleClip, setStyleClip] = useState<PartStyleClipboard | null>(null)
  // Index of the shape whose caption is being edited inline (double-click), or null.
  const [editLabelIdx, setEditLabelIdx] = useState<number | null>(null)
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
  const buttons = part.buttons ?? []
  const onboardLeds = part.onboardLeds ?? []
  const connectors = part.connectors ?? []
  const features = part.features ?? [] // legacy chips (read-only; migrated on edit)
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54
  const interactive = !readOnly && !!onChange

  // Track Ctrl/Cmd so the alignment grid shows only WHILE it's held (grid mode).
  useEffect(() => {
    if (!interactive) return
    const sync = (e: KeyboardEvent): void => setGridKey(e.ctrlKey || e.metaKey)
    const clear = (): void => setGridKey(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [interactive])

  const layer = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }
  // Colours already used in this part, for the quick-pick swatch grids on every
  // colour well (fill / border / label). Deduped, in first-seen order.
  const usedColors = collectUsedColors(part)

  // --- geometry helpers -----------------------------------------------------
  const px = (nx: number): number => box.x + nx * box.w
  const py = (ny: number): number => box.y + ny * box.h
  // Board px-per-mm (from real dimensions) so physical parts like JST/QWIIC
  // connectors draw life-size; 0 when the part has no mm dimensions (legacy size).
  const connPxPerMm = part.dimensions && part.dimensions.width > 0 ? box.w / part.dimensions.width : 0
  // The fixed pad + number-box + label sizes were tuned for a comfortable pin
  // pitch. On a dense/large board they render tighter than those fixed sizes, so
  // the holes, number boxes and labels overlap. `pinScale` shrinks them together
  // when the pitch is tight, and is 1 at a comfortable pitch so normal boards are
  // unchanged (#…). PIN_PITCH_REF ≈ the gap (px) the fixed 14px number-box wants.
  const PIN_PITCH_REF = 21
  // The nominal pitch (mm-pitch × px-per-mm) OVERESTIMATES the real room: pins are
  // often packed tighter than the nominal pinSpacing (e.g. the Servo 2040's 3-pin
  // servo clusters render ~9px apart, under the nominal 2.54mm ≈ 12px), so drive
  // the scale off the ACTUAL tightest centre-to-centre gap between rendered pins.
  const nominalPitchPx = connPxPerMm > 0 ? spacing * connPxPerMm : 0
  let minPinGapPx = Infinity
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = Math.hypot((pins[i].x - pins[j].x) * box.w, (pins[i].y - pins[j].y) * box.h)
      if (d > 0.5 && d < minPinGapPx) minPinGapPx = d
    }
  }
  const pitchPx = Number.isFinite(minPinGapPx)
    ? nominalPitchPx > 0
      ? Math.min(minPinGapPx, nominalPitchPx)
      : minPinGapPx
    : nominalPitchPx
  const pinScale = pitchPx > 0 ? Math.max(0.25, Math.min(1, pitchPx / PIN_PITCH_REF)) : 1
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
    kind: 'pin' | 'hole' | 'button',
    exclude: { hi?: number; pi?: number; index?: number },
    off: boolean
  ): { x: number; y: number; gx?: number; gy?: number } => {
    if (off) return { x: snapX(nx), y: snapY(ny) }
    const centres =
      kind === 'pin'
        ? pins.filter((p) => !(p.hi === exclude.hi && p.pi === exclude.pi)).map((p) => ({ x: p.x, y: p.y }))
        : kind === 'hole'
          ? holes.filter((_, i) => i !== exclude.index).map((h) => ({ x: h.x, y: h.y }))
          : buttons.filter((_, i) => i !== exclude.index).map((b) => ({ x: b.x, y: b.y }))
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
  /** Move an on-board button (#130) — buttons may sit anywhere, incl. over pins. */
  const moveButtonTo = (index: number, nx: number, ny: number, presnapped = false): void => {
    const sx = presnapped ? nx : snapX(nx)
    const sy = presnapped ? ny : snapY(ny)
    commit({ ...part, buttons: buttons.map((b, i) => (i === index ? { ...b, x: sx, y: sy } : b)) })
  }
  /** Move an onboard LED (anywhere on the board; snapped to the grid). */
  const moveLedTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      onboardLeds: onboardLeds.map((l, i) => (i === index ? { ...l, x: snapX(nx), y: snapY(ny) } : l))
    })
  }
  /** Move a connector (anywhere on the board; snapped to the grid). */
  const moveConnectorTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      connectors: connectors.map((c, i) => (i === index ? { ...c, x: snapX(nx), y: snapY(ny) } : c))
    })
  }
  /** Set a pin's manual label offset (a fraction of the board box); undefined near
   *  zero so a label dragged back home reverts to the default. */
  const setLabelOffset = (hi: number, pi: number, x: number, y: number): void => {
    const off = Math.abs(x) < 0.004 && Math.abs(y) < 0.004 ? undefined : { x, y }
    commit({
      ...part,
      headers: part.headers.map((h, i) =>
        i === hi ? { ...h, pins: h.pins.map((p, j) => (j === pi ? { ...p, labelOffset: off } : p)) } : h
      )
    })
  }
  /** Begin dragging a pin's label annotation (manual placement). The label element
   *  is the drag target; the svg's pointermove/up drive it via `move-label`. */
  const startLabelDrag = (e: ReactPointerEvent, rp: ResolvedPin): void => {
    if (!interactive || locked.pins) return
    e.stopPropagation()
    svgRef.current?.setPointerCapture?.(e.pointerId)
    const { nx, ny } = toNorm(e)
    const lo = rp.pin.labelOffset ?? { x: 0, y: 0 }
    dragRef.current = {
      kind: 'move-label',
      sel: { type: 'pin', hi: rp.hi, pi: rp.pi },
      startNX: nx,
      startNY: ny,
      ox: lo.x,
      oy: lo.y
    }
    onSelect?.({ type: 'pin', hi: rp.hi, pi: rp.pi })
  }
  /** Set an onboard-LED / connector label's manual offset (a fraction of the board
   *  box); undefined near zero so a label dragged home reverts to the default. */
  const setCompLabelOffset = (
    target: { type: 'led' | 'connector'; index: number },
    x: number,
    y: number
  ): void => {
    const off = Math.abs(x) < 0.004 && Math.abs(y) < 0.004 ? undefined : { x, y }
    if (target.type === 'led') {
      commit({
        ...part,
        onboardLeds: (part.onboardLeds ?? []).map((l, i) =>
          i === target.index ? { ...l, labelOffset: off } : l
        )
      })
    } else {
      commit({
        ...part,
        connectors: (part.connectors ?? []).map((c, i) =>
          i === target.index ? { ...c, labelOffset: off } : c
        )
      })
    }
  }
  /** Begin dragging an LED/connector silk label to a hand-placed spot. */
  const startCompLabelDrag = (
    e: ReactPointerEvent,
    sel: { type: 'led' | 'connector'; index: number },
    curOffset?: { x: number; y: number }
  ): void => {
    if (!interactive || locked.components) return
    e.stopPropagation()
    svgRef.current?.setPointerCapture?.(e.pointerId)
    const { nx, ny } = toNorm(e)
    const lo = curOffset ?? { x: 0, y: 0 }
    dragRef.current = { kind: 'move-label', sel, startNX: nx, startNY: ny, ox: lo.x, oy: lo.y }
    onSelect?.(sel)
  }
  const moveShapeTo = (index: number, nx: number, ny: number, presnapped = false): void => {
    const sx = presnapped ? nx : snapX(nx)
    const sy = presnapped ? ny : snapY(ny)
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
  // Resize a rect / circle shape (#175). Rect: new box; circle: new radius.
  const resizeRectShape = (index: number, x: number, y: number, w: number, h: number): void =>
    commit({ ...part, shapes: shapes.map((s, i) => (i === index ? { ...s, x, y, w, h } : s)) })
  const resizeCircleShape = (index: number, r: number): void =>
    commit({ ...part, shapes: shapes.map((s, i) => (i === index ? { ...s, r } : s)) })

  /** Candidate snap lines (pins, holes + other shapes' edges/centres) for the
   *  dynamic guides while resizing a shape (#175). */
  const shapeSnapLines = (excludeIndex: number): { xs: number[]; ys: number[] } => {
    const xs: number[] = []
    const ys: number[] = []
    for (const p of pins) {
      xs.push(p.x)
      ys.push(p.y)
    }
    for (const h of holes) {
      xs.push(h.x)
      ys.push(h.y)
    }
    shapes.forEach((s, i) => {
      if (i === excludeIndex) return
      if (s.kind === 'rect') {
        xs.push(s.x, s.x + (s.w ?? 0))
        ys.push(s.y, s.y + (s.h ?? 0))
      } else if (s.kind === 'circle') {
        xs.push(s.x)
        ys.push(s.y)
      }
    })
    return { xs, ys }
  }

  const moveShapeVertexTo = (index: number, vi: number, nx: number, ny: number): void => {
    commit({
      ...part,
      shapes: shapes.map((s, i) =>
        i === index ? { ...s, points: (s.points ?? []).map((p, j) => (j === vi ? { x: clamp01(nx), y: clamp01(ny) } : p)) } : s
      )
    })
  }
  const moveLabelTo = (index: number, nx: number, ny: number, presnapped = false): void => {
    const sx = presnapped ? nx : snapX(nx)
    const sy = presnapped ? ny : snapY(ny)
    commit({ ...part, labels: labels.map((l, i) => (i === index ? { ...l, x: sx, y: sy } : l)) })
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

  /** One servo/DuPont header trio at (sx, sy): a vertical Signal / V+ / GND stack at
   *  the 2.54mm pitch, octagonal pads, the V+/GND rows power/ground + label-hidden,
   *  all sharing `gid` so they move + delete as one unit. */
  const servoTrio = (sx: number, sy: number, gid: string, idx: number): PartPin[] => [
    { name: `S${idx}`, type: 'io', capabilities: ['digital', 'pwm'], shape: 'octagonal', rotation: 270, group: gid, x: sx, y: sy },
    { name: `V${idx}`, type: 'pwr', shape: 'octagonal', labelHidden: true, group: gid, x: sx, y: clamp01(sy + stepNY) },
    { name: `G${idx}`, type: 'gnd', shape: 'octagonal', labelHidden: true, group: gid, x: sx, y: clamp01(sy + 2 * stepNY) }
  ]

  /** Drop `n` pre-wired servo headers in a row starting at (nx, ny), spaced one pin
   *  pitch apart along x (n = 1 for a plain click; more for a drag-strip). The
   *  signals' GPIOs are left for the user to set. */
  const addServoHeaders = (nx: number, ny: number, n = 1): void => {
    const sx = snapX(nx)
    const sy = snapY(ny)
    if (inHole(sx, sy)) {
      onNotify?.("Can't place a servo header on a mounting hole.")
      return
    }
    const groups = new Set<string>()
    for (const h of part.headers) for (const p of h.pins) if (p.group) groups.add(p.group)
    let idx = groups.size
    const trios: PartPin[] = []
    for (let k = 0; k < Math.max(1, n); k++) {
      idx += 1
      trios.push(...servoTrio(clamp01(sx + k * stepNX), sy, `servo-${idx}`, idx))
    }
    const headers = part.headers.length ? part.headers : [{ edge: 'left' as const, pins: [] }]
    commit({ ...part, headers: headers.map((h, i) => (i === 0 ? { ...h, pins: [...h.pins, ...trios] } : h)) })
    onSelect?.({ type: 'pin', hi: 0, pi: headers[0].pins.length }) // select the first signal
  }

  /** Move every pin of a group rigidly: the dragged pin snaps to (baseX, baseY) and
   *  the rest follow by their captured offsets — so a servo header stays intact. */
  const moveGroupTo = (offsets: { hi: number; pi: number; dx: number; dy: number }[], baseX: number, baseY: number): void => {
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const o = offsets.find((off) => off.hi === hi && off.pi === pi)
          return o ? { ...p, x: clamp01(baseX + o.dx), y: clamp01(baseY + o.dy) } : p
        })
      }))
    })
  }

  /** Move a whole group tree (pins + shapes + labels) rigidly, each member placed
   *  at `base + its captured offset`. One commit so undo treats it as one move. */
  const moveGroupBundleTo = (bundle: NonNullable<Drag['groupBundle']>, baseX: number, baseY: number): void => {
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const o = bundle.pins.find((off) => off.hi === hi && off.pi === pi)
          return o ? { ...p, x: clamp01(baseX + o.dx), y: clamp01(baseY + o.dy) } : p
        })
      })),
      shapes: shapes.map((s, i) => {
        const o = bundle.shapes.find((off) => off.index === i)
        return o ? translateShape(s, baseX + o.dx - s.x, baseY + o.dy - s.y) : s
      }),
      labels: labels.map((l, i) => {
        const o = bundle.labels.find((off) => off.index === i)
        return o ? { ...l, x: clamp01(baseX + o.dx), y: clamp01(baseY + o.dy) } : l
      })
    })
  }

  // --- multi-select + alignment (#…) ----------------------------------------
  const pinKey = (hi: number, pi: number): string => `${hi}-${pi}`
  const toggleSelectedPin = (hi: number, pi: number): void =>
    setSelectedPins((cur) =>
      cur.some((s) => s.hi === hi && s.pi === pi) ? cur.filter((s) => !(s.hi === hi && s.pi === pi)) : [...cur, { hi, pi }]
    )

  const selectedResolved = (): { hi: number; pi: number; x: number; y: number }[] =>
    selectedPins
      .map((s) => {
        const rp = pins.find((p) => p.hi === s.hi && p.pi === s.pi)
        return rp ? { hi: s.hi, pi: s.pi, x: rp.x, y: rp.y } : null
      })
      .filter((v): v is { hi: number; pi: number; x: number; y: number } => v !== null)

  // The alignment toolbar aligns a UNION of selected pins + components. Each is
  // resolved to a normalised centre (cx, cy); pins/labels move to absolute
  // targets, shapes translate by the delta (so polygon points come along too).
  type AlignRef =
    | { kind: 'pin'; hi: number; pi: number }
    | { kind: 'shape'; index: number }
    | { kind: 'label'; index: number }

  /** Geometric centre of a shape/label in normalised coords. */
  const componentCenter = (type: 'shape' | 'label', index: number): { cx: number; cy: number } | null => {
    if (type === 'label') {
      const l = labels[index]
      return l ? { cx: l.x, cy: l.y } : null
    }
    const s = shapes[index]
    if (!s) return null
    if (s.kind === 'circle') return { cx: s.x, cy: s.y }
    if (s.kind === 'polygon' && s.points?.length) {
      const xs = s.points.map((p) => p.x)
      const ys = s.points.map((p) => p.y)
      return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 }
    }
    return { cx: s.x + (s.w ?? 0.2) / 2, cy: s.y + (s.h ?? 0.15) / 2 }
  }

  /** Smart-alignment for a dragged component (#169, extended from pins/holes):
   *  snap the component's CENTRE to the nearest other item's centre (pins, holes
   *  and the OTHER components), returning the chosen centre + the guide lines to
   *  draw. `off` (Ctrl/Cmd) disables alignment but keeps the grid snap. */
  const alignComponentDrag = (
    cx: number,
    cy: number,
    exclude: { kind: 'shape' | 'label'; index: number },
    off: boolean
  ): { cx: number; cy: number; gx?: number; gy?: number } => {
    if (off) return { cx: snapX(cx), cy: snapY(cy) }
    const centres: { x: number; y: number }[] = []
    pins.forEach((p) => centres.push({ x: p.x, y: p.y }))
    holes.forEach((h) => centres.push({ x: h.x, y: h.y }))
    shapes.forEach((_, i) => {
      if (exclude.kind === 'shape' && i === exclude.index) return
      const c = componentCenter('shape', i)
      if (c) centres.push({ x: c.cx, y: c.cy })
    })
    labels.forEach((_, i) => {
      if (exclude.kind === 'label' && i === exclude.index) return
      const c = componentCenter('label', i)
      if (c) centres.push({ x: c.cx, y: c.cy })
    })
    const gx = nearestCenter(centres.map((c) => c.x), cx, box.w, ALIGN_PX)
    const gy = nearestCenter(centres.map((c) => c.y), cy, box.h, ALIGN_PX)
    return { cx: gx ?? snapX(cx), cy: gy ?? snapY(cy), gx: gx ?? undefined, gy: gy ?? undefined }
  }

  /** All selected items (pins + components) resolved to a centre + a ref. */
  const allAlignItems = (): { ref: AlignRef; cx: number; cy: number }[] => {
    const out: { ref: AlignRef; cx: number; cy: number }[] = []
    for (const s of selectedPins) {
      const rp = pins.find((p) => p.hi === s.hi && p.pi === s.pi)
      if (rp) out.push({ ref: { kind: 'pin', hi: s.hi, pi: s.pi }, cx: rp.x, cy: rp.y })
    }
    for (const c of selComponents) {
      const ctr = componentCenter(c.type, c.index)
      if (ctr) out.push({ ref: { kind: c.type, index: c.index }, cx: ctr.cx, cy: ctr.cy })
    }
    return out
  }

  /** Translate a shape (incl. polygon points) by a normalised delta. */
  const translateShape = (s: ComponentShape, dx: number, dy: number): ComponentShape => ({
    ...s,
    x: clamp01(s.x + dx),
    y: clamp01(s.y + dy),
    points: s.points?.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) }))
  })

  /** Apply per-item axis targets: pins/labels set absolute, shapes translate. */
  const commitAlignment = (targets: { ref: AlignRef; tcx?: number; tcy?: number }[]): void => {
    const pinSet = new Map<string, { x?: number; y?: number }>()
    const labelSet = new Map<number, { x?: number; y?: number }>()
    const shapeDelta = new Map<number, { dx: number; dy: number }>()
    for (const t of targets) {
      if (t.ref.kind === 'pin') pinSet.set(pinKey(t.ref.hi, t.ref.pi), { x: t.tcx, y: t.tcy })
      else if (t.ref.kind === 'label') labelSet.set(t.ref.index, { x: t.tcx, y: t.tcy })
      else {
        const c = componentCenter('shape', t.ref.index)
        shapeDelta.set(t.ref.index, {
          dx: t.tcx !== undefined ? t.tcx - (c?.cx ?? 0) : 0,
          dy: t.tcy !== undefined ? t.tcy - (c?.cy ?? 0) : 0
        })
      }
    }
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const u = pinSet.get(pinKey(hi, pi))
          return u ? { ...p, ...(u.x !== undefined ? { x: u.x } : {}), ...(u.y !== undefined ? { y: u.y } : {}) } : p
        })
      })),
      shapes: shapes.map((s, i) => {
        const d = shapeDelta.get(i)
        return d ? translateShape(s, d.dx, d.dy) : s
      }),
      labels: labels.map((l, i) => {
        const u = labelSet.get(i)
        return u ? { ...l, ...(u.x !== undefined ? { x: clamp01(u.x) } : {}), ...(u.y !== undefined ? { y: clamp01(u.y) } : {}) } : l
      })
    })
  }

  const alignSelected = (mode: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'): void => {
    const sel = allAlignItems()
    if (sel.length < 2) return
    const horiz = mode === 'left' || mode === 'right' || mode === 'centerX'
    const vals = sel.map((s) => (horiz ? s.cx : s.cy))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    // left/top → min edge, right/bottom → max edge, centerX/centerY → midpoint.
    const target = mode === 'left' || mode === 'top' ? min : mode === 'right' || mode === 'bottom' ? max : (min + max) / 2
    commitAlignment(sel.map((s) => ({ ref: s.ref, tcx: horiz ? target : undefined, tcy: horiz ? undefined : target })))
  }

  const distributeSelected = (axis: 'x' | 'y'): void => {
    const sel = allAlignItems()
    if (sel.length < 3) return // ≥3 to space evenly (2 are already "distributed")
    const sorted = [...sel].sort((a, b) => (axis === 'x' ? a.cx - b.cx : a.cy - b.cy))
    const min = axis === 'x' ? sorted[0].cx : sorted[0].cy
    const max = axis === 'x' ? sorted[sorted.length - 1].cx : sorted[sorted.length - 1].cy
    const step = (max - min) / (sorted.length - 1)
    commitAlignment(
      sorted.map((s, i) => (axis === 'x' ? { ref: s.ref, tcx: min + i * step } : { ref: s.ref, tcy: min + i * step }))
    )
  }

  /** Total count of items in the alignment multi-selection (pins + components). */
  const alignCount = selectedPins.length + selComponents.length

  // ── Grouping (#629) ──────────────────────────────────────────────────────
  // Membership is by a `group` id stored on each item (pin/shape/label); the
  // optional `groups` registry on the part records nesting (`parent`) + names,
  // so a group survives re-ordering (ids, not indices).

  const mkGroupId = (): string => `grp-${Math.random().toString(36).slice(2, 9)}`

  /** The `group` id of each currently-selected item (undefined = loose). */
  const selectionGroupIds = (): (string | undefined)[] => {
    const out: (string | undefined)[] = []
    for (const s of selectedPins) out.push(part.headers[s.hi]?.pins[s.pi]?.group)
    for (const c of selComponents)
      out.push(c.type === 'shape' ? shapes[c.index]?.group : labels[c.index]?.group)
    return out
  }

  /** If every selected item shares one non-empty group, that group id — else null. */
  const selectionGroup = (): string | null => {
    const ids = selectionGroupIds()
    if (!ids.length || !ids[0]) return null
    return ids.every((g) => g === ids[0]) ? (ids[0] as string) : null
  }

  /** Group the current multi-selection: loose items join a new group; any item
   *  that already belongs to a group nests that group's whole tree inside it. */
  const groupSelection = (): void => {
    if (alignCount < 2) return
    const gid = mkGroupId()
    const nestRoots = new Set<string>()
    const noteExisting = (g: string | undefined): void => {
      if (!g) return
      const root = groupRootId(part.groups, g)
      if (root && root !== gid) nestRoots.add(root)
    }
    const pinSel = (hi: number, pi: number): boolean =>
      selectedPins.some((s) => s.hi === hi && s.pi === pi)
    const compSel = (type: 'shape' | 'label', index: number): boolean =>
      selComponents.some((c) => c.type === type && c.index === index)

    const nextHeaders = part.headers.map((h, hi) => ({
      ...h,
      pins: h.pins.map((p, pi) => {
        if (!pinSel(hi, pi)) return p
        if (p.group) {
          noteExisting(p.group)
          return p
        }
        return { ...p, group: gid }
      })
    }))
    const nextShapes = shapes.map((s, i) => {
      if (!compSel('shape', i)) return s
      if (s.group) {
        noteExisting(s.group)
        return s
      }
      return { ...s, group: gid }
    })
    const nextLabels = labels.map((l, i) => {
      if (!compSel('label', i)) return l
      if (l.group) {
        noteExisting(l.group)
        return l
      }
      return { ...l, group: gid }
    })
    const registry = (part.groups ?? []).map((g) =>
      nestRoots.has(g.id) ? { ...g, parent: gid } : g
    )
    registry.push({ id: gid })
    commit({ ...part, headers: nextHeaders, shapes: nextShapes, labels: nextLabels, groups: registry })
  }

  /** Dissolve a group by one level: its members (and any sub-groups) are
   *  re-parented to the group's own parent (loose when it was top-level). */
  const ungroupSelection = (gid: string): void => commit(dissolveGroup(part, gid))

  // ── Group transforms (#630) ──────────────────────────────────────────────
  // "Selecting a group" resolves to its whole member tree (recursive through
  // nested sub-groups) so move / rotate / delete act on every member.

  /** Select every member of the tree rooted at the clicked item's group, and
   *  report the clicked item as the primary selection (for the property panel +
   *  the keyboard Delete). Returns the members so the caller can set up a drag. */
  const selectWholeGroup = (rootGid: string, primary: CanvasSelection): GroupMemberRef[] => {
    const ids = groupTreeIds(part.groups, rootGid)
    const members = groupMembers(part, ids)
    setSelectedPins(members.filter((m): m is Extract<GroupMemberRef, { kind: 'pin' }> => m.kind === 'pin').map((m) => ({ hi: m.hi, pi: m.pi })))
    setSelComponents(
      members
        .filter((m): m is Extract<GroupMemberRef, { kind: 'shape' | 'label' }> => m.kind !== 'pin')
        .map((m) => ({ type: m.kind, index: m.index }))
    )
    onSelect?.(primary)
    return members
  }

  /** Rotate a whole group tree 90° CW about its combined centre — pins rotate
   *  like the servo-header trio (position + own rotation), shapes/labels rotate
   *  their positions (+ a shape's own rotation) about the same centre (#630). */
  const rotateGroup = (rootGid: string): void => {
    const W = part.dimensions?.width || 1
    const H = part.dimensions?.height || 1
    const ids = groupTreeIds(part.groups, rootGid)
    const members = groupMembers(part, ids)
    // Gather each member's physical centre (px in mm-ish part frame) to find the
    // pivot, then rotate every point about it. (dx,dy) → (−dy, dx) is 90° CW.
    const pts: { m: GroupMemberRef; cx: number; cy: number }[] = []
    for (const m of members) {
      if (m.kind === 'pin') {
        const p = part.headers[m.hi]?.pins[m.pi]
        if (p?.x == null || p?.y == null) continue
        pts.push({ m, cx: p.x * W, cy: p.y * H })
      } else {
        const c = componentCenter(m.kind, m.index)
        if (c) pts.push({ m, cx: c.cx * W, cy: c.cy * H })
      }
    }
    if (!pts.length) return
    const cx = pts.reduce((a, p) => a + p.cx, 0) / pts.length
    const cy = pts.reduce((a, p) => a + p.cy, 0) / pts.length
    const rotedCentre = (px0: number, py0: number): { x: number; y: number } => {
      const dx = px0 - cx
      const dy = py0 - cy
      return { x: clamp01((cx - dy) / W), y: clamp01((cy + dx) / H) }
    }
    const pinUpd = new Map<string, { x: number; y: number; rotation: number }>()
    const shapeUpd = new Map<number, { x: number; y: number; rotation: number }>()
    const labelUpd = new Map<number, { x: number; y: number }>()
    for (const { m, cx: mcx, cy: mcy } of pts) {
      const r = rotedCentre(mcx, mcy)
      if (m.kind === 'pin') {
        const p = part.headers[m.hi].pins[m.pi]
        const dir = pinOutwardDir(p.rotation, p.x!, p.y!)
        const rot = p.rotation ?? { right: 0, bottom: 90, left: 180, top: 270 }[dir]
        pinUpd.set(`${m.hi}:${m.pi}`, { x: r.x, y: r.y, rotation: (rot + 90) % 360 })
      } else if (m.kind === 'shape') {
        // A shape stores a corner/reference x/y; keep the centre-mapped delta so
        // its body follows, and turn its own rotation a quarter.
        const s = shapes[m.index]
        const ctr = componentCenter('shape', m.index)
        const offX = ctr ? ctr.cx - s.x : 0
        const offY = ctr ? ctr.cy - s.y : 0
        shapeUpd.set(m.index, { x: r.x - offX, y: r.y - offY, rotation: ((s.rotation ?? 0) + 90) % 360 })
      } else {
        labelUpd.set(m.index, { x: r.x, y: r.y })
      }
    }
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const u = pinUpd.get(`${hi}:${pi}`)
          return u ? { ...p, x: u.x, y: u.y, rotation: u.rotation } : p
        })
      })),
      shapes: shapes.map((s, i) => {
        const u = shapeUpd.get(i)
        return u ? { ...s, x: u.x, y: u.y, rotation: u.rotation } : s
      }),
      labels: labels.map((l, i) => {
        const u = labelUpd.get(i)
        return u ? { ...l, x: u.x, y: u.y } : l
      })
    })
  }

  /** Delete a whole group tree: every member + the group registry entries. */
  const deleteGroup = (rootGid: string): void => {
    const ids = groupTreeIds(part.groups, rootGid)
    const inTree = (g: string | undefined): boolean => !!g && ids.has(g)
    commit({
      ...part,
      headers: part.headers
        .map((h) => ({ ...h, pins: h.pins.filter((p) => !inTree(p.group)) }))
        .filter((h) => h.pins.length > 0),
      shapes: shapes.filter((s) => !inTree(s.group)),
      labels: labels.filter((l) => !inTree(l.group)),
      groups: (part.groups ?? []).filter((g) => !ids.has(g.id))
    })
    setSelectedPins([])
    setSelComponents([])
    onSelect?.(null)
  }

  // A Layers-panel "select group" request (#631): resolve the group's tree and
  // select every member. The `nonce` lets re-selecting the same group re-fire.
  useEffect(() => {
    if (!groupSelect) return
    const root = groupRootId(part.groups, groupSelect.id)
    const first = groupMembers(part, groupTreeIds(part.groups, root))[0]
    if (!first) return
    const primary: CanvasSelection =
      first.kind === 'pin'
        ? { type: 'pin', hi: first.hi, pi: first.pi }
        : first.kind === 'shape'
          ? { type: 'shape', index: first.index }
          : { type: 'label', index: first.index }
    selectWholeGroup(root, primary)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSelect?.nonce])

  /** Container-pixel position of the LAST selected item, so the align toolbar can
   *  float just above it (#170). Null when it can't be resolved (CTM/ref missing). */
  const alignAnchorPx = (): { left: number; top: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    // Prefer the last component, else the last pin (matches selection recency).
    let cx: number | undefined
    let cy: number | undefined
    const lastComp = selComponents[selComponents.length - 1]
    if (lastComp) {
      const c = componentCenter(lastComp.type, lastComp.index)
      if (c) {
        cx = c.cx
        cy = c.cy
      }
    }
    if (cx === undefined) {
      const last = selectedPins[selectedPins.length - 1]
      const rp = last && pins.find((p) => p.hi === last.hi && p.pi === last.pi)
      if (rp) {
        cx = rp.x
        cy = rp.y
      }
    }
    const ctm = svg.getScreenCTM()
    if (cx === undefined || cy === undefined || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = view.tx + px(cx) * view.scale
    pt.y = view.ty + py(cy) * view.scale
    const s = pt.matrixTransform(ctm)
    // The toolbar is absolutely positioned inside .pcv__wrap, so measure relative to
    // that container — not the SVG, which is flex-centred and may be letterboxed.
    const base = (svg.closest('.pcv__wrap') as HTMLElement | null) ?? svg
    const rect = base.getBoundingClientRect()
    return { left: s.x - rect.left, top: s.y - rect.top }
  }

  /** Toggle a component's membership in the alignment multi-selection. */
  const toggleSelectedComponent = (type: 'shape' | 'label', index: number): void =>
    setSelComponents((cur) =>
      cur.some((s) => s.type === type && s.index === index)
        ? cur.filter((s) => !(s.type === type && s.index === index))
        : [...cur, { type, index }]
    )
  // --- selected-component toolbar (#…): duplicate / delete / fill / border -----
  /** Patch a shape's style/geometry. */
  const updateShape = (index: number, patch: Partial<ComponentShape>): void =>
    commit({ ...part, shapes: shapes.map((s, i) => (i === index ? { ...s, ...patch } : s)) })

  /** Duplicate the selected shape/label (offset a little) and select the copy. */
  const duplicateComponent = (sel: CanvasSelection): void => {
    if (sel?.type === 'shape') {
      const s = shapes[sel.index]
      if (!s) return
      const off = 0.04
      const copy: ComponentShape = {
        ...s,
        x: clamp01(s.x + off),
        y: clamp01(s.y + off),
        points: s.points?.map((p) => ({ x: clamp01(p.x + off), y: clamp01(p.y + off) })),
        z: nextComponentZ(part)
      }
      const next = [...shapes, copy]
      commit({ ...part, shapes: next })
      onSelect?.({ type: 'shape', index: next.length - 1 })
    } else if (sel?.type === 'label') {
      const l = labels[sel.index]
      if (!l) return
      const next = [...labels, { ...l, x: clamp01(l.x + 0.04), y: clamp01(l.y + 0.04), z: nextComponentZ(part) }]
      commit({ ...part, labels: next })
      onSelect?.({ type: 'label', index: next.length - 1 })
    }
  }

  /** Delete the selected shape/label. */
  const deleteComponent = (sel: CanvasSelection): void => {
    if (sel?.type === 'shape') commit({ ...part, shapes: shapes.filter((_, i) => i !== sel.index) })
    else if (sel?.type === 'label') commit({ ...part, labels: labels.filter((_, i) => i !== sel.index) })
    onSelect?.(null)
  }

  // --- mounting-hole toolbar (#…): duplicate / size / delete -----------------
  /** Patch a mounting hole's geometry (mirrors {@link updateShape}). */
  const updateHole = (index: number, patch: Partial<MountingHole>): void =>
    commit({ ...part, mountingHoles: holes.map((h, i) => (i === index ? { ...h, ...patch } : h)) })

  /** Duplicate a mounting hole (offset a little) and select the copy. */
  const duplicateHole = (index: number): void => {
    const h = holes[index]
    if (!h) return
    const off = 0.04
    const next = [...holes, { x: clamp01(h.x + off), y: clamp01(h.y + off), diameter: h.diameter }]
    commit({ ...part, mountingHoles: next })
    onSelect?.({ type: 'hole', index: next.length - 1 })
  }

  /** Delete a mounting hole. */
  const deleteHole = (index: number): void => {
    commit({ ...part, mountingHoles: holes.filter((_, i) => i !== index) })
    onSelect?.(null)
  }

  /** Duplicate the selected pin (offset a little, same header) and select the copy. */
  const duplicatePin = (sel: CanvasSelection): void => {
    if (sel?.type !== 'pin') return
    const rp = pins.find((p) => p.hi === sel.hi && p.pi === sel.pi)
    const src = part.headers[sel.hi]?.pins[sel.pi]
    if (!rp || !src) return
    const off = 0.04
    const copy: PartPin = {
      ...src,
      capabilities: src.capabilities ? [...src.capabilities] : undefined,
      x: clamp01(rp.x + off),
      y: clamp01(rp.y + off)
    }
    const newPi = part.headers[sel.hi].pins.length
    commit({ ...part, headers: part.headers.map((h, i) => (i === sel.hi ? { ...h, pins: [...h.pins, copy] } : h)) })
    onSelect?.({ type: 'pin', hi: sel.hi, pi: newPi })
  }

  // --- copy style / paste style (per-type style clipboard) ------------------
  /** Flatten a selection to a {@link StyleTarget} (or null for non-styleable). */
  const selToStyleTarget = (sel: CanvasSelection): StyleTarget | null => {
    if (sel?.type === 'shape') return { kind: 'shape', index: sel.index }
    if (sel?.type === 'label') return { kind: 'label', index: sel.index }
    if (sel?.type === 'pin') return { kind: 'pin', hi: sel.hi, pi: sel.pi }
    if (sel?.type === 'hole') return { kind: 'hole', index: sel.index }
    return null
  }
  /** Copy the selected element's style onto the clipboard. */
  const copyStyleFrom = (sel: CanvasSelection): void => {
    const t = selToStyleTarget(sel)
    if (!t) return
    const c = captureStyle(part, t)
    if (c) setStyleClip(c)
  }
  /** Apply the clipboard style to the selected element (same kind only; no-op otherwise). */
  const pasteStyleTo = (sel: CanvasSelection): void => {
    const t = selToStyleTarget(sel)
    if (!t || !styleClip) return
    commit(pasteStyle(part, t, styleClip))
  }

  /** Rotate the selected shape/label by +90° (about its own centre). */
  const rotateComponent = (sel: CanvasSelection): void => {
    const next = (r: number | undefined): number | undefined => (((r ?? 0) + 90) % 360) || undefined
    if (sel?.type === 'shape') {
      const s = shapes[sel.index]
      if (!s) return
      updateShape(sel.index, { rotation: next(s.rotation) })
    } else if (sel?.type === 'label') {
      const l = labels[sel.index]
      if (!l) return
      commit({ ...part, labels: labels.map((x, i) => (i === sel.index ? { ...x, rotation: next(x.rotation) } : x)) })
    }
  }

  /** Rotate the selected pin by +90° — turns the silk label and, on castellated
   *  pads, the outward half-hole. Mirrors the pin inspector's Rotation control:
   *  an absent rotation first resolves to the pin's nearest-border direction, so
   *  the first click turns from what's drawn rather than from 0°. */
  /** Rotate a whole pin group (e.g. a servo-header trio) 90° about its centre — each
   *  pin's position turns about the group's PHYSICAL centre (aspect-correct, so a
   *  vertical trio becomes a horizontal one) and its own rotation advances 90°, so
   *  the unit rotates rigidly (#628). */
  const rotatePinGroup = (grp: string): void => {
    const W = part.dimensions?.width || 1
    const H = part.dimensions?.height || 1
    const members: { hi: number; pi: number; x: number; y: number; rot: number }[] = []
    part.headers.forEach((h, hi) =>
      h.pins.forEach((p, pi) => {
        if (p.group === grp && p.x != null && p.y != null) {
          const dir = pinOutwardDir(p.rotation, p.x, p.y)
          const rot = p.rotation ?? { right: 0, bottom: 90, left: 180, top: 270 }[dir]
          members.push({ hi, pi, x: p.x, y: p.y, rot })
        }
      })
    )
    if (members.length === 0) return
    let cx = 0
    let cy = 0
    for (const m of members) {
      cx += m.x * W
      cy += m.y * H
    }
    cx /= members.length
    cy /= members.length
    const upd = new Map<string, { x: number; y: number; rotation: number }>()
    for (const m of members) {
      const dx = m.x * W - cx
      const dy = m.y * H - cy
      // 90° clockwise in the y-down part frame: (dx,dy) → (−dy, dx).
      upd.set(`${m.hi}:${m.pi}`, {
        x: clamp01((cx - dy) / W),
        y: clamp01((cy + dx) / H),
        rotation: (m.rot + 90) % 360
      })
    }
    commit({
      ...part,
      headers: part.headers.map((h, hi) => ({
        ...h,
        pins: h.pins.map((p, pi) => {
          const u = upd.get(`${hi}:${pi}`)
          return u ? { ...p, x: u.x, y: u.y, rotation: u.rotation } : p
        })
      }))
    })
  }
  const rotatePin = (sel: CanvasSelection): void => {
    if (sel?.type !== 'pin') return
    // A grouped pin (servo-header trio) rotates the WHOLE group as a unit (#628).
    const grp = part.headers[sel.hi]?.pins[sel.pi]?.group
    if (grp) return rotatePinGroup(grp)
    const rp = pins.find((p) => p.hi === sel.hi && p.pi === sel.pi)
    const src = part.headers[sel.hi]?.pins[sel.pi]
    if (!rp || !src) return
    const dir = pinOutwardDir(src.rotation, rp.x, rp.y)
    const rot = src.rotation ?? { right: 0, bottom: 90, left: 180, top: 270 }[dir]
    const nextRot = (rot + 90) % 360
    commit({
      ...part,
      headers: part.headers.map((h, i) =>
        i === sel.hi
          ? { ...h, pins: h.pins.map((p, j) => (j === sel.pi ? { ...p, rotation: nextRot } : p)) }
          : h
      )
    })
  }

  // The group of the primary-selected pin (a servo-header trio), so the WHOLE group
  // highlights when any of its pins is selected (#628).
  const selPinGroup =
    selection?.type === 'pin' ? part.headers[selection.hi]?.pins[selection.pi]?.group : undefined

  // --- text/label styling (the mini-toolbar "A" dropdown) -------------------
  interface LabelStyle {
    fontSize: number
    color: string
    bold: boolean
    italic: boolean
    underline: boolean
    align: TextAlign
    wrap: boolean
    canWrap: boolean
  }
  /** Read the effective label style of the selected shape/label (or null). */
  const labelStyle = (sel: CanvasSelection): LabelStyle | null => {
    if (sel?.type === 'shape') {
      const s = shapes[sel.index]
      if (!s) return null
      return {
        fontSize: s.labelFontSize ?? 10,
        color: s.labelColor ?? '#cfd6dd',
        bold: !!s.labelBold,
        italic: !!s.labelItalic,
        underline: !!s.labelUnderline,
        align: s.labelAlign ?? 'center',
        wrap: !!s.labelWrap,
        canWrap: true
      }
    }
    if (sel?.type === 'label') {
      const l = labels[sel.index]
      if (!l) return null
      return {
        fontSize: l.fontSize ?? 12,
        color: l.color ?? '#e9edf1',
        bold: !!l.bold,
        italic: !!l.italic,
        underline: !!l.underline,
        align: l.align ?? 'center',
        wrap: false,
        canWrap: false
      }
    }
    return null
  }
  /** Patch the label style of the selected shape/label (only the given keys). */
  const setLabelStyle = (
    sel: CanvasSelection,
    patch: Partial<{ fontSize: number; color: string; bold: boolean; italic: boolean; underline: boolean; align: TextAlign; wrap: boolean }>
  ): void => {
    if (sel?.type === 'shape') {
      const m: Partial<ComponentShape> = {}
      if ('fontSize' in patch) m.labelFontSize = patch.fontSize
      if ('color' in patch) m.labelColor = patch.color
      if ('bold' in patch) m.labelBold = patch.bold
      if ('italic' in patch) m.labelItalic = patch.italic
      if ('underline' in patch) m.labelUnderline = patch.underline
      if ('align' in patch) m.labelAlign = patch.align
      if ('wrap' in patch) m.labelWrap = patch.wrap
      updateShape(sel.index, m)
    } else if (sel?.type === 'label') {
      const m: Partial<PartLabel> = {}
      if ('fontSize' in patch) m.fontSize = patch.fontSize
      if ('color' in patch) m.color = patch.color
      if ('bold' in patch) m.bold = patch.bold
      if ('italic' in patch) m.italic = patch.italic
      if ('underline' in patch) m.underline = patch.underline
      if ('align' in patch) m.align = patch.align
      commit({ ...part, labels: labels.map((l, i) => (i === sel.index ? { ...l, ...m } : l)) })
    }
  }

  /** A quick-pick grid of the part's used colours for a mini-toolbar colour well;
   *  `onPick` applies the chosen colour. Null when there are none yet. */
  const ctbSwatches = (onPick: (c: string) => void): JSX.Element | null =>
    usedColors.length > 0 ? (
      <div className="pcv__ctb-swatches" role="group" aria-label="Colours used in this part">
        {usedColors.map((col) => (
          <button
            key={col}
            type="button"
            className="pcv__ctb-swatch"
            style={{ background: col }}
            title={col}
            aria-label={`Use ${col}`}
            onClick={() => onPick(col)}
          />
        ))}
      </div>
    ) : null

  /** Normalised top-centre of a shape/label, for floating its toolbar above it. */
  const componentTopCenter = (sel: CanvasSelection): { nx: number; ny: number } | null => {
    if (sel?.type === 'shape') {
      const s = shapes[sel.index]
      if (!s) return null
      if (s.kind === 'circle') return { nx: s.x, ny: s.y - ((s.r ?? 0.08) * box.w) / box.h }
      if (s.kind === 'polygon' && s.points?.length) {
        const xs = s.points.map((p) => p.x)
        const ys = s.points.map((p) => p.y)
        return { nx: (Math.min(...xs) + Math.max(...xs)) / 2, ny: Math.min(...ys) }
      }
      return { nx: s.x + (s.w ?? 0.2) / 2, ny: s.y }
    }
    if (sel?.type === 'label') {
      const l = labels[sel.index]
      return l ? { nx: l.x, ny: l.y } : null
    }
    if (sel?.type === 'hole') {
      const h = holes[sel.index]
      return h ? { nx: h.x, ny: h.y - holeR(h.diameter) / box.h } : null
    }
    if (sel?.type === 'pin') {
      const rp = pins.find((p) => p.hi === sel.hi && p.pi === sel.pi)
      return rp ? { nx: rp.x, ny: rp.y - 6 / box.h } : null
    }
    return null
  }

  /** Container-pixel position of the selected component's top-centre. */
  const componentAnchorPx = (sel: CanvasSelection): { left: number; top: number } | null => {
    const c = componentTopCenter(sel)
    const svg = svgRef.current
    if (!c || !svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = view.tx + px(c.nx) * view.scale
    pt.y = view.ty + py(c.ny) * view.scale
    const s = pt.matrixTransform(ctm)
    const base = (svg.closest('.pcv__wrap') as HTMLElement | null) ?? svg
    const rect = base.getBoundingClientRect()
    return { left: s.x - rect.left, top: s.y - rect.top }
  }

  // Close the border dropdown on an outside click, or when the selection changes.
  useEffect(() => {
    if (!borderMenuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.('.pcv__ctb-border')) setBorderMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [borderMenuOpen])
  // Same for the fill dropdown (native picker + used-colour swatch grid).
  useEffect(() => {
    if (!fillMenuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.('.pcv__ctb-fill')) setFillMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [fillMenuOpen])
  // Same for the text (A) dropdown — label size/colour/style controls.
  useEffect(() => {
    if (!textMenuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.('.pcv__ctb-text')) setTextMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [textMenuOpen])
  // Same for the mounting-hole size dropdown.
  useEffect(() => {
    if (!holeMenuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.('.pcv__ctb-size')) setHoleMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [holeMenuOpen])
  useEffect(() => {
    setBorderMenuOpen(false)
    setFillMenuOpen(false)
    setTextMenuOpen(false)
    setHoleMenuOpen(false)
  }, [selection])
  // Leave inline text-edit when the selection moves off the edited shape.
  useEffect(() => {
    if (editLabelIdx !== null && !(selection?.type === 'shape' && selection.index === editLabelIdx)) {
      setEditLabelIdx(null)
    }
  }, [selection, editLabelIdx])
  // Drop any multi-selection when switching to a different part (stale indices).
  useEffect(() => {
    setSelectedPins([])
    setSelComponents([])
  }, [part.id])

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

  /** Add an on-board push-button at the clicked point (#130). */
  const addButton = (nx: number, ny: number): void => {
    const next = [...buttons, { label: 'BTN', x: snapX(nx), y: snapY(ny) }]
    commit({ ...part, buttons: next })
    onSelect?.({ type: 'button', index: next.length - 1 })
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
  /** Rotation pivot (normalised) of a shape — MUST match the render transform's
   *  centre: rect = geometric centre, polygon = vertex centroid (mean), circle =
   *  centre. (Distinct from the alignment `componentCenter`, which uses bbox-mid.) */
  const shapeRotationCenterN = (s: ComponentShape): { cx: number; cy: number } => {
    if (s.kind === 'circle') return { cx: s.x, cy: s.y }
    if (s.kind === 'polygon' && s.points?.length) {
      const n = s.points.length
      return { cx: s.points.reduce((a, p) => a + p.x, 0) / n, cy: s.points.reduce((a, p) => a + p.y, 0) / n }
    }
    return { cx: s.x + (s.w ?? 0.2) / 2, cy: s.y + (s.h ?? 0.15) / 2 }
  }
  /** Un-rotate a normalised point into a shape's local (pre-rotation) frame so a
   *  visibly-rotated rect/polygon hit-tests against its real footprint. Inverts the
   *  render's `rotate(rot pivot)` in PIXEL space (the board box isn't square, so a
   *  90° pixel rotation isn't a clean normalised one). No-op for circles / 0°. */
  const localShapePoint = (s: ComponentShape, nx: number, ny: number): { nx: number; ny: number } => {
    const rot = s.rotation ?? 0
    if (!rot || s.kind === 'circle') return { nx, ny }
    const c = shapeRotationCenterN(s)
    const cxPx = px(c.cx)
    const cyPx = py(c.cy)
    const rad = (-rot * Math.PI) / 180
    const co = Math.cos(rad)
    const si = Math.sin(rad)
    const dxp = px(nx) - cxPx
    const dyp = py(ny) - cyPx
    return { nx: (cxPx + dxp * co - dyp * si - box.x) / box.w, ny: (cyPx + dxp * si + dyp * co - box.y) / box.h }
  }
  /** True if a normalised point is inside a component shape (rotation-aware). */
  const inShape = (s: ComponentShape, nx: number, ny: number): boolean => {
    const lp = localShapePoint(s, nx, ny)
    const lx = lp.nx
    const ly = lp.ny
    if (s.kind === 'rect') return lx >= s.x && lx <= s.x + (s.w ?? 0) && ly >= s.y && ly <= s.y + (s.h ?? 0)
    if (s.kind === 'circle') return dist(lx, ly, s.x, s.y) <= (s.r ?? 0) * box.w + 2
    // polygon: ray-cast point-in-polygon over the points (normalised)
    const pts = s.points ?? []
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      if (a.y > ly !== b.y > ly && lx < ((b.x - a.x) * (ly - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }
  const hitTest = (nx: number, ny: number): CanvasSelection => {
    // Hit-test in REVERSE PAINT ORDER — the top-most drawn item wins the click.
    // The SVG paints connectors → LEDs → buttons ON TOP of shapes/labels, which
    // sit on top of pins → holes → image. Testing shapes first (the old order)
    // let a shape UNDERNEATH an LED steal the click; test the free-placed
    // component glyphs before shapes so clicking an LED selects the LED.
    // A locked layer is skipped entirely — its items can't be picked up.
    if (visible.components && !locked.components) {
      // Walk the unified item z-order top-most FIRST, so a click always selects
      // what's visually on top (an LED reordered above a shape wins, and vice
      // versa) — the render paints this same order.
      const items = orderedItems(part)
      for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k]
        if (it.kind === 'connector') {
          if (dist(nx, ny, connectors[it.index].x, connectors[it.index].y) < HIT) return { type: 'connector', index: it.index }
        } else if (it.kind === 'led') {
          if (dist(nx, ny, onboardLeds[it.index].x, onboardLeds[it.index].y) < HIT) return { type: 'led', index: it.index }
        } else if (it.kind === 'button') {
          if (dist(nx, ny, buttons[it.index].x, buttons[it.index].y) < HIT) return { type: 'button', index: it.index }
        } else if (it.kind === 'label') {
          if (dist(nx, ny, labels[it.index].x, labels[it.index].y) < HIT * 1.4) return { type: 'label', index: it.index }
        } else if (inShape(shapes[it.index], nx, ny)) {
          return { type: 'shape', index: it.index }
        }
      }
    }
    if (visible.pins && !locked.pins) {
      // Pick the NEAREST pin within HIT — not the first match. On a dense board
      // (Servo 2040 renders ~9px pitch) HIT (14px) overlaps several pins, so
      // returning the first in reverse order grabbed the neighbour to the RIGHT
      // instead of the pad actually under the cursor.
      let best = -1
      let bestD = HIT
      for (let i = 0; i < pins.length; i++) {
        const d = dist(nx, ny, pins[i].x, pins[i].y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best >= 0) return { type: 'pin', hi: pins[best].hi, pi: pins[best].pi }
    }
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
    // Erase-background: clicking on the image flood-fills the backdrop there.
    if (tool === 'erasebg') {
      if (locked.image || !part.imageData) return
      const inX = nx >= layer.x && nx <= layer.x + layer.w
      const inY = ny >= layer.y && ny <= layer.y + layer.h
      if (inX && inY) onEraseImageAt?.(nx, ny)
      else onNotify?.('Click on the image to erase its background there.')
      return
    }
    // Creation tools no-op on a locked layer.
    if (tool === 'pin') return locked.pins ? undefined : addPin(nx, ny)
    if (tool === 'servo-header') {
      // Down starts a strip drag: a plain click places one header, dragging right
      // lays a row of N at the pin pitch (committed on release).
      if (locked.pins) return
      const sx = snapX(nx)
      const sy = snapY(ny)
      dragRef.current = { kind: 'servo-strip', sel: null, startNX: sx, startNY: sy, ox: sx, oy: sy }
      setStripPreview({ x: sx, y: sy, n: 1 })
      return
    }
    if (tool === 'hole') return locked.holes ? undefined : addHole(nx, ny)
    if (tool === 'button') return locked.components ? undefined : addButton(nx, ny)
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
      // Vertex grab / edge-insert work in un-rotated coords, so they're disabled
      // while the polygon is rotated (un-rotate it to edit its geometry).
      if (poly?.kind === 'polygon' && !poly.rotation) {
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

    // select tool — shape resize handles (when a rect/circle shape is selected).
    // Rect handles work in un-rotated coords, so they're off while rotated.
    if (selection?.type === 'shape' && !locked.components) {
      const s = shapes[selection.index]
      if (s?.kind === 'rect' && !s.rotation) {
        const w = s.w ?? 0.2 // match the render-time fallbacks so handles are grabbable
        const h = s.h ?? 0.15
        // 0 TL, 1 TR, 2 BR, 3 BL, 4 T, 5 R, 6 B, 7 L
        const handles: [number, number][] = [
          [s.x, s.y],
          [s.x + w, s.y],
          [s.x + w, s.y + h],
          [s.x, s.y + h],
          [s.x + w / 2, s.y],
          [s.x + w, s.y + h / 2],
          [s.x + w / 2, s.y + h],
          [s.x, s.y + h / 2]
        ]
        for (let c = 0; c < handles.length; c++) {
          if (dist(nx, ny, handles[c][0], handles[c][1]) < HIT) {
            dragRef.current = { kind: 'resize-shape', sel: selection, corner: c, startNX: nx, startNY: ny, ox: s.x, oy: s.y, ow: w, oh: h }
            return
          }
        }
      } else if (s?.kind === 'circle') {
        const r = s.r ?? 0.08
        const ry = (r * box.w) / box.h // circle radius as a normalised-y offset
        const handles: [number, number][] = [
          [s.x + r, s.y],
          [s.x - r, s.y],
          [s.x, s.y + ry],
          [s.x, s.y - ry]
        ]
        for (const [hx, hy] of handles) {
          if (dist(nx, ny, hx, hy) < HIT) {
            dragRef.current = { kind: 'resize-shape', sel: selection, startNX: nx, startNY: ny, ox: s.x, oy: s.y }
            return
          }
        }
      }
    }

    const hit = hitTest(nx, ny)

    // Multi-select (#170): SHIFT-click a pin/shape/label adds/removes it from the
    // alignment group on a no-move RELEASE; a drag instead moves it. The toggle
    // fires in onPointerUp.
    const modSelect = e.shiftKey
    // Ctrl/Cmd = "grid mode": the selected pin's 2.54mm grid drives placement
    // (lay a row/column / snap to it). Without it a pin drag just free-moves (#…).
    const gridMod = e.ctrlKey || e.metaKey
    if (hit?.type === 'pin' && modSelect) {
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox: rp?.x ?? nx, oy: rp?.y ?? ny, toggleSel: true }
      return
    }
    if ((hit?.type === 'shape' || hit?.type === 'label') && modSelect && !locked.components) {
      const ox = hit.type === 'shape' ? (shapes[hit.index]?.x ?? nx) : (labels[hit.index]?.x ?? nx)
      const oy = hit.type === 'shape' ? (shapes[hit.index]?.y ?? ny) : (labels[hit.index]?.y ?? ny)
      dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox, oy, toggleSel: true }
      return
    }
    // Any plain (non-modifier) interaction clears an existing multi-selection.
    if (!modSelect && selectedPins.length) setSelectedPins([])
    if (!modSelect && selComponents.length) setSelComponents([])

    // Grid-mode gestures (Ctrl/Cmd held, a pin is selected = the array anchor):
    if (hit?.type === 'pin' && selPin && gridMod) {
      if (hit.hi === selPin.hi && hit.pi === selPin.pi) {
        // Ctrl-drag FROM the anchor pin → lay down a row/column of new pins; the
        // anchor stays put.
        dragRef.current = { kind: 'create-array', sel: hit, startNX: nx, startNY: ny, ox: selPin.x, oy: selPin.y, anchor: { x: selPin.x, y: selPin.y } }
        return
      }
      // Ctrl-drag a DIFFERENT pin → snap it to the anchor's grid.
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox: rp?.x ?? nx, oy: rp?.y ?? ny, anchor: { x: selPin.x, y: selPin.y } }
      return
    }

    onSelect?.(hit)
    if (!hit) {
      // Empty canvas (select tool) → rubber-band marquee to select pins +
      // components. Skipped only when BOTH layers are locked (nothing to gather).
      if (!locked.pins || !locked.components) {
        dragRef.current = { kind: 'marquee', sel: null, startNX: nx, startNY: ny, ox: nx, oy: ny }
        setMarquee({ x0: nx, y0: ny, x1: nx, y1: ny })
      }
      return
    }
    // Grouped item (#630): a plain click selects the WHOLE group tree and drags
    // it as a rigid unit. A servo-header trio (pins only) keeps its grid-snapping
    // via the pin path below; a general group (any shape/label) free-moves.
    const hitGroup =
      hit.type === 'pin'
        ? part.headers[hit.hi]?.pins[hit.pi]?.group
        : hit.type === 'shape'
          ? shapes[hit.index]?.group
          : hit.type === 'label'
            ? labels[hit.index]?.group
            : undefined
    if (hitGroup && !gridMod) {
      const root = groupRootId(part.groups, hitGroup)
      const members = selectWholeGroup(root, hit)
      if (members.some((m) => m.kind !== 'pin')) {
        const bundle: NonNullable<Drag['groupBundle']> = { pins: [], shapes: [], labels: [] }
        for (const m of members) {
          if (m.kind === 'pin') {
            const p = part.headers[m.hi]?.pins[m.pi]
            if (p?.x != null && p?.y != null) bundle.pins.push({ hi: m.hi, pi: m.pi, dx: p.x - nx, dy: p.y - ny })
          } else if (m.kind === 'shape') {
            const s = shapes[m.index]
            bundle.shapes.push({ index: m.index, dx: s.x - nx, dy: s.y - ny })
          } else {
            const l = labels[m.index]
            bundle.labels.push({ index: m.index, dx: l.x - nx, dy: l.y - ny })
          }
        }
        dragRef.current = { kind: 'move-group', sel: hit, startNX: nx, startNY: ny, ox: nx, oy: ny, groupBundle: bundle }
        return
      }
      // pins-only group → fall through to the pin groupOffsets path (snapping).
    }

    let ox = 0
    let oy = 0
    let groupOffsets: { hi: number; pi: number; dx: number; dy: number }[] | undefined
    if (hit.type === 'pin') {
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      ox = rp?.x ?? nx
      oy = rp?.y ?? ny
      // Grouped pin (servo header) → capture the whole trio's offsets so the group
      // moves rigidly with the dragged pad.
      const grp = part.headers[hit.hi]?.pins[hit.pi]?.group
      if (grp) {
        groupOffsets = []
        part.headers.forEach((h, hi) =>
          h.pins.forEach((p, pi) => {
            if (p.group === grp && p.x !== undefined && p.y !== undefined) {
              groupOffsets!.push({ hi, pi, dx: p.x - ox, dy: p.y - oy })
            }
          })
        )
      }
    } else if (hit.type === 'hole') {
      ox = holes[hit.index]?.x ?? nx
      oy = holes[hit.index]?.y ?? ny
    } else if (hit.type === 'button') {
      ox = buttons[hit.index]?.x ?? nx
      oy = buttons[hit.index]?.y ?? ny
    } else if (hit.type === 'led') {
      ox = onboardLeds[hit.index]?.x ?? nx
      oy = onboardLeds[hit.index]?.y ?? ny
    } else if (hit.type === 'connector') {
      ox = connectors[hit.index]?.x ?? nx
      oy = connectors[hit.index]?.y ?? ny
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
    dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox, oy, groupOffsets }
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
    if (d.kind === 'move-label' && d.sel?.type === 'pin') {
      // Move the pin's label annotation by the drag delta (fraction of the box).
      setLabelOffset(d.sel.hi, d.sel.pi, d.ox + dx, d.oy + dy)
      return
    }
    if (d.kind === 'move-label' && (d.sel?.type === 'led' || d.sel?.type === 'connector')) {
      // Move the component's silk label by the drag delta (fraction of the box).
      setCompLabelOffset(d.sel, d.ox + dx, d.oy + dy)
      return
    }
    if (d.kind === 'servo-strip') {
      // Drag right/left from the start pad to set how many headers the strip lays.
      const n = Math.max(1, Math.min(64, Math.round(Math.abs(nx - d.startNX) / stepNX) + 1))
      setStripPreview({ x: d.startNX, y: d.startNY, n })
      return
    }
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
    if (d.kind === 'resize-shape' && d.sel?.type === 'shape') {
      const s = shapes[d.sel.index]
      if (!s) return
      const off = e.ctrlKey || e.metaKey // hold Ctrl/Cmd to resize freely (no snap)
      if (s.kind === 'circle') {
        // Radius = the pointer's distance from the (fixed) centre, in board-width
        // fractions; any of the four handles drags it.
        const r = Math.max(0.02, Math.hypot((nx - s.x) * box.w, (ny - s.y) * box.h) / box.w)
        resizeCircleShape(d.sel.index, r)
        setGuides(null)
        return
      }
      // Rect: move only the edges the grabbed handle owns; snap them to nearby
      // pins / holes / other shapes' edges (dynamic guides), Ctrl/Cmd = free.
      const c = d.corner ?? 2
      const leftMoves = c === 0 || c === 3 || c === 7
      const rightMoves = c === 1 || c === 2 || c === 5
      const topMoves = c === 0 || c === 1 || c === 4
      const bottomMoves = c === 2 || c === 3 || c === 6
      let x0 = d.ox
      let y0 = d.oy
      let x1 = d.ox + (d.ow ?? 0)
      let y1 = d.oy + (d.oh ?? 0)
      if (leftMoves) x0 = d.ox + dx
      if (rightMoves) x1 = d.ox + (d.ow ?? 0) + dx
      if (topMoves) y0 = d.oy + dy
      if (bottomMoves) y1 = d.oy + (d.oh ?? 0) + dy
      let gx: number | undefined
      let gy: number | undefined
      if (!off) {
        const cand = shapeSnapLines(d.sel.index)
        if (leftMoves) {
          const sx = nearestCenter(cand.xs, x0, box.w, ALIGN_PX)
          if (sx != null) ((x0 = sx), (gx = sx))
        } else if (rightMoves) {
          const sx = nearestCenter(cand.xs, x1, box.w, ALIGN_PX)
          if (sx != null) ((x1 = sx), (gx = sx))
        }
        if (topMoves) {
          const sy = nearestCenter(cand.ys, y0, box.h, ALIGN_PX)
          if (sy != null) ((y0 = sy), (gy = sy))
        } else if (bottomMoves) {
          const sy = nearestCenter(cand.ys, y1, box.h, ALIGN_PX)
          if (sy != null) ((y1 = sy), (gy = sy))
        }
      }
      // Clamp BOTH edges to the board before measuring, so dragging one edge off
      // the top/left can't shift the opposite (anchored) edge.
      const cx0 = clamp01(x0)
      const cx1 = clamp01(x1)
      const cy0 = clamp01(y0)
      const cy1 = clamp01(y1)
      const x = Math.min(cx0, cx1)
      const y = Math.min(cy0, cy1)
      const w = Math.abs(cx1 - cx0)
      const h = Math.abs(cy1 - cy0)
      if (w > 0.02 && h > 0.02) {
        resizeRectShape(d.sel.index, x, y, w, h)
        setGuides(gx !== undefined || gy !== undefined ? { x: gx, y: gy } : null)
      }
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
    if (d.kind === 'move-group' && d.groupBundle) {
      // Free rigid move of the whole group — base = the current pointer position.
      moveGroupBundleTo(d.groupBundle, nx, ny)
      setGuides(null)
      return
    }
    if (d.kind === 'move-obj' && d.sel) {
      const x = d.ox + dx
      const y = d.oy + dy
      // Hold Shift for completely free movement — no alignment guides / snapping
      // (Ctrl/Cmd also disables it, mirroring the resize handler).
      const noSnap = e.shiftKey || e.ctrlKey || e.metaKey
      if (d.sel.type === 'pin' && d.groupOffsets) {
        // Servo-header group: snap the dragged pad, move the whole trio rigidly.
        moveGroupTo(d.groupOffsets, noSnap ? x : snapX(x), noSnap ? y : snapY(y))
        setGuides(null)
      } else if (d.sel.type === 'pin' && d.anchor) {
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
      } else if (d.sel.type === 'button') {
        const a = alignDrag(x, y, 'button', { index: d.sel.index }, noSnap)
        setGuides(a.gx !== undefined || a.gy !== undefined ? { x: a.gx, y: a.gy } : null)
        moveButtonTo(d.sel.index, a.x, a.y, true)
      } else if (d.sel.type === 'led') {
        moveLedTo(d.sel.index, x, y)
      } else if (d.sel.type === 'connector') {
        moveConnectorTo(d.sel.index, x, y)
      } else if (d.sel.type === 'shape') {
        // Smart-align the shape's CENTRE (the stored x/y is a corner for rects /
        // a reference for polygons), then convert the snapped centre back.
        const s = shapes[d.sel.index]
        const ctr = componentCenter('shape', d.sel.index)
        const offX = ctr && s ? ctr.cx - s.x : 0
        const offY = ctr && s ? ctr.cy - s.y : 0
        const a = alignComponentDrag(x + offX, y + offY, { kind: 'shape', index: d.sel.index }, noSnap)
        setGuides(a.gx !== undefined || a.gy !== undefined ? { x: a.gx, y: a.gy } : null)
        moveShapeTo(d.sel.index, a.cx - offX, a.cy - offY, true)
      } else if (d.sel.type === 'label') {
        const a = alignComponentDrag(x, y, { kind: 'label', index: d.sel.index }, noSnap)
        setGuides(a.gx !== undefined || a.gy !== undefined ? { x: a.gx, y: a.gy } : null)
        moveLabelTo(d.sel.index, a.cx, a.cy, true)
      } else if (d.sel.type === 'image') moveImage(x, y)
    }
  }

  const onPointerUp = (): void => {
    const d = dragRef.current
    dragRef.current = null
    const preview = createPreview
    setCreatePreview(null)
    const strip = stripPreview
    setStripPreview(null)
    setGuides(null) // drop any alignment guides
    if (!d || !interactive) return

    // Servo-header strip → place N headers in a row (N=1 for a plain click).
    if (d.kind === 'servo-strip') {
      addServoHeaders(d.startNX, d.startNY, strip?.n ?? 1)
      return
    }

    // Marquee → select the pins + components whose centre is inside the box.
    if (d.kind === 'marquee') {
      const m = marquee
      setMarquee(null)
      if (m) {
        const minX = Math.min(m.x0, m.x1)
        const maxX = Math.max(m.x0, m.x1)
        const minY = Math.min(m.y0, m.y1)
        const maxY = Math.max(m.y0, m.y1)
        const within = (x: number, y: number): boolean => x >= minX && x <= maxX && y >= minY && y <= maxY
        const inside = locked.pins
          ? []
          : pins.filter((p) => within(p.x, p.y)).map((p) => ({ hi: p.hi, pi: p.pi }))
        const insideComps: { type: 'shape' | 'label'; index: number }[] = []
        if (!locked.components) {
          shapes.forEach((_, i) => {
            const c = componentCenter('shape', i)
            if (c && within(c.cx, c.cy)) insideComps.push({ type: 'shape', index: i })
          })
          labels.forEach((_, i) => {
            const c = componentCenter('label', i)
            if (c && within(c.cx, c.cy)) insideComps.push({ type: 'label', index: i })
          })
        }
        setSelectedPins(inside)
        setSelComponents(insideComps)
        if (inside.length || insideComps.length) onSelect?.(null)
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
    // …same for a shape / label (component multi-select).
    if (d.kind === 'move-obj' && d.toggleSel && (d.sel?.type === 'shape' || d.sel?.type === 'label')) {
      toggleSelectedComponent(d.sel.type, d.sel.index)
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

  // Double-click a shape → edit its caption inline (an overlay textarea).
  const onDoubleClick = (e: { clientX: number; clientY: number }): void => {
    if (!interactive || locked.components) return
    const { nx, ny } = toNorm(e)
    const hit = hitTest(nx, ny)
    if (hit?.type === 'shape') {
      onSelect?.(hit)
      setEditLabelIdx(hit.index)
    }
  }

  /** Container-pixel rect for the inline caption editor over a shape. */
  const labelEditRect = (idx: number): { left: number; top: number; width: number; height: number } | null => {
    const s = shapes[idx]
    const svg = svgRef.current
    if (!s || !svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    // Normalised bounding box of the shape.
    let bx = s.x
    let by = s.y
    let bw = s.w ?? 0.2
    let bh = s.h ?? 0.15
    if (s.kind === 'circle') {
      const r = s.r ?? 0.08
      bx = s.x - r
      by = s.y - (r * box.w) / box.h
      bw = 2 * r
      bh = 2 * ((r * box.w) / box.h)
    } else if (s.kind === 'polygon' && s.points?.length) {
      const xs = s.points.map((p) => p.x)
      const ys = s.points.map((p) => p.y)
      bx = Math.min(...xs)
      by = Math.min(...ys)
      bw = Math.max(...xs) - bx
      bh = Math.max(...ys) - by
    }
    const base = (svg.closest('.pcv__wrap') as HTMLElement | null) ?? svg
    const rect = base.getBoundingClientRect()
    const toPx = (nx: number, ny: number): { x: number; y: number } => {
      const pt = svg.createSVGPoint()
      pt.x = view.tx + px(nx) * view.scale
      pt.y = view.ty + py(ny) * view.scale
      const p = pt.matrixTransform(ctm)
      return { x: p.x - rect.left, y: p.y - rect.top }
    }
    const tl = toPx(bx, by)
    const br = toPx(bx + bw, by + bh)
    return {
      left: tl.x,
      top: tl.y,
      width: Math.max(48, br.x - tl.x),
      height: Math.max(24, br.y - tl.y)
    }
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
  // Pin/castellation through-holes to cut through the PCB + image + copper (#171).
  const pinHoleList = visible.pins
    ? pins.flatMap((rp) => pinThroughHoles(pinShapeOf(rp.pin), px(rp.x), py(rp.y), 12 * pinScale, rp.x, rp.pin.rotation))
    : []
  const hasCuts = cutHoles || pinHoleList.length > 0

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

  // --- mini-toolbar icons (shared across the shape/label/pin/hole toolbars) ---
  const dupIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x={5.5} y={5.5} width={7.5} height={8} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M3 10.5V3.2A1.2 1.2 0 0 1 4.2 2H10" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  )
  const delIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 4.5h9M6.5 4.5V3.2A1 1 0 0 1 7.5 2.2h1a1 1 0 0 1 1 1V4.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  // Copy style = a brush (picks up a style); paste = a brush dabbing onto a bar.
  const copyStyleIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10.6 2.4 13.6 5.4 7.5 11.5 4.5 8.5z" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M4.5 8.5 2.6 13.4 7.5 11.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  )
  const pasteStyleIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10.6 1.9 14.1 5.4 9 10.5 5.5 7z" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M2.5 13.5h7" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
  // Diameter (⌀): a circle with its diameter chord.
  const diaIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx={8} cy={8} r={5} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M4.5 11.5 11.5 4.5" stroke="currentColor" strokeWidth={1.1} />
    </svg>
  )
  // Rotate 90°: a circular arrow (shared by the component + pin toolbars).
  const rotateIcon = (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M12.5 6.5A5 5 0 1 0 13 9" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M12.8 3v3.6H9.2" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  /** The "Copy style" + "Paste style" buttons for a mini-toolbar. Paste is
   *  disabled unless the clipboard holds a style of the SAME `kind`. */
  const styleClipButtons = (sel: CanvasSelection, kind: PartStyleClipboard['kind']): JSX.Element => (
    <>
      <button type="button" className="pcv__ctb-btn" title="Copy style" aria-label="Copy style" onClick={() => copyStyleFrom(sel)}>
        {copyStyleIcon}
      </button>
      <button
        type="button"
        className="pcv__ctb-btn"
        title="Paste style"
        aria-label="Paste style"
        disabled={!styleClip || styleClip.kind !== kind}
        onClick={() => pasteStyleTo(sel)}
      >
        {pasteStyleIcon}
      </button>
    </>
  )

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
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
    >
      <defs>
        {/* Clip the image to the board outline (image sits ON the PCB). */}
        <clipPath id={clipId}>{shapeEl({})}</clipPath>
        {/* Punch mounting holes + pin/castellation through-holes through the PCB +
            image (and the copper pads). The white field is a generous rect — not
            the board outline — so masking a castellation pad that straddles the
            edge doesn't clip its outer half (#171). */}
        {hasCuts && (
          <mask id={maskId}>
            <rect x={box.x - 40} y={box.y - 40} width={box.w + 80} height={box.h + 80} fill="white" />
            {cutHoles &&
              holes.map((h, i) => (
                <circle key={`mh${i}`} cx={px(h.x)} cy={py(h.y)} r={holeR(h.diameter)} fill="black" />
              ))}
            {pinHoleList.map((h, i) => (
              <circle key={`ph${i}`} cx={h.cx} cy={h.cy} r={h.r} fill="black" />
            ))}
          </mask>
        )}
      </defs>

      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
        {/* Layer 1: PCB (outline + image), with holes cut through via the mask */}
        <g mask={hasCuts ? `url(#${maskId})` : undefined}>
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

        {/* Layer 2: hole selection ring only — a hole is a bare cutout (the mask
            punches it out); a ring shows ONLY when it's selected, so it stays
            grabbable in the editor without a border in normal use. */}
        {visible.holes &&
          holes.map((h, i) =>
            isSel({ type: 'hole', index: i }) ? (
              <circle key={`h${i}`} cx={px(h.x)} cy={py(h.y)} r={holeR(h.diameter)} fill="none" stroke="#fff" strokeWidth={3} />
            ) : null
          )}

        {/* Layer 3: pins (square / round / castellated / header) */}
        {visible.pins &&
          pins.map((rp: ResolvedPin, i) => {
            const fill = PAD_FILL[rp.pin.type] ?? PAD_FILL.other
            const sel =
              isSel({ type: 'pin', hi: rp.hi, pi: rp.pi }) ||
              (!!selPinGroup && rp.pin.group === selPinGroup)
            const shape = pinShapeOf(rp.pin)
            // Pad shrinks with the pitch so dense boards don't overlap (#…), EXCEPT
            // octagonal servo/DuPont header pads, which draw at a fixed physical
            // 2.4mm — big and close like the real thing.
            const size =
              shape === 'octagonal' && connPxPerMm > 0 ? 2.4 * connPxPerMm : 12 * pinScale
            const cx = px(rp.x)
            const cy = py(rp.y)
            const stroke = sel ? '#fff' : '#0008'
            const sw = sel ? 3 : 1
            const pinLabel = rp.pin.label || rp.pin.name
            // Show the GP## GPIO next to the pin when the silk label differs from
            // it (so the actual GPIO is always visible in the editor).
            const gpioVar =
              rp.pin.type === 'io' && rp.pin.gpio != null && pinLabel !== `GP${rp.pin.gpio}`
                ? `GP${rp.pin.gpio}`
                : undefined
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
                  <circle cx={cx} cy={cy} r={Math.max(0.8, size / 2 - 3.5 * pinScale)} fill="var(--bc-mat, #0c0f12)" />
                </>
              )
            } else if (shape === 'octagonal') {
              pad = octagonalPad(cx, cy, size, fill, stroke, sw)
            } else {
              pad = (
                <>
                  <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />
                  <circle cx={cx} cy={cy} r={2.3 * pinScale} fill="var(--bc-mat, #0c0f12)" />
                </>
              )
            }
            const lo = rp.pin.labelOffset
            const dragTf = lo ? `translate(${lo.x * box.w} ${lo.y * box.h})` : undefined
            // Shrink the number-box + label on a tight pitch — pivoted at the BOARD
            // EDGE the annotation is anchored to (via boxedPinLabel), NOT the pin. A
            // pin set in from the edge (e.g. the Servo 2040's headers at y≈0.17) keeps
            // its label out in the margin instead of being dragged inward over the
            // image. Any hand-placed drag offset stays unscaled (#…).
            const bdir = pinOutwardDir(rp.pin.rotation, rp.x, rp.y)
            const epx = bdir === 'left' ? box.x : bdir === 'right' ? box.x + box.w : cx
            const epy = bdir === 'top' ? box.y : bdir === 'bottom' ? box.y + box.h : cy
            const scaleTf = pinScale !== 1 ? `translate(${epx} ${epy}) scale(${pinScale}) translate(${-epx} ${-epy})` : undefined
            const labelTf = [scaleTf, dragTf].filter(Boolean).join(' ') || undefined
            const labelDraggable = interactive && !locked.pins
            return (
              <g key={`p${i}`}>
                {/* Mask the pad (not its label) so the through-hole shows the real
                    background, not a painted dot (#171). */}
                {hasCuts ? <g mask={`url(#${maskId})`}>{pad}</g> : pad}
                {/* The pin's label annotation (number box + label + chips) — a single
                    group so it can be DRAGGED to a hand-placed spot (#…), stored as
                    `labelOffset` and applied here as a translate. `labelHidden` pins
                    (a servo header's V+/GND rows) draw the pad only — no annotation. */}
                {!rp.pin.labelHidden && (
                <g
                  transform={labelTf}
                  className={labelDraggable ? 'pcv__pinlabel--drag' : undefined}
                  onPointerDown={labelDraggable ? (e) => startLabelDrag(e, rp) : undefined}
                >
                  {/* Boxed annotation: a grey board-pin-number box at the edge then
                      the label — the same style as the breadboard / mini board view. */}
                  {boxedPinLabel(
                    box,
                    cx,
                    cy,
                    pinOutwardDir(rp.pin.rotation, rp.x, rp.y),
                    String(rp.pin.number ?? rp.pin.gpio ?? ''),
                    pinLabel,
                    gpioVar,
                    'currentColor'
                  )}
                  {/* Persistent capability chips next to the label (#…): PWM, ADC,
                      SPI, I2C, UART, in that order — refined to the pin's signal
                      (SDA/SCL, SCK, …) — clearing past the GP## label. */}
                  {capabilityChips(
                    box,
                    cx,
                    cy,
                    pinOutwardDir(rp.pin.rotation, rp.x, rp.y),
                    pinLabel,
                    rp.pin.capabilities,
                    rp.pin.signals,
                    gpioVar,
                    rp.pin.buses
                  )}
                </g>
                )}
              </g>
            )
          })}

        {/* Ghost pin array (#…): a faint 2.54mm grid centred on the selected pin —
            shown only WHILE Ctrl/Cmd is held (grid mode), so a plain drag just
            moves the pin. A drag from the anchor then lays a row/column. */}
        {interactive && selPin && gridKey && visible.pins && !locked.pins && (
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

        {/* Live preview of a servo-header STRIP being dragged out: a faint S/V/G
            column per header + a count badge. */}
        {interactive && stripPreview && (
          <g className="pcv__strip-preview" aria-hidden="true" style={{ pointerEvents: 'none' }}>
            {Array.from({ length: stripPreview.n }, (_, k) => {
              const x = clamp01(stripPreview.x + k * stepNX)
              const r = connPxPerMm > 0 ? 1.2 * connPxPerMm : 5
              return [0, 1, 2].map((row) => {
                const y = clamp01(stripPreview.y + row * stepNY)
                return (
                  <circle
                    key={`sp${k}-${row}`}
                    cx={px(x)}
                    cy={py(y)}
                    r={r}
                    fill={row === 0 ? '#d6a531' : row === 1 ? '#c0392b' : '#3a3f44'}
                    stroke="#fff"
                    strokeWidth={0.8}
                    opacity={0.7}
                  />
                )
              })
            })}
            <text
              x={px(clamp01(stripPreview.x + (stripPreview.n - 1) * stepNX)) + 10}
              y={py(stripPreview.y) - 6}
              className="pcv__strip-count"
              fill="#fff"
              fontSize={11}
              fontWeight={700}
            >
              ×{stripPreview.n}
            </text>
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
        {/* …and a bbox ring on each multi-selected component. */}
        {interactive &&
          selComponents.map((c) => {
            if (c.type === 'label') {
              const l = labels[c.index]
              if (!l) return null
              return <circle key={`selc-l${c.index}`} cx={px(l.x)} cy={py(l.y)} r={11} className="pcv__sel-ring" />
            }
            const s = shapes[c.index]
            if (!s) return null
            let x: number
            let y: number
            let w: number
            let h: number
            if (s.kind === 'circle') {
              const r = (s.r ?? 0.08) * box.w
              x = px(s.x) - r
              y = py(s.y) - r
              w = r * 2
              h = r * 2
            } else if (s.kind === 'polygon' && s.points?.length) {
              const xs = s.points.map((p) => px(p.x))
              const ys = s.points.map((p) => py(p.y))
              x = Math.min(...xs)
              y = Math.min(...ys)
              w = Math.max(...xs) - x
              h = Math.max(...ys) - y
            } else {
              x = px(s.x)
              y = py(s.y)
              w = (s.w ?? 0.2) * box.w
              h = (s.h ?? 0.15) * box.h
            }
            const rot = s.rotation ?? 0
            const piv = shapeRotationCenterN(s)
            return (
              <rect
                key={`selc-s${c.index}`}
                x={x - 3}
                y={y - 3}
                width={w + 6}
                height={h + 6}
                rx={3}
                className="pcv__sel-ring"
                transform={rot ? `rotate(${rot} ${px(piv.cx)} ${py(piv.cy)})` : undefined}
              />
            )
          })}
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
          orderedItems(part).map((c) => {
            if (c.kind === 'button') {
              const i = c.index
              const b = buttons[i]
              const cx = px(b.x)
              const cy = py(b.y)
              const labelY = cy + PART_BUTTON_SIZE * 0.5 + 9
              return (
                <g key={`btn${i}`}>
                  {partButtonGlyph(cx, cy, PART_BUTTON_SIZE, isSel({ type: 'button', index: i }))}
                  {b.label &&
                    styledText({
                      text: b.label,
                      cx,
                      cy: labelY,
                      fontSize: 9,
                      fill: isSel({ type: 'button', index: i }) ? '#fff' : '#cfd6dd'
                    })}
                </g>
              )
            }
            if (c.kind === 'led') {
              const i = c.index
              const led = onboardLeds[i]
              const cx = px(led.x)
              const cy = py(led.y)
              const sel = isSel({ type: 'led', index: i })
              const labelY = cy + 18
              const draggable = interactive && !locked.components
              return (
                <g key={`led${i}`}>
                  {onboardLedGlyph(cx, cy, led, sel, connPxPerMm)}
                  <g
                    transform={componentLabelTransform(cx, labelY, box.w, box.h, led.labelOffset, led.labelRotation)}
                    className={draggable ? 'pcv__pinlabel--drag' : undefined}
                    onPointerDown={draggable ? (e) => startCompLabelDrag(e, { type: 'led', index: i }, led.labelOffset) : undefined}
                  >
                    {styledText({ text: onboardLedLabel(led), cx, cy: labelY, fontSize: 9, fill: sel ? '#fff' : '#cfd6dd' })}
                  </g>
                </g>
              )
            }
            if (c.kind === 'connector') {
              const i = c.index
              const conn = connectors[i]
              const cx = px(conn.x)
              const cy = py(conn.y)
              const { h: connH } = connectorSize(conn, connPxPerMm)
              const sel = isSel({ type: 'connector', index: i })
              const labelY = cy + connH / 2 + 11
              const draggable = interactive && !locked.components
              return (
                <g key={`conn${i}`}>
                  {connectorGlyph(cx, cy, conn, sel, connPxPerMm)}
                  <g
                    transform={componentLabelTransform(cx, labelY, box.w, box.h, conn.labelOffset, conn.labelRotation)}
                    className={draggable ? 'pcv__pinlabel--drag' : undefined}
                    onPointerDown={draggable ? (e) => startCompLabelDrag(e, { type: 'connector', index: i }, conn.labelOffset) : undefined}
                  >
                    {styledText({ text: connectorLabel(conn), cx, cy: labelY, fontSize: 9, fill: sel ? '#fff' : '#cfd6dd' })}
                  </g>
                </g>
              )
            }
            if (c.kind === 'label') {
              const i = c.index
              const l = labels[i]
              return (
                <g key={`l${i}`}>
                  {styledText({
                    text: l.text,
                    cx: px(l.x),
                    cy: py(l.y),
                    fontSize: l.fontSize ?? 12,
                    bold: l.bold,
                    italic: l.italic,
                    underline: l.underline,
                    align: l.align,
                    fill: isSel({ type: 'label', index: i }) ? '#fff' : (l.color ?? 'var(--text, #e9edf1)'),
                    baseWeight: 600,
                    transform: l.rotation ? `rotate(${l.rotation} ${px(l.x)} ${py(l.y)})` : undefined
                  })}
                </g>
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
            let labelW: number
            if (s.kind === 'circle') {
              const r = (s.r ?? 0.08) * box.w
              el = <circle cx={px(s.x)} cy={py(s.y)} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
              lcx = px(s.x)
              lcy = py(s.y)
              labelW = 2 * r
            } else if (s.kind === 'polygon') {
              const pts = s.points ?? []
              el = <polygon points={pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} />
              const xs = pts.map((p) => px(p.x))
              lcx = pts.length ? px(pts.reduce((a, p) => a + p.x, 0) / pts.length) : px(s.x)
              lcy = pts.length ? py(pts.reduce((a, p) => a + p.y, 0) / pts.length) : py(s.y)
              labelW = xs.length ? Math.max(...xs) - Math.min(...xs) : 80
            } else {
              const w = (s.w ?? 0.2) * box.w
              const h = (s.h ?? 0.15) * box.h
              el = <rect x={px(s.x)} y={py(s.y)} width={w} height={h} rx={s.cornerRadius ?? 3} fill={fill} stroke={stroke} strokeWidth={sw} />
              lcx = px(s.x) + w / 2
              lcy = py(s.y) + h / 2
              labelW = w
            }
            const rot = s.rotation ?? 0
            return (
              <g key={`s${i}`} transform={rot ? `rotate(${rot} ${lcx} ${lcy})` : undefined}>
                {el}
                {s.label &&
                  styledText({
                    text: s.label,
                    cx: lcx,
                    cy: lcy,
                    fontSize: s.labelFontSize ?? 10,
                    bold: s.labelBold,
                    italic: s.labelItalic,
                    underline: s.labelUnderline,
                    align: s.labelAlign,
                    wrapWidth: s.labelWrap ? labelW : undefined,
                    fill: s.labelColor ?? '#cfd6dd'
                  })}
              </g>
            )
          })}

        {/* Buttons / LEDs / connectors now interleave with shapes+labels in the
            single z-ordered loop above (#130). */}

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

        {/* Resize handles for a selected rect / circle shape (#175). */}
        {interactive &&
          !locked.components &&
          selection?.type === 'shape' &&
          shapes[selection.index] &&
          (() => {
            const s = shapes[selection.index]
            let pts: [number, number][] = []
            if (s.kind === 'rect' && !s.rotation) {
              const w = s.w ?? 0.2
              const h = s.h ?? 0.15
              pts = [
                [s.x, s.y],
                [s.x + w, s.y],
                [s.x + w, s.y + h],
                [s.x, s.y + h],
                [s.x + w / 2, s.y],
                [s.x + w, s.y + h / 2],
                [s.x + w / 2, s.y + h],
                [s.x, s.y + h / 2]
              ]
            } else if (s.kind === 'circle') {
              const r = s.r ?? 0.08
              const ry = (r * box.w) / box.h
              pts = [
                [s.x + r, s.y],
                [s.x - r, s.y],
                [s.x, s.y + ry],
                [s.x, s.y - ry]
              ]
            }
            return (
              <g>
                {pts.map(([hx, hy], c) => (
                  <rect key={c} x={px(hx) - 5} y={py(hy) - 5} width={10} height={10} fill="#4ea1ff" stroke="#fff" />
                ))}
              </g>
            )
          })()}

        {/* Board polygon vertex handles (shape tool) */}
        {interactive &&
          tool === 'shape' &&
          !locked.image &&
          usePolygon &&
          (part.polygon ?? []).map((p, i) => (
            <rect key={`v${i}`} x={px(p.x) - 5} y={py(p.y) - 5} width={10} height={10} fill={isSel({ type: 'vertex', index: i }) ? '#fff' : '#4ea1ff'} stroke="#0008" />
          ))}

        {/* Component-polygon vertex handles (a polygon shape is selected; hidden
            while rotated — its vertices are edited in the un-rotated frame). */}
        {interactive &&
          !locked.components &&
          (selection?.type === 'shape' || selection?.type === 'shape-vertex') &&
          shapes[selection.index]?.kind === 'polygon' &&
          !shapes[selection.index]?.rotation &&
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
      {/* Inline caption editor — a textarea over the shape (double-click). Enter
          inserts a new line; Esc / blur commits and closes. */}
      {interactive &&
        editLabelIdx !== null &&
        (() => {
          const idx = editLabelIdx
          const s = shapes[idx]
          if (!s) return null
          const r = labelEditRect(idx)
          if (!r) return null
          return (
            <textarea
              className="pcv__label-edit"
              autoFocus
              style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
              value={s.label ?? ''}
              placeholder="Text…"
              onChange={(e) => updateShape(idx, { label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditLabelIdx(null)
                }
              }}
              onBlur={() => setEditLabelIdx(null)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          )
        })()}
      {/* Alignment toolbar — floats above the LAST selected item (≥2 pins and/or
          components selected). */}
      {interactive &&
        alignCount >= 2 &&
        (() => {
          const anchor = alignAnchorPx()
          const style = anchor
            ? { left: `${anchor.left}px`, top: `${anchor.top}px`, transform: 'translate(-50%, calc(-100% - 14px))' }
            : undefined
          const selGroup = selectionGroup()
          return (
            <div className="pcv__align" role="toolbar" aria-label="Align selection" style={style}>
              <span className="pcv__align-count">{alignCount}</span>
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
              <button type="button" className="pcv__align-btn" onClick={() => distributeSelected('x')} title="Distribute horizontally" disabled={alignCount < 3}>
                {alignIcon('distX')}
              </button>
              <button type="button" className="pcv__align-btn" onClick={() => distributeSelected('y')} title="Distribute vertically" disabled={alignCount < 3}>
                {alignIcon('distY')}
              </button>
              <span className="pcv__align-sep" />
              <button
                type="button"
                className="pcv__align-btn"
                onClick={groupSelection}
                title={selGroup ? 'Group again (nest)' : 'Group selection'}
              >
                {groupIcon(false)}
              </button>
              {selGroup && (
                <>
                  <button
                    type="button"
                    className="pcv__align-btn"
                    onClick={() => ungroupSelection(selGroup)}
                    title="Ungroup"
                  >
                    {groupIcon(true)}
                  </button>
                  <button
                    type="button"
                    className="pcv__align-btn"
                    onClick={() => rotateGroup(selGroup)}
                    title="Rotate group 90°"
                    aria-label="Rotate group 90 degrees"
                  >
                    {rotateIcon}
                  </button>
                  <button
                    type="button"
                    className="pcv__align-btn pcv__align-btn--danger"
                    onClick={() => deleteGroup(selGroup)}
                    title="Delete group"
                    aria-label="Delete group"
                  >
                    {delIcon}
                  </button>
                </>
              )}
            </div>
          )
        })()}

      {/* Selected-component toolbar — floats above a single selected shape / label
          (hidden while a multi-selection is active; the align toolbar shows then). */}
      {interactive &&
        !locked.components &&
        alignCount === 0 &&
        (selection?.type === 'shape' || selection?.type === 'label') &&
        (() => {
          const sel = selection
          if (sel?.type !== 'shape' && sel?.type !== 'label') return null
          const anchor = componentAnchorPx(sel)
          const style = anchor
            ? { left: `${anchor.left}px`, top: `${anchor.top}px`, transform: 'translate(-50%, calc(-100% - 14px))' }
            : undefined
          const shape = sel.type === 'shape' ? shapes[sel.index] : null
          return (
            <div className="pcv__ctb" role="toolbar" aria-label="Edit component" style={style}>
              <button type="button" className="pcv__ctb-btn" title="Duplicate" aria-label="Duplicate component" onClick={() => duplicateComponent(sel)}>
                {dupIcon}
              </button>
              <button type="button" className="pcv__ctb-btn" title="Rotate 90°" aria-label="Rotate component 90 degrees" onClick={() => rotateComponent(sel)}>
                {rotateIcon}
              </button>
              {/* Text (A) dropdown — label size / colour / B-I-U / align / wrap, for
                  both shape captions and free labels. */}
              {(() => {
                const ls = labelStyle(sel)
                if (!ls) return null
                const tbtn = (
                  active: boolean,
                  label: JSX.Element | string,
                  title: string,
                  on: () => void,
                  st?: CSSProperties
                ): JSX.Element => (
                  <button
                    type="button"
                    className={`pcv__ctb-tbtn${active ? ' is-active' : ''}`}
                    title={title}
                    aria-pressed={active}
                    onClick={on}
                    style={st}
                  >
                    {label}
                  </button>
                )
                // Text-alignment icons (rows of lines anchored left / centred / right).
                const alignIco = (a: 'left' | 'center' | 'right'): JSX.Element => {
                  const lines =
                    a === 'left'
                      ? ['M2 4h12', 'M2 8h7', 'M2 12h10']
                      : a === 'right'
                        ? ['M2 4h12', 'M7 8h7', 'M4 12h10']
                        : ['M2 4h12', 'M4.5 8h7', 'M3 12h10']
                  return (
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <g stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
                        {lines.map((d, k) => (
                          <path key={k} d={d} />
                        ))}
                      </g>
                    </svg>
                  )
                }
                return (
                  <div className="pcv__ctb-text">
                    <button
                      type="button"
                      className="pcv__ctb-btn"
                      title="Text style"
                      aria-label="Text style"
                      aria-haspopup="menu"
                      aria-expanded={textMenuOpen}
                      onClick={() => {
                        setFillMenuOpen(false)
                        setBorderMenuOpen(false)
                        setTextMenuOpen((o) => !o)
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M3.5 13 8 3l4.5 10M5.4 9.4h5.2" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {textMenuOpen && (
                      <div className="pcv__ctb-menu" role="menu" aria-label="Text style">
                        <div className="pcv__ctb-row">
                          <span>Size</span>
                          <input
                            type="range"
                            min={4}
                            max={48}
                            step={1}
                            value={ls.fontSize}
                            onChange={(e) => setLabelStyle(sel, { fontSize: Number(e.target.value) })}
                            aria-label="Label font size"
                          />
                          <input
                            type="number"
                            min={4}
                            max={48}
                            step={1}
                            className="pcv__ctb-num"
                            value={ls.fontSize}
                            onChange={(e) => setLabelStyle(sel, { fontSize: Math.max(1, Number(e.target.value) || 0) })}
                            aria-label="Label font size value"
                          />
                        </div>
                        <div className="pcv__ctb-row">
                          <span>Colour</span>
                          <input
                            type="color"
                            value={/^#[0-9a-f]{6}$/i.test(ls.color) ? ls.color : '#cfd6dd'}
                            onChange={(e) => setLabelStyle(sel, { color: e.target.value })}
                            aria-label="Label text colour"
                          />
                        </div>
                        {ctbSwatches((col) => setLabelStyle(sel, { color: col }))}
                        <div className="pcv__ctb-row pcv__ctb-tbtns">
                          {tbtn(ls.bold, 'B', 'Bold', () => setLabelStyle(sel, { bold: !ls.bold }), { fontWeight: 700 })}
                          {tbtn(ls.italic, 'I', 'Italic', () => setLabelStyle(sel, { italic: !ls.italic }), { fontStyle: 'italic' })}
                          {tbtn(ls.underline, 'U', 'Underline', () => setLabelStyle(sel, { underline: !ls.underline }), { textDecoration: 'underline' })}
                        </div>
                        {/* Alignment (+ wrap) kept together on their own row. */}
                        <div className="pcv__ctb-row pcv__ctb-tbtns">
                          {tbtn(ls.align === 'left', alignIco('left'), 'Align left', () => setLabelStyle(sel, { align: 'left' }))}
                          {tbtn(ls.align === 'center', alignIco('center'), 'Align centre', () => setLabelStyle(sel, { align: 'center' }))}
                          {tbtn(ls.align === 'right', alignIco('right'), 'Align right', () => setLabelStyle(sel, { align: 'right' }))}
                          {ls.canWrap && (
                            <>
                              <span className="pcv__ctb-tsep" />
                              {tbtn(ls.wrap, '↵', 'Wrap text to the shape', () => setLabelStyle(sel, { wrap: !ls.wrap }))}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
              {shape && (
                <>
                  <div className="pcv__ctb-fill">
                    <button
                      type="button"
                      className="pcv__ctb-well"
                      title="Fill colour"
                      aria-label="Fill colour"
                      aria-haspopup="menu"
                      aria-expanded={fillMenuOpen}
                      style={{ background: shape.fill ?? DEFAULT_SHAPE_FILL }}
                      onClick={() => {
                        setBorderMenuOpen(false)
                        setFillMenuOpen((o) => !o)
                      }}
                    />
                    {fillMenuOpen && (
                      <div className="pcv__ctb-menu" role="menu" aria-label="Fill">
                        <div className="pcv__ctb-row">
                          <span>Fill</span>
                          <input
                            type="color"
                            value={shape.fill ?? DEFAULT_SHAPE_FILL}
                            onChange={(e) => updateShape(sel.index, { fill: e.target.value })}
                            aria-label="Fill colour"
                          />
                        </div>
                        {ctbSwatches((col) => updateShape(sel.index, { fill: col }))}
                      </div>
                    )}
                  </div>
                  <div className="pcv__ctb-border">
                    <button
                      type="button"
                      className="pcv__ctb-btn"
                      title="Border"
                      aria-label="Border"
                      aria-haspopup="menu"
                      aria-expanded={borderMenuOpen}
                      onClick={() => {
                        setFillMenuOpen(false)
                        setBorderMenuOpen((o) => !o)
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill="none" stroke="currentColor" strokeWidth={2} />
                      </svg>
                    </button>
                    {borderMenuOpen && (
                      <div className="pcv__ctb-menu" role="menu" aria-label="Border">
                        <div className="pcv__ctb-row">
                          <span>Width</span>
                          <input
                            type="range"
                            min={0}
                            max={8}
                            step={0.5}
                            value={shape.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH}
                            onChange={(e) => updateShape(sel.index, { strokeWidth: Number(e.target.value) })}
                            aria-label="Border width"
                          />
                          <input
                            type="number"
                            min={0}
                            max={8}
                            step={0.5}
                            className="pcv__ctb-num"
                            value={shape.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH}
                            onChange={(e) => updateShape(sel.index, { strokeWidth: Math.max(0, Number(e.target.value) || 0) })}
                            aria-label="Border width value"
                          />
                        </div>
                        <div className="pcv__ctb-row">
                          <span>Colour</span>
                          <input
                            type="color"
                            value={shape.stroke ?? DEFAULT_SHAPE_STROKE}
                            onChange={(e) => updateShape(sel.index, { stroke: e.target.value })}
                            aria-label="Border colour"
                          />
                        </div>
                        {ctbSwatches((col) => updateShape(sel.index, { stroke: col }))}
                        {shape.kind === 'rect' && (
                          <div className="pcv__ctb-row">
                            <span>Corner</span>
                            <input
                              type="range"
                              min={0}
                              max={40}
                              step={1}
                              value={shape.cornerRadius ?? DEFAULT_SHAPE_CORNER}
                              onChange={(e) => updateShape(sel.index, { cornerRadius: Number(e.target.value) })}
                              aria-label="Corner radius"
                            />
                            <input
                              type="number"
                              min={0}
                              max={40}
                              step={1}
                              className="pcv__ctb-num"
                              value={shape.cornerRadius ?? DEFAULT_SHAPE_CORNER}
                              onChange={(e) =>
                                updateShape(sel.index, { cornerRadius: Math.max(0, Number(e.target.value) || 0) })
                              }
                              aria-label="Corner radius value"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
              {styleClipButtons(sel, sel.type)}
              <button type="button" className="pcv__ctb-btn pcv__ctb-btn--danger" title="Delete" aria-label="Delete component" onClick={() => deleteComponent(sel)}>
                {delIcon}
              </button>
            </div>
          )
        })()}

      {/* Selected-pin toolbar — duplicate + copy/paste style (single pin only). */}
      {interactive &&
        !locked.pins &&
        alignCount === 0 &&
        selection?.type === 'pin' &&
        (() => {
          const sel = selection
          const rp = pins.find((p) => p.hi === sel.hi && p.pi === sel.pi)
          if (!rp) return null
          const anchor = componentAnchorPx(sel)
          const style = anchor
            ? { left: `${anchor.left}px`, top: `${anchor.top}px`, transform: 'translate(-50%, calc(-100% - 14px))' }
            : undefined
          return (
            <div className="pcv__ctb" role="toolbar" aria-label="Edit pin" style={style}>
              <button type="button" className="pcv__ctb-btn" title="Duplicate" aria-label="Duplicate pin" onClick={() => duplicatePin(sel)}>
                {dupIcon}
              </button>
              <button type="button" className="pcv__ctb-btn" title="Rotate 90° (turns the label; the half-hole on castellated pads)" aria-label="Rotate pin 90 degrees" onClick={() => rotatePin(sel)}>
                {rotateIcon}
              </button>
              {styleClipButtons(sel, 'pin')}
            </div>
          )
        })()}

      {/* Selected-mounting-hole toolbar — duplicate / size / copy-paste style /
          delete (single hole only). */}
      {interactive &&
        !locked.holes &&
        alignCount === 0 &&
        selection?.type === 'hole' &&
        (() => {
          const sel = selection
          const hole = holes[sel.index]
          if (!hole) return null
          const anchor = componentAnchorPx(sel)
          const style = anchor
            ? { left: `${anchor.left}px`, top: `${anchor.top}px`, transform: 'translate(-50%, calc(-100% - 14px))' }
            : undefined
          return (
            <div className="pcv__ctb" role="toolbar" aria-label="Edit mounting hole" style={style}>
              <button type="button" className="pcv__ctb-btn" title="Duplicate" aria-label="Duplicate hole" onClick={() => duplicateHole(sel.index)}>
                {dupIcon}
              </button>
              <div className="pcv__ctb-size">
                <button
                  type="button"
                  className="pcv__ctb-btn"
                  title="Size (diameter)"
                  aria-label="Hole size"
                  aria-haspopup="menu"
                  aria-expanded={holeMenuOpen}
                  onClick={() => {
                    setFillMenuOpen(false)
                    setBorderMenuOpen(false)
                    setTextMenuOpen(false)
                    setHoleMenuOpen((o) => !o)
                  }}
                >
                  {diaIcon}
                </button>
                {holeMenuOpen && (
                  <div className="pcv__ctb-menu" role="menu" aria-label="Hole size">
                    <div className="pcv__ctb-row">
                      <span>⌀ mm</span>
                      <input
                        type="range"
                        min={0.5}
                        max={10}
                        step={0.1}
                        value={hole.diameter}
                        onChange={(e) => updateHole(sel.index, { diameter: Number(e.target.value) })}
                        aria-label="Hole diameter"
                      />
                      <input
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.1}
                        className="pcv__ctb-num"
                        value={hole.diameter}
                        onChange={(e) => updateHole(sel.index, { diameter: Math.max(0.1, Number(e.target.value) || 0) })}
                        aria-label="Hole diameter value"
                      />
                    </div>
                  </div>
                )}
              </div>
              {styleClipButtons(sel, 'hole')}
              <button type="button" className="pcv__ctb-btn pcv__ctb-btn--danger" title="Delete" aria-label="Delete hole" onClick={() => deleteHole(sel.index)}>
                {delIcon}
              </button>
            </div>
          )
        })()}
      {/* Contextual hint: tell the user Ctrl unlocks the alignment grid. Shown
          only while a single pin is selected (the gesture it describes). It
          highlights while Ctrl/Cmd is actually held (grid mode live). */}
      {interactive && selPin && (
        <div className={`pcv__hint${gridKey ? ' is-active' : ''}`} role="status">
          {gridKey ? (
            <>
              <kbd className="pcv__hint-key">{cmdOrCtrlLabel}</kbd>
              <span>Grid — drag from the pin to lay a row / column</span>
            </>
          ) : (
            <>
              <span>Drag to move ·</span>
              <kbd className="pcv__hint-key">{cmdOrCtrlLabel}</kbd>
              <span>grid ·</span>
              <kbd className="pcv__hint-key">Shift</kbd>
              <span>free</span>
            </>
          )}
        </div>
      )}
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
