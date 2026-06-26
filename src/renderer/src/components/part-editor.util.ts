/**
 * Pure (DOM-free) helpers backing the Part Editor (#130) and the Parts Library
 * panel (#129).
 *
 * Everything here is plain data-in / data-out so it can be unit-tested in a node
 * environment (mirrors `board-creator.util.ts`, `parse-pins.ts`, …). The React
 * components are thin shells over these functions.
 *
 * The on-disk `parts.yml` (see `src/shared/part-yaml.ts`) is the round-trippable
 * source of truth: {@link normalisePart} produces the canonical in-memory shape,
 * and `partFromYaml(partToYaml(normalisePart(p)))` deep-equals `normalisePart(p)`
 * (the round-trip the tests assert).
 *
 * {@link partToBoardDefinition} projects a Part onto the existing
 * {@link BoardDefinition} so the Board View's renderer draws the life-like
 * preview for free; the footprint preview is drawn by the editor itself.
 */

import type { BoardDefinition, BoardPad, BoardPadType, BoardHeader } from '../../../shared/board'
import {
  STANDARD_PIN_SPACING_MM,
  type ComponentShape,
  type ComponentShapeKind,
  type ImageLayer,
  type PartDefinition,
  type PartEdge,
  type PartFeature,
  type PartHeader,
  type PartLabel,
  type PartPin,
  type PartPinCapability,
  type PartPinShape,
  type PartPinType,
  type PartPackage,
  type PolygonPoint
} from '../../../shared/part'

/** The pin types the editor offers, in UI order. */
export const PIN_TYPES: PartPinType[] = ['io', 'pwr', 'gnd', 'other']

/** Human labels for each pin type. */
export const PIN_TYPE_LABEL: Record<PartPinType, string> = {
  io: 'IO',
  pwr: 'Power',
  gnd: 'Ground',
  other: 'Other'
}

/** The IO capabilities the editor offers (checkboxes), in UI order. */
export const CAPABILITIES: PartPinCapability[] = ['digital', 'pwm', 'adc', 'spi', 'i2c', 'uart']

/** Human labels for each capability. */
export const CAPABILITY_LABEL: Record<PartPinCapability, string> = {
  digital: 'Digital',
  pwm: 'PWM',
  adc: 'ADC',
  spi: 'SPI',
  i2c: 'I²C',
  uart: 'UART'
}

/** Package types, in UI order. */
export const PACKAGES: PartPackage[] = ['THT', 'SMD']

/** Pad shapes the editor offers, in UI order. */
export const PIN_SHAPES: PartPinShape[] = ['square', 'round', 'castellated', 'header']

/** Human labels for each pad shape. */
export const PIN_SHAPE_LABEL: Record<PartPinShape, string> = {
  square: 'Square',
  round: 'Round',
  castellated: 'Castellated',
  header: 'Header hole'
}

/** Component shape kinds the Shapes dropdown offers, in UI order. */
export const COMPONENT_SHAPES: ComponentShapeKind[] = ['rect', 'circle', 'polygon']

/** Human labels for each component shape kind. */
export const COMPONENT_SHAPE_LABEL: Record<ComponentShapeKind, string> = {
  rect: 'Rectangle',
  circle: 'Circle',
  polygon: 'Polygon'
}

/** Default colours for a freshly-added component shape. */
export const DEFAULT_SHAPE_FILL = '#1c2227'
export const DEFAULT_SHAPE_STROKE = '#8a8f96'
export const DEFAULT_SHAPE_STROKE_WIDTH = 1

/** The effective pad shape for a pin (honours the legacy `castellated` flag). */
export function pinShapeOf(pin: PartPin): PartPinShape {
  if (pin.shape) return pin.shape
  return pin.castellated ? 'castellated' : 'square'
}

/** Header edges, in UI order. */
export const PART_EDGES: PartHeader['edge'][] = ['left', 'right', 'top', 'bottom']

/**
 * Sanitise free text into a safe part/library id stem: lower-case, keep only
 * `[a-z0-9-_]`, collapse other runs to `-`, trim. MUST match the main-process
 * sanitiser so the editor's filename preview agrees with what's written.
 */
export function sanitisePartId(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * Snap a normalised 0..1 coordinate to the part's pin-spacing grid. `spacingMm`
 * is the header pitch (default 2.54); `sizeMm` is the board's extent along that
 * axis. Falls back to a 20-step grid when the physical size is unknown.
 */
export function snapToGrid(value: number, spacingMm: number, sizeMm?: number): number {
  const v = clamp(value, 0, 1)
  if (sizeMm && sizeMm > 0 && spacingMm > 0) {
    const steps = Math.max(1, Math.round(sizeMm / spacingMm))
    return clamp(Math.round(v * steps) / steps, 0, 1)
  }
  const steps = 20
  return Math.round(v * steps) / steps
}

/** A fresh blank pin (defaults to a digital IO pin). */
export function blankPin(): PartPin {
  return { name: 'GP0', type: 'io', gpio: 0, capabilities: ['digital'] }
}

/** A fresh blank header on the given edge. */
export function blankHeader(edge: PartHeader['edge'] = 'left'): PartHeader {
  return { edge, pins: [blankPin()] }
}

/**
 * A fresh, sensible blank part: a small breakout with a power/ground/IO header
 * so the preview shows something immediately. `id` is derived from the name.
 */
export function blankPart(): PartDefinition {
  return {
    id: 'my-part',
    name: 'My Part',
    description: '',
    manufacturer: '',
    family: 'Breakout',
    tags: [],
    package: 'THT',
    pinSpacing: STANDARD_PIN_SPACING_MM,
    voltage: '3.3V',
    version: '0.1.0',
    pcbColor: '#0f5a2e',
    aspect: 0.5,
    dimensions: { width: 20, height: 40 },
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'VCC', type: 'pwr' },
          { name: 'GND', type: 'gnd' },
          { name: 'GP0', type: 'io', gpio: 0, capabilities: ['digital', 'pwm'] },
          { name: 'GP1', type: 'io', gpio: 1, capabilities: ['digital'] }
        ]
      }
    ]
  }
}

/** Normalise one capability list: keep only known caps, dedupe, drop if empty. */
function normaliseCaps(caps: PartPinCapability[] | undefined): PartPinCapability[] | undefined {
  if (!Array.isArray(caps)) return undefined
  const seen = new Set<PartPinCapability>()
  for (const c of caps) if (CAPABILITIES.includes(c)) seen.add(c)
  // Keep canonical UI order.
  const out = CAPABILITIES.filter((c) => seen.has(c))
  return out.length ? out : undefined
}

/**
 * Even fractional positions for `n` items along an edge (inset from the ends) —
 * the layout legacy edge-based pins are migrated onto. Mirrors the canvas.
 */
function spread(n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0.5]
  const inset = 0.5 / n
  return Array.from({ length: n }, (_, i) => inset + (i * (1 - 2 * inset)) / (n - 1))
}

/**
 * Derive an absolute 0..1 board position for a legacy edge-based pin (no stored
 * x/y) from its edge + order. Pads sit just inside the named edge. Used by the
 * one-time migration so "pure free placement" parts always have a real position.
 */
export function derivePinPosition(edge: PartEdge, index: number, count: number): { x: number; y: number } {
  const f = spread(count)[index] ?? 0.5
  switch (edge) {
    case 'left':
      return { x: 0.06, y: f }
    case 'right':
      return { x: 0.94, y: f }
    case 'top':
      return { x: f, y: 0.06 }
    default:
      return { x: f, y: 0.94 }
  }
}

/** Normalise a single pin: default type, clean fields, gate IO-only fields. */
function normalisePin(pin: PartPin): PartPin {
  const type: PartPinType = PIN_TYPES.includes(pin.type) ? pin.type : 'io'
  const name = String(pin.name ?? '').trim()
  const out: PartPin = { name, type }
  if (typeof pin.number === 'number' && Number.isFinite(pin.number)) out.number = pin.number
  if (type === 'io') {
    if (typeof pin.gpio === 'number' && Number.isFinite(pin.gpio)) out.gpio = pin.gpio
    const caps = normaliseCaps(pin.capabilities)
    if (caps) out.capabilities = caps
  }
  const label = String(pin.label ?? '').trim()
  if (label && label !== name) out.label = label
  if (pin.castellated === true) out.castellated = true
  if (PIN_SHAPES.includes(pin.shape as PartPinShape)) out.shape = pin.shape
  if (typeof pin.rotation === 'number' && Number.isFinite(pin.rotation)) {
    out.rotation = ((Math.round(pin.rotation / 90) * 90) % 360 + 360) % 360
  }
  if (typeof pin.x === 'number' && Number.isFinite(pin.x)) out.x = clamp(pin.x, 0, 1)
  if (typeof pin.y === 'number' && Number.isFinite(pin.y)) out.y = clamp(pin.y, 0, 1)
  return out
}

/** Normalise one component shape: validate kind, clamp coords, default colours. */
function normaliseShape(s: ComponentShape): ComponentShape {
  const kind: ComponentShapeKind = COMPONENT_SHAPES.includes(s.kind) ? s.kind : 'rect'
  const out: ComponentShape = { kind, x: clamp(s.x, -0.2, 1.2), y: clamp(s.y, -0.2, 1.2) }
  const label = String(s.label ?? '').trim()
  if (label) out.label = label
  out.fill = typeof s.fill === 'string' && s.fill.trim() ? s.fill : DEFAULT_SHAPE_FILL
  out.stroke = typeof s.stroke === 'string' && s.stroke.trim() ? s.stroke : DEFAULT_SHAPE_STROKE
  out.strokeWidth =
    typeof s.strokeWidth === 'number' && Number.isFinite(s.strokeWidth) && s.strokeWidth >= 0
      ? s.strokeWidth
      : DEFAULT_SHAPE_STROKE_WIDTH
  if (kind === 'rect') {
    out.w = clamp(typeof s.w === 'number' ? s.w : 0.2, 0.01, 1.4)
    out.h = clamp(typeof s.h === 'number' ? s.h : 0.15, 0.01, 1.4)
  } else if (kind === 'circle') {
    out.r = clamp(typeof s.r === 'number' ? s.r : 0.1, 0.005, 1)
  } else if (kind === 'polygon') {
    const pts =
      Array.isArray(s.points) && s.points.length >= 3
        ? s.points
        : [
            { x: out.x, y: out.y },
            { x: out.x + 0.15, y: out.y },
            { x: out.x + 0.075, y: out.y + 0.15 }
          ]
    out.points = pts.map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
  }
  if (typeof s.z === 'number' && Number.isFinite(s.z)) out.z = s.z
  return out
}

/** Fill colour for a migrated legacy feature, by its kind. */
function featureFill(kind: PartFeature['kind']): string {
  switch (kind) {
    case 'mcu':
      return '#2a2f36'
    case 'wifi':
      return '#3a2f1c'
    case 'usb':
      return '#3a3f44'
    case 'led':
      return '#5a2230'
    default:
      return DEFAULT_SHAPE_FILL
  }
}

/**
 * Convert a part's legacy {@link PartFeature}s into editable {@link ComponentShape}
 * rectangles (appended to `shapes`, features removed). The Part Editor runs this
 * on load so existing parts' chips become editable in the Components layer.
 */
export function withShapesFromFeatures(part: PartDefinition): PartDefinition {
  if (!part.features?.length) return part
  const migrated: ComponentShape[] = part.features.map((f) => ({
    kind: 'rect',
    label: f.label,
    fill: featureFill(f.kind),
    stroke: DEFAULT_SHAPE_STROKE,
    strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h
  }))
  const next = { ...part, shapes: [...(part.shapes ?? []), ...migrated] }
  delete next.features
  return next
}

// --- Components z-order (stacking) ------------------------------------------
// The Components layer is two arrays (shapes + labels). Draw order is a single
// `z` per item: higher z draws later (on top). Absent z falls back to a stable
// legacy order (shapes by index, then labels) so existing parts look unchanged.

/** One drawable component, resolved to its array + z. Sorted ascending by z =
 *  bottom→top draw order. The Components list shows the reverse (top of list =
 *  highest z = drawn on top). */
export interface OrderedComponent {
  kind: 'shape' | 'label'
  /** Index into `part.shapes` or `part.labels`. */
  index: number
  /** Resolved draw order (explicit `z`, else the legacy fallback). */
  z: number
}

/** Shapes + labels merged into one ascending-z draw order. Pure. */
export function orderedComponents(part: PartDefinition): OrderedComponent[] {
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const combined: OrderedComponent[] = [
    ...shapes.map((s, i) => ({ kind: 'shape' as const, index: i, z: s.z ?? i })),
    // Legacy default keeps labels above all shapes (today's look).
    ...labels.map((l, i) => ({ kind: 'label' as const, index: i, z: l.z ?? shapes.length + i }))
  ]
  // Stable sort by z; ties keep insertion order (shapes before labels).
  return combined
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.z - b.c.z || a.i - b.i)
    .map(({ c }) => c)
}

/** The z a newly-created component should take to land on top of everything. */
export function nextComponentZ(part: PartDefinition): number {
  const ord = orderedComponents(part)
  return ord.length ? ord[ord.length - 1].z + 1 : 0
}

/**
 * Append a shape or label and put it strictly ON TOP of every existing component,
 * renormalising all `z` to 0..n in the resolved order. Pure. (Computing a single
 * `z` before the append is unsafe: the no-`z` label fallback depends on the shape
 * count, which the append changes — so it can tie/overtake the new item.)
 */
export function addComponentOnTop(
  part: PartDefinition,
  kind: 'shape' | 'label',
  item: ComponentShape | PartLabel
): PartDefinition {
  const shapes = (part.shapes ?? []).map((s) => ({ ...s }))
  const labels = (part.labels ?? []).map((l) => ({ ...l }))
  let newIndex: number
  if (kind === 'shape') {
    shapes.push({ ...(item as ComponentShape) })
    newIndex = shapes.length - 1
  } else {
    labels.push({ ...(item as PartLabel) })
    newIndex = labels.length - 1
  }
  const ord = orderedComponents({ ...part, shapes, labels })
  const isNew = (c: OrderedComponent): boolean => c.kind === kind && c.index === newIndex
  // Everything except the new item keeps its resolved order; the new item goes last.
  const finalOrder = [...ord.filter((c) => !isNew(c)), ...ord.filter(isNew)]
  finalOrder.forEach((c, z) => {
    if (c.kind === 'shape') shapes[c.index].z = z
    else labels[c.index].z = z
  })
  return { ...part, shapes, labels }
}

/**
 * Move a component one step up (`dir: +1`, toward the front/top) or down
 * (`dir: -1`) in the unified z-order, renormalising every component's `z` to its
 * new 0..n-1 position. Pure: returns a NEW part (arrays + indices unchanged, only
 * `z` values change, so any live `{type,index}` selection stays valid). A no-op
 * (returns the same part) when the item is already at the end it's moving toward.
 */
export function reorderComponent(
  part: PartDefinition,
  item: { kind: 'shape' | 'label'; index: number },
  dir: 1 | -1
): PartDefinition {
  const ord = orderedComponents(part)
  const pos = ord.findIndex((c) => c.kind === item.kind && c.index === item.index)
  if (pos < 0) return part
  const swap = pos + dir
  if (swap < 0 || swap >= ord.length) return part
  const reordered = [...ord]
  ;[reordered[pos], reordered[swap]] = [reordered[swap], reordered[pos]]
  const shapes = (part.shapes ?? []).map((s) => ({ ...s }))
  const labels = (part.labels ?? []).map((l) => ({ ...l }))
  reordered.forEach((c, z) => {
    if (c.kind === 'shape') shapes[c.index].z = z
    else labels[c.index].z = z
  })
  return { ...part, shapes, labels }
}

// --- Polygon vertex insertion (edge click) ---------------------------------

/** Perpendicular distance from a normalised point to a segment, in viewBox units
 *  (so it shares the canvas HIT threshold). */
function segDistance(
  nx: number,
  ny: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  boxW: number,
  boxH: number
): number {
  const px = nx * boxW
  const py = ny * boxH
  const aX = ax * boxW
  const aY = ay * boxH
  const dX = (bx - ax) * boxW
  const dY = (by - ay) * boxH
  const len2 = dX * dX + dY * dY
  let t = len2 ? ((px - aX) * dX + (py - aY) * dY) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (aX + t * dX), py - (aY + t * dY))
}

/** The polygon ring edge (by start-vertex index) nearest a normalised point, with
 *  its distance in viewBox units. `index` is -1 for an empty ring. Pure. */
export function nearestPolygonEdge(
  points: PolygonPoint[],
  nx: number,
  ny: number,
  boxW: number,
  boxH: number
): { index: number; dist: number } {
  let bi = -1
  let bd = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const d = segDistance(nx, ny, a.x, a.y, b.x, b.y, boxW, boxH)
    if (d < bd) {
      bd = d
      bi = i
    }
  }
  return { index: bi, dist: bd }
}

/** Insert a point right after `edgeIndex` in a polygon ring. Pure. */
export function insertPolygonPoint(
  points: PolygonPoint[],
  edgeIndex: number,
  x: number,
  y: number
): PolygonPoint[] {
  return [...points.slice(0, edgeIndex + 1), { x, y }, ...points.slice(edgeIndex + 1)]
}

/**
 * Normalise + minimally clean a working {@link PartDefinition} into a canonical,
 * round-trippable form. Pure: returns a NEW object, never throws. Optional
 * fields are only set when they carry content (so the YAML round-trip — which
 * prunes empties — deep-equals this result).
 */
export function normalisePart(part: PartDefinition): PartDefinition {
  const headers: PartHeader[] = (Array.isArray(part.headers) ? part.headers : [])
    .map((h) => {
      const edge: PartEdge = PART_EDGES.includes(h.edge) ? h.edge : 'left'
      const pins = (Array.isArray(h.pins) ? h.pins : [])
        .map(normalisePin)
        .filter((p) => p.name !== '')
      // Migrate legacy edge-based pins (no stored x/y) to an absolute position so
      // the canvas can free-place them ("pure free placement" is the model).
      pins.forEach((p, i) => {
        if (p.x === undefined || p.y === undefined) {
          const pos = derivePinPosition(edge, i, pins.length)
          p.x = pos.x
          p.y = pos.y
        }
      })
      return { edge, pins }
    })
    .filter((h) => h.pins.length > 0)

  const out: PartDefinition = {
    id: sanitisePartId(part.id) || 'my-part',
    name: String(part.name ?? '').trim() || 'Untitled Part',
    headers
  }

  const set = <K extends keyof PartDefinition>(k: K, v: PartDefinition[K] | undefined): void => {
    if (v !== undefined) out[k] = v
  }
  const text = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim()
    return s === '' ? undefined : s
  }

  set('description', text(part.description))
  set('manufacturer', text(part.manufacturer))
  set('family', text(part.family))
  if (Array.isArray(part.tags)) {
    const tags = part.tags.map((t) => String(t).trim()).filter((t) => t !== '')
    if (tags.length) out.tags = tags
  }
  if (part.package === 'THT' || part.package === 'SMD') out.package = part.package
  if (typeof part.pinSpacing === 'number' && part.pinSpacing > 0) out.pinSpacing = part.pinSpacing
  set('voltage', text(part.voltage))
  set('partNumber', text(part.partNumber))
  if (part.properties && typeof part.properties === 'object') {
    const props: Record<string, string> = {}
    for (const [k, v] of Object.entries(part.properties)) {
      const key = k.trim()
      const val = text(v)
      if (key && val !== undefined) props[key] = val
    }
    if (Object.keys(props).length) out.properties = props
  }
  set('version', text(part.version))
  set('mcu', text(part.mcu))
  set('pcbColor', text(part.pcbColor))
  if (typeof part.aspect === 'number' && part.aspect > 0) out.aspect = part.aspect
  if (
    part.dimensions &&
    typeof part.dimensions.width === 'number' &&
    typeof part.dimensions.height === 'number' &&
    part.dimensions.width > 0 &&
    part.dimensions.height > 0
  ) {
    out.dimensions = { width: part.dimensions.width, height: part.dimensions.height }
  }
  if (Array.isArray(part.polygon) && part.polygon.length >= 3) {
    out.polygon = part.polygon.map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
  }
  if (part.shape && (part.shape.kind === 'rect' || part.shape.kind === 'polygon')) {
    out.shape = { kind: part.shape.kind }
    if (typeof part.shape.cornerRadius === 'number' && Number.isFinite(part.shape.cornerRadius)) {
      out.shape.cornerRadius = clamp(part.shape.cornerRadius, 0, 0.5)
    }
  }
  if (Array.isArray(part.mountingHoles) && part.mountingHoles.length) {
    out.mountingHoles = part.mountingHoles.map((h) => ({
      x: clamp(h.x, 0, 1),
      y: clamp(h.y, 0, 1),
      diameter: Number.isFinite(h.diameter) && h.diameter > 0 ? h.diameter : 2
    }))
  }
  if (Array.isArray(part.buttons) && part.buttons.length) {
    out.buttons = part.buttons.map((b) => ({
      label: String(b.label ?? '').trim(),
      x: clamp(b.x, 0, 1),
      y: clamp(b.y, 0, 1)
    }))
  }
  if (Array.isArray(part.features) && part.features.length) {
    out.features = part.features.map((f) => ({
      label: String(f.label ?? '').trim(),
      kind: (['mcu', 'wifi', 'usb', 'chip', 'led'] as const).includes(f.kind) ? f.kind : 'chip',
      x: clamp(f.x, -0.2, 1.2),
      y: clamp(f.y, -0.2, 1.2),
      w: clamp(f.w, 0.01, 1.4),
      h: clamp(f.h, 0.01, 1.4)
    }))
  }
  if (Array.isArray(part.shapes) && part.shapes.length) {
    out.shapes = part.shapes.map((s) => normaliseShape(s))
  }
  if (Array.isArray(part.labels) && part.labels.length) {
    const labels = part.labels
      .map((l) => {
        const lbl: PartLabel = {
          text: String(l.text ?? '').trim(),
          x: clamp(l.x, 0, 1),
          y: clamp(l.y, 0, 1)
        }
        if (typeof l.fontSize === 'number' && Number.isFinite(l.fontSize)) lbl.fontSize = l.fontSize
        if (typeof l.z === 'number' && Number.isFinite(l.z)) lbl.z = l.z
        return lbl
      })
      .filter((l) => l.text !== '')
    if (labels.length) out.labels = labels
  }
  set('ledLabel', text(part.ledLabel))
  // `image` is the relative filename; keep it. `imageData` (the runtime data URL)
  // is preserved for previews but is NOT part of the round-trip-comparable shape.
  set('image', text(part.image))
  if (
    part.imageLayer &&
    [part.imageLayer.x, part.imageLayer.y, part.imageLayer.w, part.imageLayer.h].every(
      (n) => typeof n === 'number' && Number.isFinite(n)
    )
  ) {
    const il: ImageLayer = {
      x: part.imageLayer.x,
      y: part.imageLayer.y,
      w: part.imageLayer.w,
      h: part.imageLayer.h
    }
    if (typeof part.imageLayer.opacity === 'number') il.opacity = clamp(part.imageLayer.opacity, 0, 1)
    if (typeof part.imageLayer.rotation === 'number' && Number.isFinite(part.imageLayer.rotation)) {
      il.rotation = part.imageLayer.rotation
    }
    out.imageLayer = il
  }
  if (part.schematic && Array.isArray(part.schematic.pins) && part.schematic.pins.length) {
    out.schematic = {
      ...(typeof part.schematic.aspect === 'number' ? { aspect: part.schematic.aspect } : {}),
      pins: part.schematic.pins.map((sp) => ({
        pin: String(sp.pin ?? '').trim(),
        side: PART_EDGES.includes(sp.side) ? sp.side : 'left',
        order: Number.isFinite(sp.order) ? sp.order : 0
      }))
    }
  }
  if (part.library) {
    const lib: NonNullable<PartDefinition['library']> = {}
    const mod = text(part.library.module)
    const url = text(part.library.url)
    const docs = text(part.library.docs)
    if (mod !== undefined) lib.module = mod
    if (url !== undefined) lib.url = url
    if (docs !== undefined) lib.docs = docs
    if (Object.keys(lib).length) out.library = lib
  }
  if (part.layerVisibility && typeof part.layerVisibility === 'object') {
    const lv: NonNullable<PartDefinition['layerVisibility']> = {}
    for (const key of ['image', 'holes', 'pins', 'components'] as const) {
      if (typeof part.layerVisibility[key] === 'boolean') lv[key] = part.layerVisibility[key]
    }
    if (Object.keys(lv).length) out.layerVisibility = lv
  }

  return out
}

/**
 * A blocking-error string if the part can't be saved, else null. Safe to call on
 * the RAW (un-normalised) part — it counts only pins with a non-empty name (the
 * ones {@link normalisePart} keeps), so the "give it a name" guard stays reachable
 * (calling it on the normalised part would never see an empty id).
 */
export function validatePart(part: PartDefinition): string | null {
  if (!sanitisePartId(part.id)) return 'Give the part a name (it becomes the saved id).'
  const pins = (part.headers ?? []).reduce(
    (n, h) => n + (h.pins ?? []).filter((p) => String(p.name ?? '').trim() !== '').length,
    0
  )
  if (pins === 0) return 'Add at least one pin to a header.'
  if (part.version && !/^\d+\.\d+(\.\d+)?(-[\w.]+)?$/.test(part.version.trim())) {
    return 'Version must look like 1.2.3.'
  }
  return null
}

/** Map a part pin type to the Board View's pad type for rendering. */
function pinTypeToPad(t: PartPinType): BoardPadType {
  switch (t) {
    case 'pwr':
      return 'vcc'
    case 'gnd':
      return 'gnd'
    case 'io':
      return 'gpio'
    default:
      return 'other'
  }
}

/**
 * Project a {@link PartDefinition} onto a {@link BoardDefinition} so the Board
 * View renderer draws the life-like preview. Pins → pads, features kept,
 * buttons rendered as small `chip` features, the image taken from `imageData`
 * (the runtime data URL) so it draws without disk access. Mounting holes /
 * polygon have no Board View analogue and are drawn by the footprint preview.
 */
export function partToBoardDefinition(part: PartDefinition): BoardDefinition {
  const headers: BoardHeader[] = (part.headers ?? []).map((h) => ({
    edge: h.edge,
    pins: h.pins.map((p): BoardPad => {
      const pad: BoardPad = {
        label: p.label || p.name,
        name: p.name,
        type: pinTypeToPad(p.type)
      }
      if (p.type === 'io' && typeof p.gpio === 'number') pad.gpio = p.gpio
      return pad
    })
  }))

  const features = [
    ...(part.features ?? []),
    // Render each button as a small labelled chip so it appears in the preview.
    ...(part.buttons ?? []).map((b) => ({
      label: b.label || 'BTN',
      kind: 'chip' as const,
      x: clamp(b.x - 0.05, -0.2, 1.2),
      y: clamp(b.y - 0.03, -0.2, 1.2),
      w: 0.1,
      h: 0.06
    }))
  ]

  const aspect =
    typeof part.aspect === 'number' && part.aspect > 0
      ? part.aspect
      : part.dimensions && part.dimensions.height > 0
        ? part.dimensions.width / part.dimensions.height
        : 0.5

  const def: BoardDefinition = {
    id: part.id || 'part',
    name: part.name || 'Part',
    mcu: part.mcu ?? part.family ?? '',
    pcbColor: part.pcbColor || '#0f5a2e',
    aspect,
    headers
  }
  if (part.ledLabel) def.ledLabel = part.ledLabel
  if (features.length) def.features = features
  const img = part.imageData ?? (part.image?.startsWith('data:') ? part.image : undefined)
  if (img) def.image = img
  return def
}

/** Every pin name declared on the part (for ledLabel / schematic pickers). */
export function pinNames(part: PartDefinition): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const h of part.headers ?? []) {
    for (const p of h.pins ?? []) {
      const n = String(p.name ?? '').trim()
      if (n && !seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
  }
  return out
}

/** A pin flattened for the canvas: its resolved absolute position + indices. */
export interface ResolvedPin {
  pin: PartPin
  x: number
  y: number
  edge: PartEdge
  /** Header index + pin index, so the canvas can mutate the right pin. */
  hi: number
  pi: number
}

/**
 * Return a copy of the part where EVERY pin has an absolute `x`/`y` — its stored
 * position, or one derived from its edge + order. Used to seed the Part Editor's
 * working state so the canvas + inspector always have real positions (the full
 * {@link normalisePart} migration only runs at save, and would also drop runtime
 * fields like `imageData`). Preserves all other fields verbatim.
 */
export function withPinPositions(part: PartDefinition): PartDefinition {
  return {
    ...part,
    headers: (part.headers ?? []).map((h) => {
      const edge: PartEdge = PART_EDGES.includes(h.edge) ? h.edge : 'left'
      return {
        ...h,
        edge,
        pins: h.pins.map((p, i) => {
          if (p.x !== undefined && p.y !== undefined) return p
          const pos = derivePinPosition(edge, i, h.pins.length)
          return { ...p, x: pos.x, y: pos.y }
        })
      }
    })
  }
}

/**
 * Flatten a part's pins into a single list with resolved absolute positions —
 * each pin's stored `x`/`y`, or a fallback derived from its edge + order (so a
 * part loaded straight off disk, un-normalised, still renders). The canvas and
 * the panel detail both render from this.
 */
export function resolvedPins(part: PartDefinition): ResolvedPin[] {
  const out: ResolvedPin[] = []
  ;(part.headers ?? []).forEach((h, hi) => {
    const edge: PartEdge = PART_EDGES.includes(h.edge) ? h.edge : 'left'
    h.pins.forEach((pin, pi) => {
      const pos =
        pin.x !== undefined && pin.y !== undefined
          ? { x: pin.x, y: pin.y }
          : derivePinPosition(edge, pi, h.pins.length)
      out.push({ pin, x: pos.x, y: pos.y, edge, hi, pi })
    })
  })
  return out
}

/** A drawn box in canvas/SVG coordinates. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Outward unit normal for an edge — the direction a wire leaves the body. */
export function edgeNormal(edge: string): [number, number] {
  switch (edge) {
    case 'left':
      return [-1, 0]
    case 'right':
      return [1, 0]
    case 'top':
      return [0, -1]
    default:
      return [0, 1] // bottom / led / unknown
  }
}

/**
 * A part pin flattened to a CANVAS position + outward normal, keyed by the wiring
 * endpoint index. Built from {@link resolvedPins} so the order is IDENTICAL to the
 * `<key>.<pin>#<index>` endpoints and to `headers.flatMap(h => h.pins)` — the
 * invariant that lets life-like ↔ schematic toggle without rewiring.
 */
export interface PinPoint {
  index: number
  name: string
  type: PartPinType
  edge: PartEdge
  x: number
  y: number
  ox: number
  oy: number
}

/** Resolve every pin of a part to a connectable canvas point within `box`. */
export function pinPositions(part: PartDefinition, box: Box): PinPoint[] {
  return resolvedPins(part).map((rp, i) => {
    const [ox, oy] = edgeNormal(rp.edge)
    return {
      index: i,
      name: rp.pin.name,
      type: rp.pin.type,
      edge: rp.edge,
      x: box.x + rp.x * box.w,
      y: box.y + rp.y * box.h,
      ox,
      oy
    }
  })
}

/** Evenly spaced positions for `n` terminals between `a` and `b` (inset). */
export function evenSlots(n: number, a: number, b: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [(a + b) / 2]
  return Array.from({ length: n }, (_, i) => a + ((i + 1) * (b - a)) / (n + 1))
}

/** A schematic-symbol terminal: a pin placed on a side, with its stub geometry. */
export interface SymbolTerminal {
  pin: PartPin
  side: PartEdge
  /** Flattened header index — the wiring endpoint `#index` (authoritative). */
  flatIndex: number
  /** All flatIndices sharing this terminal (a rail merges several pins into one). */
  railIndices: number[]
  /** False for pads merged into a shared rail terminal (extra GND / same power
   *  rail) — not drawn, but the pin still resolves for wiring. */
  primary: boolean
  /** Box-edge attach point, local to the symbol box origin. */
  inner: { x: number; y: number }
  /** Stub end = the wire/dot attach point, local. */
  outer: { x: number; y: number }
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
}

export interface SymbolLayout {
  box: { w: number; h: number }
  terminals: SymbolTerminal[]
}

const SYMBOL_STUB = 26
/** Per-pin pitch for the schematic block (px) — the built-in Pico's roomy rows are
 *  the guide, so labels never overlap. evenSlots() spreads pins ≈this far apart. */
const SYMBOL_PITCH_Y = 30
const SYMBOL_PITCH_X = 64

/**
 * Lay out a part's schematic symbol (a labelled block with pin stubs), at the
 * origin. Terminals are placed on the side from `schematic.pins` when present
 * (else the header edge), but their `flatIndex` is the **flattened header order**
 * — NOT the schematic `order` — so a wire's `#index` endpoint binds to the same
 * pin in the breadboard/life-like views. Pure + DOM-free.
 */
export function schematicSymbolLayout(
  part: PartDefinition,
  opts?: { boxW?: number; boxH?: number; stub?: number }
): SymbolLayout {
  const stub = opts?.stub ?? SYMBOL_STUB
  const byName = new Map<string, { side: PartEdge; order: number }>()
  if (part.schematic?.pins?.length) {
    for (const sp of part.schematic.pins) byName.set(sp.pin, { side: sp.side, order: sp.order })
  }
  interface Ref {
    flatIndex: number
    pin: PartPin
  }
  const refs: Ref[] = resolvedPins(part).map((rp, i) => ({ flatIndex: i, pin: rp.pin }))

  // Collapse rails (every GND → one terminal; same power label → one) so the
  // symbol shows ONE GND / ONE 3V3 etc; signals stay individual. Each merged pad
  // keeps its flatIndex (so `<part>.<pin>#n` wires resolve to the shared terminal)
  // but only the first is `primary` (drawn).
  const railKey = (pin: PartPin): string | null =>
    pin.type === 'gnd' ? 'GND' : pin.type === 'pwr' ? `PWR:${(pin.label || pin.name || '').toUpperCase()}` : null
  const groups = new Map<string, Ref[]>()
  const singles: Ref[] = []
  for (const r of refs) {
    const k = railKey(r.pin)
    if (k) {
      const g = groups.get(k)
      if (g) g.push(r)
      else groups.set(k, [r])
    } else {
      singles.push(r)
    }
  }

  interface VT {
    side: PartEdge
    order: number
    refs: Ref[]
  }
  // Side assignment follows schematic convention: power → top, ground → bottom,
  // signals on the L/R sides. The author's explicit schematic mapping wins for a
  // signal; otherwise free signals are split EVENLY between left and right (in
  // flat-index order) so the symbol stays balanced and never grows into one tall
  // column.
  const vts: VT[] = []
  const free: Ref[] = []
  for (const r of singles) {
    const so = byName.get(r.pin.name)
    if (so) vts.push({ side: so.side, order: so.order, refs: [r] })
    else free.push(r)
  }
  free.sort((a, b) => a.flatIndex - b.flatIndex)
  const half = Math.ceil(free.length / 2)
  free.forEach((r, i) => vts.push({ side: i < half ? 'left' : 'right', order: r.flatIndex, refs: [r] }))
  for (const [k, g] of groups) {
    if (k === 'GND') vts.push({ side: 'bottom', order: Number.MAX_SAFE_INTEGER, refs: g })
    else vts.push({ side: 'top', order: byName.get(g[0].pin.name)?.order ?? g[0].flatIndex, refs: g })
  }

  const bySide: Record<PartEdge, VT[]> = { left: [], right: [], top: [], bottom: [] }
  for (const vt of vts) bySide[vt.side].push(vt)
  for (const side of PART_EDGES) bySide[side].sort((a, b) => a.order - b.order)

  // Box size from a per-pin pitch so labels never overlap: height from the busiest
  // L/R side, width from the busiest top/bottom row. evenSlots() then spreads pins
  // ≈pitch apart (gap = box/(n+1)).
  const vRows = Math.max(bySide.left.length, bySide.right.length, 1)
  const hCols = Math.max(bySide.top.length, bySide.bottom.length, 1)
  const boxW = opts?.boxW ?? Math.max(170, (hCols + 1) * SYMBOL_PITCH_X)
  const boxH = opts?.boxH ?? Math.max(130, (vRows + 1) * SYMBOL_PITCH_Y)

  const lY = evenSlots(bySide.left.length, 0, boxH)
  const rY = evenSlots(bySide.right.length, 0, boxH)
  const tX = evenSlots(bySide.top.length, 0, boxW)
  const bX = evenSlots(bySide.bottom.length, 0, boxW)

  const terminals: SymbolTerminal[] = []
  const place = (vt: VT, side: PartEdge, x1: number, y1: number, x2: number, y2: number): void => {
    const labelX = side === 'left' ? x1 + 6 : side === 'right' ? x1 - 6 : x1
    const labelY = side === 'top' ? y1 + 14 : side === 'bottom' ? y1 - 8 : y1 - 4
    const anchor: 'start' | 'middle' | 'end' = side === 'left' ? 'start' : side === 'right' ? 'end' : 'middle'
    const railIndices = vt.refs.map((r) => r.flatIndex)
    vt.refs.forEach((r, k) =>
      terminals.push({
        pin: r.pin,
        side,
        flatIndex: r.flatIndex,
        railIndices,
        primary: k === 0,
        inner: { x: x1, y: y1 },
        outer: { x: x2, y: y2 },
        label: { x: labelX, y: labelY, anchor }
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
