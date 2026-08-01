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
import { BUILTIN_BOARDS } from './board-defs'
import {
  STANDARD_PIN_SPACING_MM,
  coerceConnectorKind,
  coerceGroveVariant,
  PART_PIN_SHAPES,
  TERMINAL_MAX,
  TERMINAL_MIN,
  itemHidden,
  itemLocked,
  type ComponentShape,
  type ComponentShapeKind,
  type DriverFile,
  type SuggestedModule,
  type ImageLayer,
  type MountingHole,
  type PartDefinition,
  type PartEdge,
  type OnboardLed,
  type PartConnector,
  type PartFeature,
  type PartGroup,
  type PartHeader,
  type PartButton,
  type PartItemFlags,
  type PartRear,
  type PartLabel,
  type PartMount,
  type PartPin,
  type PartPinBuses,
  type PartPinCapability,
  type PartPinShape,
  type PartPinSignals,
  type PartPinType,
  type PartPackage,
  type PolygonPoint
} from '../../../shared/part'
import type { RobotPart } from '../../../shared/robot'
import { coerceElectrical } from '../../../shared/part-yaml'

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
export const PIN_SHAPES: readonly PartPinShape[] = PART_PIN_SHAPES

/** Human labels for each pad shape. */
export const PIN_SHAPE_LABEL: Record<PartPinShape, string> = {
  square: 'Square',
  round: 'Round',
  castellated: 'Castellated',
  header: 'Header hole',
  octagonal: 'Octagonal (servo)',
  smd: 'SMD pad (no hole)',
  pogo: 'Pogo contact (sprung)'
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
/** Default rectangle corner radius (viewBox units) when a shape sets none. */
export const DEFAULT_SHAPE_CORNER = 3

/**
 * Every distinct colour already used in the part (shape fills/strokes/label
 * colours, free-label colours, the PCB colour), in first-seen order. Powers the
 * quick-pick swatch grids on the Part Editor's colour wells so authors can reuse
 * a colour in one click.
 */
export function collectUsedColors(part: PartDefinition): string[] {
  const seen = new Set<string>()
  const add = (c: string | undefined): void => {
    const v = c?.trim()
    if (v) seen.add(v)
  }
  for (const s of part.shapes ?? []) {
    add(s.fill)
    add(s.stroke)
    add(s.labelColor)
  }
  for (const l of part.labels ?? []) add(l.color)
  add(part.pcbColor)
  return [...seen]
}

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

const SPI_SIGNALS = ['RX', 'CSn', 'SCK', 'TX']

/** Normalise a per-capability signal map: keep only valid values, drop if empty. */
function normaliseSignals(signals: PartPinSignals | undefined): PartPinSignals | undefined {
  if (!signals || typeof signals !== 'object') return undefined
  const out: PartPinSignals = {}
  const i2c = String(signals.i2c ?? '').toUpperCase()
  if (i2c === 'SDA' || i2c === 'SCL') out.i2c = i2c
  const spi = SPI_SIGNALS.find((s) => s.toLowerCase() === String(signals.spi ?? '').toLowerCase())
  if (spi) out.spi = spi as PartPinSignals['spi']
  const uart = String(signals.uart ?? '').toUpperCase()
  if (uart === 'TX' || uart === 'RX') out.uart = uart
  const pwm = String(signals.pwm ?? '').toUpperCase()
  if (pwm === 'A' || pwm === 'B') out.pwm = pwm
  return Object.keys(out).length ? out : undefined
}

/** Normalise a per-capability bus/channel map: keep finite numbers, drop if empty. */
function normaliseBuses(buses: PartPinBuses | undefined): PartPinBuses | undefined {
  if (!buses || typeof buses !== 'object') return undefined
  const out: PartPinBuses = {}
  for (const k of ['i2c', 'spi', 'uart', 'adc'] as const) {
    const v = buses[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
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
/**
 * Copy the single-hierarchy item flags (group / hidden / locked / z) onto a
 * normalised item. normalisePart rebuilds every item field-by-field, so EVERY
 * kind routes through here — that is what stops a new flag being dropped on save
 * for the one kind somebody forgot.
 */
function keepItemFlags(src: Partial<PartItemFlags> & { z?: number }, out: Record<string, unknown>): void {
  const group = typeof src.group === 'string' ? src.group.trim() : ''
  if (group) out.group = group
  if (src.hidden === true) out.hidden = true
  if (src.locked === true) out.locked = true
  if (src.side === 'rear') out.side = 'rear'
  if (typeof src.z === 'number' && Number.isFinite(src.z)) out.z = src.z
}

function normalisePin(pin: PartPin): PartPin {
  const type: PartPinType = PIN_TYPES.includes(pin.type) ? pin.type : 'io'
  const name = String(pin.name ?? '').trim()
  const out: PartPin = { name, type }
  keepItemFlags(pin, out as unknown as Record<string, unknown>)
  if (typeof pin.number === 'number' && Number.isFinite(pin.number)) out.number = pin.number
  if (type === 'io') {
    if (typeof pin.gpio === 'number' && Number.isFinite(pin.gpio)) out.gpio = pin.gpio
    const caps = normaliseCaps(pin.capabilities)
    if (caps) out.capabilities = caps
    const signals = normaliseSignals(pin.signals)
    if (signals) out.signals = signals
    const buses = normaliseBuses(pin.buses)
    if (buses) out.buses = buses
  }
  const label = String(pin.label ?? '').trim()
  if (label && label !== name) out.label = label
  if (pin.castellated === true) out.castellated = true
  if (PIN_SHAPES.includes(pin.shape as PartPinShape)) out.shape = pin.shape
  if (pin.labelHidden === true) out.labelHidden = true
  if (typeof pin.group === 'string' && pin.group.trim()) out.group = pin.group.trim()
  if (typeof pin.derived === 'string' && pin.derived.trim()) out.derived = pin.derived.trim()
  if (typeof pin.rotation === 'number' && Number.isFinite(pin.rotation) && !isPresetServoSignal(pin)) {
    out.rotation = ((Math.round(pin.rotation / 90) * 90) % 360 + 360) % 360
  }
  if (typeof pin.x === 'number' && Number.isFinite(pin.x)) out.x = clamp(pin.x, 0, 1)
  if (typeof pin.y === 'number' && Number.isFinite(pin.y)) out.y = clamp(pin.y, 0, 1)
  if (
    pin.labelOffset &&
    Number.isFinite(pin.labelOffset.x) &&
    Number.isFinite(pin.labelOffset.y) &&
    (pin.labelOffset.x !== 0 || pin.labelOffset.y !== 0)
  ) {
    out.labelOffset = { x: clamp(pin.labelOffset.x, -1.5, 1.5), y: clamp(pin.labelOffset.y, -1.5, 1.5) }
  }
  return out
}

/**
 * MIGRATION (#664): is this the label-direction preset the servo-header tool used
 * to stamp on its signal pin?
 *
 * The tool set `rotation: 270` on every servo signal, which pinned the label to
 * the TOP of the board however far down the header sat. The preset is gone, but
 * headers placed before that fix carry it in their saved parts.yml, so it is
 * cleared on load and the label falls back to the nearest edge.
 *
 * Deliberately narrow — ALL FOUR marks of the tool's own output must match — so a
 * rotation someone aimed by hand with the pin inspector is never touched. That
 * control is offered for every pad shape and its whole point is to override the
 * default, so clearing one the user chose would be the worse bug.
 */
export function isPresetServoSignal(pin: {
  rotation?: number
  shape?: string
  type?: string
  group?: string
}): boolean {
  return (
    pin.rotation === 270 &&
    pin.shape === 'octagonal' &&
    pin.type === 'io' &&
    /^servo-\d+$/.test(pin.group ?? '')
  )
}

/** Normalise one component shape: validate kind, clamp coords, default colours. */
function normaliseShape(s: ComponentShape): ComponentShape {
  const kind: ComponentShapeKind = COMPONENT_SHAPES.includes(s.kind) ? s.kind : 'rect'
  const out: ComponentShape = { kind, x: clamp(s.x, -0.2, 1.2), y: clamp(s.y, -0.2, 1.2) }
  keepItemFlags(s, out as unknown as Record<string, unknown>)
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
  if (typeof s.rotation === 'number' && Number.isFinite(s.rotation)) {
    const r = ((((Math.round(s.rotation / 90) * 90) % 360) + 360) % 360)
    if (r) out.rotation = r
  }
  if (kind === 'rect' && typeof s.cornerRadius === 'number' && Number.isFinite(s.cornerRadius)) {
    out.cornerRadius = clamp(s.cornerRadius, 0, 60)
  }
  // Shape-label text styling (kept only when set; false/center default omitted).
  if (typeof s.labelFontSize === 'number' && Number.isFinite(s.labelFontSize)) {
    out.labelFontSize = clamp(s.labelFontSize, 4, 96)
  }
  if (s.labelBold) out.labelBold = true
  if (s.labelItalic) out.labelItalic = true
  if (s.labelUnderline) out.labelUnderline = true
  if (s.labelAlign === 'left' || s.labelAlign === 'center' || s.labelAlign === 'right') {
    out.labelAlign = s.labelAlign
  }
  if (s.labelWrap) out.labelWrap = true
  if (typeof s.labelColor === 'string' && s.labelColor.trim()) out.labelColor = s.labelColor.trim()
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

/** Every free-placed COMPONENT (shape, label, button, LED, connector) merged
 *  into one ascending-z draw order — the unified stack the canvas paints,
 *  hit-tests and the Layers panel lists (#130). Pins/holes/image are NOT here
 *  (pins anchor to the outline; the image is pinned to the bottom). The legacy
 *  category defaults keep today's look for parts authored before per-item z:
 *  shapes (0..), labels above them, then buttons, LEDs, connectors on top. */
export type OrderedItemKind = 'shape' | 'label' | 'button' | 'led' | 'connector'
export interface OrderedItem {
  kind: OrderedItemKind
  index: number
  z: number
}

const Z_BUTTON = 1_000_000
const Z_LED = 2_000_000
const Z_CONNECTOR = 3_000_000

export function orderedItems(part: PartDefinition): OrderedItem[] {
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const buttons = part.buttons ?? []
  const leds = part.onboardLeds ?? []
  const connectors = part.connectors ?? []
  const combined: OrderedItem[] = [
    ...shapes.map((s, i) => ({ kind: 'shape' as const, index: i, z: s.z ?? i })),
    ...labels.map((l, i) => ({ kind: 'label' as const, index: i, z: l.z ?? shapes.length + i })),
    ...buttons.map((b, i) => ({ kind: 'button' as const, index: i, z: b.z ?? Z_BUTTON + i })),
    ...leds.map((d, i) => ({ kind: 'led' as const, index: i, z: d.z ?? Z_LED + i })),
    ...connectors.map((c, i) => ({ kind: 'connector' as const, index: i, z: c.z ?? Z_CONNECTOR + i }))
  ]
  return combined
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.z - b.c.z || a.i - b.i)
    .map(({ c }) => c)
}

/** Write sequential z back to every component array so the canvas paints +
 *  hit-tests match a desired TOP-FIRST order (0 = bottom). Returns the patched
 *  arrays for `patch()`. Used by the Layers panel's drag-to-reorder (#130). */
export function applyItemOrder(
  part: PartDefinition,
  topFirst: OrderedItem[]
): Pick<PartDefinition, 'shapes' | 'labels' | 'buttons' | 'onboardLeds' | 'connectors'> {
  const shapes = [...(part.shapes ?? [])]
  const labels = [...(part.labels ?? [])]
  const buttons = [...(part.buttons ?? [])]
  const leds = [...(part.onboardLeds ?? [])]
  const connectors = [...(part.connectors ?? [])]
  ;[...topFirst].reverse().forEach((it, z) => {
    if (it.kind === 'shape') shapes[it.index] = { ...shapes[it.index], z }
    else if (it.kind === 'label') labels[it.index] = { ...labels[it.index], z }
    else if (it.kind === 'button') buttons[it.index] = { ...buttons[it.index], z }
    else if (it.kind === 'led') leds[it.index] = { ...leds[it.index], z }
    else connectors[it.index] = { ...connectors[it.index], z }
  })
  return { shapes, labels, buttons, onboardLeds: leds, connectors }
}

// --- grouping (#627) --------------------------------------------------------
// Membership is a `group` id on each pin/shape/label; the `groups` registry
// records nesting (`parent`) + names. These pure helpers resolve a group's tree
// so move / rotate / delete / select act on every member, recursively (#630).

/**
 * One member of a group. The `kind` list must cover EVERY item type that can
 * carry a `group` id (#665) — when it was narrower than that set, a group whose
 * members were connectors/LEDs/buttons/holes resolved to nothing, so clicking it
 * in the Layers panel selected nothing and dragging a member moved only that
 * member. `PartItemFlags` carriers are the authority on what belongs here.
 */
export type GroupMemberRef =
  | { kind: 'pin'; hi: number; pi: number }
  | { kind: 'shape'; index: number }
  | { kind: 'label'; index: number }
  | { kind: 'connector'; index: number }
  | { kind: 'led'; index: number }
  | { kind: 'button'; index: number }
  | { kind: 'hole'; index: number }

/** The non-pin member kinds — the ones addressed by a single array index. */
export const GROUP_COMPONENT_KINDS = ['shape', 'label', 'connector', 'led', 'button', 'hole'] as const
export type GroupComponentKind = (typeof GROUP_COMPONENT_KINDS)[number]

/** Every group id in the subtree rooted at `rootId` (itself + nested descendants). */
export function groupTreeIds(groups: PartGroup[] | undefined, rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const g of groups ?? []) {
      if (g.parent && ids.has(g.parent) && !ids.has(g.id)) {
        ids.add(g.id)
        changed = true
      }
    }
  }
  return ids
}

/** The outermost ancestor of a group (walk the `parent` chain; cycle-safe). */
export function groupRootId(groups: PartGroup[] | undefined, gid: string): string {
  const seen = new Set<string>()
  let cur = gid
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const parent = (groups ?? []).find((g) => g.id === cur)?.parent
    if (!parent) return cur
    cur = parent
  }
  return cur
}

/** Every item whose `group` id is in `ids`, across all groupable kinds. */
export function groupMembers(part: PartDefinition, ids: Set<string>): GroupMemberRef[] {
  const out: GroupMemberRef[] = []
  part.headers?.forEach((h, hi) =>
    h.pins.forEach((p, pi) => {
      if (p.group && ids.has(p.group)) out.push({ kind: 'pin', hi, pi })
    })
  )
  const each = <T extends { group?: string }>(
    list: T[] | undefined,
    kind: GroupComponentKind
  ): void => {
    list?.forEach((it, index) => {
      if (it.group && ids.has(it.group)) out.push({ kind, index } as GroupMemberRef)
    })
  }
  each(part.shapes, 'shape')
  each(part.labels, 'label')
  each(part.connectors, 'connector')
  each(part.onboardLeds, 'led')
  each(part.buttons, 'button')
  each(part.mountingHoles, 'hole')
  return out
}

/** Translate a shape (and its polygon points) by a normalised delta, clamped to
 *  the board. Shared by the canvas drag/align and the arrow-key nudge (#632). */
export function translateShape(s: ComponentShape, dx: number, dy: number): ComponentShape {
  const c = (v: number): number => Math.min(1, Math.max(0, v))
  return {
    ...s,
    x: c(s.x + dx),
    y: c(s.y + dy),
    points: s.points?.map((p) => ({ x: c(p.x + dx), y: c(p.y + dy) }))
  }
}

/** Dissolve a group by one level: its members (+ any direct sub-groups) are
 *  re-parented to the group's own parent — loose when it was top-level. Pure;
 *  shared by the canvas Ungroup button + the Layers-panel ungroup (#630/#631). */
export function dissolveGroup(part: PartDefinition, gid: string): PartDefinition {
  const registry = part.groups ?? []
  const parent = registry.find((g) => g.id === gid)?.parent
  const nextGroups = registry
    .filter((g) => g.id !== gid)
    .map((g): PartGroup => (g.parent === gid ? { ...g, parent } : g))
  return {
    ...part,
    headers: part.headers.map((h) => ({
      ...h,
      pins: h.pins.map((p) => (p.group === gid ? { ...p, group: parent } : p))
    })),
    shapes: (part.shapes ?? []).map((s) => (s.group === gid ? { ...s, group: parent } : s)),
    labels: (part.labels ?? []).map((l) => (l.group === gid ? { ...l, group: parent } : l)),
    groups: nextGroups.length ? nextGroups : undefined
  }
}

/** The z a newly-created ITEM (any kind) should take to land on top. */
export function nextItemZ(part: PartDefinition): number {
  const ord = orderedItems(part)
  return ord.length ? ord[ord.length - 1].z + 1 : 0
}

/** The z a newly-created component should take to land on top of everything. */
export function nextComponentZ(part: PartDefinition): number {
  const ord = orderedComponents(part)
  return ord.length ? ord[ord.length - 1].z + 1 : 0
}

/**
 * Every pin name the part already uses — header pins AND connector contacts.
 *
 * They share one namespace: a wire endpoint is `"<partId>.<PinName>"`, so two
 * pins with the same name anywhere in a part make that endpoint ambiguous.
 */
export function usedPinNames(part: PartDefinition): Set<string> {
  const names = new Set<string>()
  for (const h of part.headers ?? []) for (const p of h.pins) if (p.name) names.add(p.name)
  for (const c of part.connectors ?? []) for (const p of c.pins ?? []) if (p.name) names.add(p.name)
  return names
}

/**
 * A pin name not already in `used`, derived from `base` by a numeric suffix:
 * `SCL` → `SCL2` → `SCL3`. Pure.
 *
 * Matches how a real two-port board is labelled (the QT Py's `SDA1`/`SCL1`), and
 * exists because duplicating a connector would otherwise produce a second set of
 * contacts named exactly like the first — see {@link usedPinNames} for why that
 * is not merely untidy.
 *
 * A `base` that already ends in digits counts up from there, so duplicating
 * `SCL2` gives `SCL3` rather than `SCL22`.
 */
export function uniquePinName(base: string, used: ReadonlySet<string>): string {
  const name = (base ?? '').trim()
  if (!name) return name
  if (!used.has(name)) return name
  const m = /^(.*?)(\d+)$/.exec(name)
  const stem = m ? m[1] : name
  let n = m ? parseInt(m[2], 10) + 1 : 2
  // Bounded so a pathological part can't spin here; 999 is far past any real board.
  while (used.has(`${stem}${n}`) && n < 1000) n++
  return `${stem}${n}`
}

/**
 * The contacts for an `n`-way screw terminal block (#662), named `T1`…`Tn`.
 *
 * `io` is the neutral default: a block might be motor outputs, a power input or
 * a sensor lead, and the author retypes each contact anyway — they are ordinary
 * {@link PartPin}s, so everything that configures a header pin configures these.
 */
export function terminalPins(n: number): PartPin[] {
  const count = clamp(Math.round(n) || TERMINAL_MIN, TERMINAL_MIN, TERMINAL_MAX)
  return Array.from({ length: count }, (_, i) => ({ name: `T${i + 1}`, type: 'io' as PartPinType }))
}

/**
 * Grow or shrink a terminal block to `n` ways, **keeping the contacts already
 * configured**.
 *
 * Growing appends fresh `T<k>` contacts; shrinking drops from the end. Shrinking
 * does lose the trailing contacts' configuration — which is what "fewer
 * terminals" has to mean — so it only ever removes from the end, where the loss
 * is predictable, rather than choosing which ones looked unused.
 */
export function resizeTerminals(pins: PartPin[], n: number): PartPin[] {
  const count = clamp(Math.round(n) || TERMINAL_MIN, TERMINAL_MIN, TERMINAL_MAX)
  const kept = pins.slice(0, count)
  for (let i = kept.length; i < count; i++) {
    kept.push({ name: `T${i + 1}`, type: 'io' as PartPinType })
  }
  return kept
}

/** The selection kinds a duplicate is defined for (#661). */
export type DuplicableSelection =
  | { type: 'pin'; hi: number; pi: number }
  | { type: 'hole'; index: number }
  | { type: 'connector'; index: number }
  | { type: 'shape'; index: number }
  | { type: 'label'; index: number }

/** How far a copy is offset from its source, as a fraction of the board box. */
const DUPLICATE_OFFSET = 0.04

/**
 * Duplicate the selected item, returning the new part and the copy's selection —
 * or `null` when the selection isn't something we can duplicate.
 *
 * **One implementation, two callers**: the canvas mini-toolbar's ⧉ buttons and the
 * Ctrl/Cmd+D shortcut (#661). They previously would have been two copies of this
 * logic, which is the failure mode that keeps biting this codebase — the shortcut
 * would quietly drift from the button (a new field copied in one and not the
 * other) with nothing to catch it.
 *
 * Pure: the caller commits the part and applies the selection.
 */
export function duplicateSelection(
  part: PartDefinition,
  sel: { type: string; index?: number; hi?: number; pi?: number } | null | undefined
): { part: PartDefinition; selection: DuplicableSelection } | null {
  if (!sel) return null
  const off = DUPLICATE_OFFSET
  const c01 = (n: number): number => clamp(n, 0, 1)

  if (sel.type === 'shape' && sel.index !== undefined) {
    const shapes = part.shapes ?? []
    const s = shapes[sel.index]
    if (!s) return null
    const copy: ComponentShape = {
      ...s,
      x: c01(s.x + off),
      y: c01(s.y + off),
      points: s.points?.map((p) => ({ x: c01(p.x + off), y: c01(p.y + off) })),
      z: nextComponentZ(part)
    }
    const next = [...shapes, copy]
    return { part: { ...part, shapes: next }, selection: { type: 'shape', index: next.length - 1 } }
  }

  if (sel.type === 'label' && sel.index !== undefined) {
    const labels = part.labels ?? []
    const l = labels[sel.index]
    if (!l) return null
    const next = [...labels, { ...l, x: c01(l.x + off), y: c01(l.y + off), z: nextComponentZ(part) }]
    return { part: { ...part, labels: next }, selection: { type: 'label', index: next.length - 1 } }
  }

  if (sel.type === 'connector' && sel.index !== undefined) {
    const connectors = part.connectors ?? []
    const c = connectors[sel.index]
    if (!c) return null
    // Contacts carry no coordinates of their own — they're laid out from the
    // body's position and rotation — so only the body moves.
    const used = usedPinNames(part)
    const copy: PartConnector = {
      ...c,
      // A duplicate is a NEW, standalone connector. Inheriting the source's group
      // would make the copy move, rotate and delete as part of it — so dragging
      // the original would drag its own duplicate around.
      group: undefined,
      x: c01(c.x + off),
      y: c01(c.y + off),
      z: nextComponentZ(part),
      // Contacts share one namespace with every other pin (a wire endpoint is
      // `<partId>.<PinName>`), so a verbatim copy would give a board two pins
      // called SCL and make that endpoint ambiguous. Suffix them: SCL → SCL2.
      pins: c.pins.map((p) => {
        const name = uniquePinName(p.name, used)
        used.add(name)
        return { ...p, name, capabilities: p.capabilities ? [...p.capabilities] : undefined }
      })
    }
    const next = [...connectors, copy]
    return {
      part: { ...part, connectors: next },
      selection: { type: 'connector', index: next.length - 1 }
    }
  }

  if (sel.type === 'hole' && sel.index !== undefined) {
    const holes = part.mountingHoles ?? []
    const h = holes[sel.index]
    if (!h) return null
    const next = [...holes, { x: c01(h.x + off), y: c01(h.y + off), diameter: h.diameter }]
    return {
      part: { ...part, mountingHoles: next },
      selection: { type: 'hole', index: next.length - 1 }
    }
  }

  if (sel.type === 'pin' && sel.hi !== undefined && sel.pi !== undefined) {
    const { hi, pi } = sel
    const src = part.headers?.[hi]?.pins?.[pi]
    if (!src) return null
    // Position comes from the RESOLVED pin: a legacy pin carries no x/y of its
    // own and is placed from its edge, so copying `src.x` would give the duplicate
    // no position at all.
    const rp = resolvedPins(part).find((p) => p.hi === hi && p.pi === pi)
    if (!rp) return null
    const used = usedPinNames(part)
    const copy: PartPin = {
      ...src,
      name: uniquePinName(src.name, used),
      capabilities: src.capabilities ? [...src.capabilities] : undefined,
      x: c01(rp.x + off),
      y: c01(rp.y + off)
    }
    const newPi = part.headers[hi].pins.length
    return {
      part: {
        ...part,
        headers: part.headers.map((h, i) => (i === hi ? { ...h, pins: [...h.pins, copy] } : h))
      },
      selection: { type: 'pin', hi, pi: newPi }
    }
  }

  return null
}

/**
 * Split what an author typed or pasted into the Tags field into individual tags
 * (#660). Commas separate; surrounding whitespace and empty entries are dropped.
 *
 * A tag can never contain a comma — which is the point: with commas acting as a
 * *command* rather than a character that has to survive a round-trip through the
 * model, the old bug (a trailing comma normalising away, so a second tag was
 * unreachable by typing) cannot come back.
 */
export function splitTagInput(input: string): string[] {
  return String(input ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

/**
 * Add typed/pasted tags to an existing list, preserving order.
 *
 * Duplicates are rejected **case-insensitively** — `I2C` alongside `i2c` is just
 * noise in search — but only for the tags being ADDED. Existing entries are never
 * rewritten or de-duplicated, so merely opening a part in the editor can't
 * silently mutate data someone authored by hand.
 */
export function addTags(existing: string[], input: string): string[] {
  const out = [...existing]
  const seen = new Set(out.map((t) => t.toLowerCase()))
  for (const tag of splitTagInput(input)) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
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

/**
 * The nearest centre coordinate to `value` (normalised) that is within
 * `thresholdPx` once scaled by `dim` (the box width/height in px); null if none.
 * Backs the Part Editor's smart alignment guides (#169). Pure.
 */
export function nearestCenter(
  centres: number[],
  value: number,
  dim: number,
  thresholdPx: number
): number | null {
  let best: number | null = null
  let bestPx = thresholdPx
  for (const c of centres) {
    const px = Math.abs((c - value) * dim)
    if (px < bestPx) {
      bestPx = px
      best = c
    }
  }
  return best
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

// --- Per-type style clipboard (copy style / paste style) -------------------
// A small "format painter" for the Part Editor: capture the STYLE of the
// selected element, then apply it to another element OF THE SAME TYPE. The
// `kind` discriminator gates the paste (pasting onto a different element type is
// a no-op), so each toolbar can disable "Paste style" when the clipboard holds a
// different kind. Pure data-in / data-out so it's unit-testable.

/** A shape's copy-able style: paint (fill/stroke/width/corner) + every label*
 *  caption-styling field. Every key is captured (value or `undefined`) so a
 *  paste OVERWRITES the target's style rather than merging — pasting an
 *  un-bolded style un-bolds the target. */
export type ShapeStyleClip = Pick<
  ComponentShape,
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'cornerRadius'
  | 'labelFontSize'
  | 'labelBold'
  | 'labelItalic'
  | 'labelUnderline'
  | 'labelAlign'
  | 'labelWrap'
  | 'labelColor'
>
/** A free label's copy-able text style. */
export type LabelStyleClip = Pick<PartLabel, 'fontSize' | 'color' | 'bold' | 'italic' | 'underline' | 'align'>
/** A pin's copy-able style: pad shape + electrical role + IO capabilities. */
export type PinStyleClip = Pick<PartPin, 'shape' | 'type' | 'capabilities'>
/** A mounting hole's copy-able style: just its diameter. */
export type HoleStyleClip = Pick<MountingHole, 'diameter'>

/** The Part Editor's style clipboard — a captured style tagged with its element
 *  type, so a paste only applies to the same type. */
export type PartStyleClipboard =
  | { kind: 'shape'; style: ShapeStyleClip }
  | { kind: 'label'; style: LabelStyleClip }
  | { kind: 'pin'; style: PinStyleClip }
  | { kind: 'hole'; style: HoleStyleClip }

/** Which element a copy/paste-style acts on (a selection flattened to indices).
 *  Kept here rather than importing the canvas' `CanvasSelection` so this stays
 *  DOM/React-free and free of an import cycle with the canvas components. */
export type StyleTarget =
  | { kind: 'shape'; index: number }
  | { kind: 'label'; index: number }
  | { kind: 'pin'; hi: number; pi: number }
  | { kind: 'hole'; index: number }

/** Capture the style of the targeted element, or null if it doesn't exist. Pure. */
export function captureStyle(part: PartDefinition, target: StyleTarget): PartStyleClipboard | null {
  if (target.kind === 'shape') {
    const s = (part.shapes ?? [])[target.index]
    if (!s) return null
    return {
      kind: 'shape',
      style: {
        fill: s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        cornerRadius: s.cornerRadius,
        labelFontSize: s.labelFontSize,
        labelBold: s.labelBold,
        labelItalic: s.labelItalic,
        labelUnderline: s.labelUnderline,
        labelAlign: s.labelAlign,
        labelWrap: s.labelWrap,
        labelColor: s.labelColor
      }
    }
  }
  if (target.kind === 'label') {
    const l = (part.labels ?? [])[target.index]
    if (!l) return null
    return {
      kind: 'label',
      style: { fontSize: l.fontSize, color: l.color, bold: l.bold, italic: l.italic, underline: l.underline, align: l.align }
    }
  }
  if (target.kind === 'pin') {
    const p = part.headers?.[target.hi]?.pins?.[target.pi]
    if (!p) return null
    // Resolve the effective pad shape (honours the legacy `castellated` flag) so
    // the clip is always concrete.
    return { kind: 'pin', style: { shape: pinShapeOf(p), type: p.type, capabilities: p.capabilities ? [...p.capabilities] : undefined } }
  }
  const h = (part.mountingHoles ?? [])[target.index]
  if (!h) return null
  return { kind: 'hole', style: { diameter: h.diameter } }
}

/**
 * Apply a captured style to the targeted element. A no-op (returns the SAME part)
 * when the clipboard is empty, holds a different `kind`, or the element is gone.
 * Pure: returns a new part on success.
 */
export function pasteStyle(part: PartDefinition, target: StyleTarget, clip: PartStyleClipboard | null): PartDefinition {
  if (!clip || clip.kind !== target.kind) return part
  if (clip.kind === 'shape' && target.kind === 'shape') {
    const shapes = part.shapes ?? []
    if (!shapes[target.index]) return part
    return { ...part, shapes: shapes.map((s, i) => (i === target.index ? { ...s, ...clip.style } : s)) }
  }
  if (clip.kind === 'label' && target.kind === 'label') {
    const labels = part.labels ?? []
    if (!labels[target.index]) return part
    return { ...part, labels: labels.map((l, i) => (i === target.index ? { ...l, ...clip.style } : l)) }
  }
  if (clip.kind === 'pin' && target.kind === 'pin') {
    if (!part.headers?.[target.hi]?.pins?.[target.pi]) return part
    const shape = clip.style.shape
    return {
      ...part,
      headers: part.headers.map((h, i) =>
        i === target.hi
          ? {
              ...h,
              pins: h.pins.map((p, j) =>
                j === target.pi
                  ? {
                      ...p,
                      type: clip.style.type,
                      shape,
                      // Keep the legacy `castellated` flag consistent with the shape.
                      castellated: shape === 'castellated' ? true : undefined,
                      capabilities: clip.style.capabilities ? [...clip.style.capabilities] : undefined
                    }
                  : p
              )
            }
          : h
      )
    }
  }
  if (clip.kind === 'hole' && target.kind === 'hole') {
    const holes = part.mountingHoles ?? []
    if (!holes[target.index]) return part
    return { ...part, mountingHoles: holes.map((h, i) => (i === target.index ? { ...h, ...clip.style } : h)) }
  }
  return part
}

/**
 * Normalise + minimally clean a working {@link PartDefinition} into a canonical,
 * round-trippable form. Pure: returns a NEW object, never throws. Optional
 * fields are only set when they carry content (so the YAML round-trip — which
 * prunes empties — deep-equals this result).
 */
/** Copy a component's manual label placement (offset + rotation) onto the
 *  normalised object — mirrors how pin labelOffset is preserved. Required because
 *  normalisePart rebuilds LEDs/connectors field-by-field, so any un-copied field
 *  is stripped on save. */
function applyLabelPlacement(
  src: { labelOffset?: { x: number; y: number }; labelRotation?: number },
  dst: { labelOffset?: { x: number; y: number }; labelRotation?: number }
): void {
  const lo = src.labelOffset
  if (lo && Number.isFinite(lo.x) && Number.isFinite(lo.y) && (lo.x !== 0 || lo.y !== 0)) {
    dst.labelOffset = { x: clamp(lo.x, -1.5, 1.5), y: clamp(lo.y, -1.5, 1.5) }
  }
  if (typeof src.labelRotation === 'number' && Number.isFinite(src.labelRotation)) {
    const r = (((Math.round(src.labelRotation / 90) * 90) % 360) + 360) % 360
    if (r) dst.labelRotation = r
  }
}

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
    out.mountingHoles = part.mountingHoles.map((h) => {
      const hole: MountingHole = {
        x: clamp(h.x, 0, 1),
        y: clamp(h.y, 0, 1),
        diameter: Number.isFinite(h.diameter) && h.diameter > 0 ? h.diameter : 2
      }
      keepItemFlags(h, hole as unknown as Record<string, unknown>)
      return hole
    })
  }
  if (Array.isArray(part.buttons) && part.buttons.length) {
    out.buttons = part.buttons.map((b) => {
      const btn: PartButton = {
        label: String(b.label ?? '').trim(),
        x: clamp(b.x, 0, 1),
        y: clamp(b.y, 0, 1)
      }
      keepItemFlags(b, btn as unknown as Record<string, unknown>)
      return btn
    })
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
        keepItemFlags(l, lbl as unknown as Record<string, unknown>)
        if (typeof l.fontSize === 'number' && Number.isFinite(l.fontSize)) lbl.fontSize = l.fontSize
        if (typeof l.rotation === 'number' && Number.isFinite(l.rotation)) {
          const r = ((((Math.round(l.rotation / 90) * 90) % 360) + 360) % 360)
          if (r) lbl.rotation = r
        }
        if (l.bold) lbl.bold = true
        if (l.italic) lbl.italic = true
        if (l.underline) lbl.underline = true
        if (l.align === 'left' || l.align === 'center' || l.align === 'right') lbl.align = l.align
        if (typeof l.color === 'string' && l.color.trim()) lbl.color = l.color.trim()
        if (typeof l.group === 'string' && l.group.trim()) lbl.group = l.group.trim()
        return lbl
      })
      .filter((l) => l.text !== '')
    if (labels.length) out.labels = labels
  }
  // Group registry (#627) — kept only for ids still referenced by an item's `group`
  // or by a nested group's `parent`, so ungrouping/deleting leaves no orphan groups.
  //
  // This scan must cover EVERY item kind that carries a `group` id. When it was
  // narrower than that set, a group whose only members were connectors/LEDs/
  // buttons/holes looked unreferenced and was pruned — the items kept working
  // (`partLayerTree` synthesises a group for an unregistered id) but the group's
  // NAME and its hidden/locked flags were silently lost on save.
  if (Array.isArray(part.groups) && part.groups.length) {
    const referenced = new Set<string>()
    for (const h of part.headers ?? []) for (const p of h.pins) if (p.group) referenced.add(p.group)
    for (const s of part.shapes ?? []) if (s.group) referenced.add(s.group)
    for (const l of part.labels ?? []) if (l.group) referenced.add(l.group)
    for (const c of part.connectors ?? []) {
      if (c.group) referenced.add(c.group)
      // A connector's contacts are ordinary pins and can be grouped separately
      // from the body (the body + its contacts are usually one group).
      for (const p of c.pins ?? []) if (p.group) referenced.add(p.group)
    }
    for (const l of part.onboardLeds ?? []) if (l.group) referenced.add(l.group)
    for (const b of part.buttons ?? []) if (b.group) referenced.add(b.group)
    for (const h of part.mountingHoles ?? []) if (h.group) referenced.add(h.group)
    for (const g of part.groups) if (g.parent) referenced.add(g.parent)
    const groups = part.groups
      .filter((g) => g.id && referenced.has(g.id))
      .map((g): PartGroup => {
        const grp: PartGroup = { id: String(g.id) }
        if (typeof g.name === 'string' && g.name.trim()) grp.name = g.name.trim()
        if (typeof g.parent === 'string' && g.parent.trim()) grp.parent = g.parent.trim()
        if (g.hidden === true) grp.hidden = true
        if (g.locked === true) grp.locked = true
        return grp
      })
    if (groups.length) out.groups = groups
  }
  if (Array.isArray(part.onboardLeds) && part.onboardLeds.length) {
    out.onboardLeds = part.onboardLeds.map((l): OnboardLed => {
      const kind: OnboardLed['kind'] =
        l.kind === 'rgb' ? 'rgb' : l.kind === 'neopixel' ? 'neopixel' : 'single'
      const led: OnboardLed = { kind, x: clamp(l.x, 0, 1), y: clamp(l.y, 0, 1) }
      keepItemFlags(l, led as unknown as Record<string, unknown>)
      const label = text(l.label)
      if (label) led.label = label
      if (kind === 'rgb') {
        if (l.rgb && typeof l.rgb === 'object') {
          const obj: { r?: number; g?: number; b?: number } = {}
          if (typeof l.rgb.r === 'number' && Number.isFinite(l.rgb.r)) obj.r = l.rgb.r
          if (typeof l.rgb.g === 'number' && Number.isFinite(l.rgb.g)) obj.g = l.rgb.g
          if (typeof l.rgb.b === 'number' && Number.isFinite(l.rgb.b)) obj.b = l.rgb.b
          if (Object.keys(obj).length) led.rgb = obj
        }
      } else {
        if (typeof l.gpio === 'number' && Number.isFinite(l.gpio)) led.gpio = l.gpio
        if (kind === 'neopixel') {
          if (typeof l.power === 'number' && Number.isFinite(l.power)) led.power = l.power
        } else {
          const col = text(l.color)
          if (col) led.color = col
        }
      }
      if (typeof l.sizeMm === 'number' && Number.isFinite(l.sizeMm) && l.sizeMm > 0) led.sizeMm = l.sizeMm
      applyLabelPlacement(l, led)
      return led
    })
  }
  if (Array.isArray(part.connectors) && part.connectors.length) {
    out.connectors = part.connectors.map((c): PartConnector => {
      const kind = coerceConnectorKind(c.kind)
      const conn: PartConnector = {
        kind,
        x: clamp(c.x, 0, 1),
        y: clamp(c.y, 0, 1),
        pins: (Array.isArray(c.pins) ? c.pins : []).map(normalisePin).filter((p) => p.name !== '')
      }
      keepItemFlags(c, conn as unknown as Record<string, unknown>)
      const variant = coerceGroveVariant(c.variant)
      if (variant) conn.variant = variant
      const label = text(c.label)
      if (label) conn.label = label
      if (typeof c.rotation === 'number' && Number.isFinite(c.rotation)) {
        const r = (((Math.round(c.rotation / 90) * 90) % 360) + 360) % 360
        if (r) conn.rotation = r
      }
      applyLabelPlacement(c, conn)
      return conn
    })
  }
  // Board stacking (#166): the footprint this board plugs INTO, and the sockets it
  // offers to boards above it. Mating is by footprint NAME, so both are just data.
  set('footprint', text(part.footprint))
  if (Array.isArray(part.mounts) && part.mounts.length) {
    const mounts = part.mounts
      .map((m): PartMount | null => {
        const id = text(m?.id)
        const footprint = text(m?.footprint)
        if (!id || !footprint || typeof m.x !== 'number' || typeof m.y !== 'number') return null
        const mount: PartMount = { id, footprint, x: clamp(m.x, 0, 1), y: clamp(m.y, 0, 1) }
        if (m.ref && typeof m.ref === 'object') {
          const lib = text(m.ref.lib)
          const rp = text(m.ref.part)
          if (lib && rp) mount.ref = { lib, part: rp }
        }
        const label = text(m.label)
        if (label) mount.label = label
        if (typeof m.rotation === 'number' && Number.isFinite(m.rotation)) {
          const r = (((Math.round(m.rotation / 90) * 90) % 360) + 360) % 360
          if (r) mount.rotation = r
        }
        if (m.pinMap) {
          const pm: Record<string, string> = {}
          for (const [k, v] of Object.entries(m.pinMap)) {
            const to = text(v)
            if (k && to) pm[k] = to
          }
          if (Object.keys(pm).length) mount.pinMap = pm
        }
        return mount
      })
      .filter((m): m is PartMount => m !== null)
    if (mounts.length) out.mounts = mounts
  }
  // Rear face (#636). Like the front, the FILENAME + layer round-trip and the
  // inlined blob is runtime-only.
  // `imageData` is runtime-only for the rear exactly as it is for the front, so
  // it is NOT carried here — the editor re-attaches it to the save payload, which
  // is where the main process picks it up and writes the asset.
  if (part.rear && (text(part.rear.image) || part.rear.imageLayer)) {
    const rear: PartRear = {}
    const img = text(part.rear.image)
    if (img) rear.image = img
    const l = part.rear.imageLayer
    if (l && [l.x, l.y, l.w, l.h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      rear.imageLayer = { x: l.x, y: l.y, w: l.w, h: l.h }
      if (typeof l.opacity === 'number' && Number.isFinite(l.opacity)) rear.imageLayer.opacity = l.opacity
      if (typeof l.rotation === 'number' && Number.isFinite(l.rotation)) rear.imageLayer.rotation = l.rotation
    }
    if (Object.keys(rear).length) out.rear = rear
  }
  set('ledLabel', text(part.ledLabel))
  // `image` is the relative filename; keep it. `imageData` (the runtime data URL)
  // is preserved for previews but is NOT part of the round-trip-comparable shape.
  set('image', text(part.image))
  // `help` is the relative filename; keep it. `helpText` (the inlined markdown) is
  // runtime-only, like `imageData`, so it's NOT part of the round-trip shape.
  set('help', text(part.help))
  // The 3-D mesh link (#406): a relative filename + its declared units/scale.
  set('mesh', text(part.mesh))
  if (part.meshUnits === 'mm' || part.meshUnits === 'm') out.meshUnits = part.meshUnits
  if (typeof part.meshScale === 'number' && part.meshScale > 0) out.meshScale = part.meshScale
  // Mass (grams) + optional CoM (mm) (#554). A non-positive mass is dropped, so
  // "unset" and "zero" both mean fall back to a volume estimate downstream.
  if (typeof part.mass_g === 'number' && Number.isFinite(part.mass_g) && part.mass_g > 0) {
    out.mass_g = part.mass_g
  }
  if (
    Array.isArray(part.com_xyz) &&
    part.com_xyz.length === 3 &&
    part.com_xyz.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    out.com_xyz = [part.com_xyz[0], part.com_xyz[1], part.com_xyz[2]]
  }
  // Ground-contact points (#569): keep finite mm vec3s, drop malformed ones.
  if (Array.isArray(part.contacts)) {
    const pts = part.contacts.filter(
      (p): p is [number, number, number] =>
        Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
    )
    if (pts.length) out.contacts = pts.map((p) => [p[0], p[1], p[2]])
  }
  // Electrical behaviour (#597 / #600) — reuse the shared coercer so the save-time
  // whitelist keeps the SAME fields the YAML round-trip does (no silent drop).
  const electrical = coerceElectrical(part.electrical)
  if (electrical) out.electrical = electrical
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
  // I²C address list (#214). The 7-bit range check mirrors `partFromYaml`'s, so
  // the editor and the on-disk coercer agree on what a valid address is.
  if (Array.isArray(part.i2cAddresses)) {
    const addrs = part.i2cAddresses.filter(
      (a) => Number.isInteger(a) && a >= 0 && a <= 0x7f
    )
    if (addrs.length) out.i2cAddresses = addrs
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
  if (Array.isArray(part.drivers) && part.drivers.length) {
    const drivers = part.drivers
      .map((d): DriverFile | null => {
        const source = text(d?.source)
        const target = text(d?.target)
        if (source === undefined || target === undefined) return null
        const driver: DriverFile = { source, target }
        const label = text(d?.label)
        if (label !== undefined) driver.label = label
        return driver
      })
      .filter((d): d is DriverFile => d !== null)
    if (drivers.length) out.drivers = drivers
  }
  if (Array.isArray(part.suggests) && part.suggests.length) {
    const suggests = part.suggests
      .map((s): SuggestedModule | null => {
        const module = text(s?.module)
        if (module === undefined) return null
        const out: SuggestedModule = { module }
        const unlocks = text(s?.unlocks)
        if (unlocks !== undefined) out.unlocks = unlocks
        return out
      })
      .filter((s): s is SuggestedModule => s !== null)
    if (suggests.length) out.suggests = suggests
  }
  if (part.layerVisibility && typeof part.layerVisibility === 'object') {
    const lv: NonNullable<PartDefinition['layerVisibility']> = {}
    for (const key of ['pcb', 'image', 'holes', 'pins', 'components'] as const) {
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
  const named = (ps: PartPin[] | undefined): number =>
    (ps ?? []).filter((p) => String(p.name ?? '').trim() !== '').length
  // Connector contacts count as pins. A Grove or QWIIC module's ONLY electrical
  // interface is its socket — it has no broken-out header at all — so requiring a
  // header pin would reject an entire (and growing) class of real parts.
  const pins =
    (part.headers ?? []).reduce((n, h) => n + named(h.pins), 0) +
    (part.connectors ?? []).reduce((n, c) => n + named(c.pins), 0)
  if (pins === 0) return 'Add at least one pin — on a header or a connector.'
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
      if (typeof p.number === 'number') pad.number = p.number
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        pad.x = p.x
        pad.y = p.y
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

/** A part counts as a board when it declares the Microcontroller family. */
export function isBoardPart(part: { family?: string }): boolean {
  return (part.family ?? '').trim().toLowerCase() === 'microcontroller'
}

/**
 * Project the microcontroller parts of the installed libraries into board
 * definitions (#168 / boards-from-library). Deduped by id, the most complete
 * (most pads) winning so a full pinout beats a stub of the same id. Pure.
 */
export function boardsFromLibraries(libraries: { parts?: PartDefinition[] }[]): BoardDefinition[] {
  const byId = new Map<string, { def: BoardDefinition; pads: number }>()
  for (const lib of libraries ?? []) {
    for (const part of lib.parts ?? []) {
      if (!isBoardPart(part)) continue
      const def = partToBoardDefinition(part)
      const pads = def.headers.reduce((n, h) => n + h.pins.length, 0)
      if (pads === 0) continue
      const prev = byId.get(def.id)
      if (!prev || pads > prev.pads) byId.set(def.id, { def, pads })
    }
  }
  return [...byId.values()].map((v) => v.def).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The source microcontroller PART behind a board id (so the board view can draw it
 * life-like via PartBody, issue-1). Mirrors {@link boardsFromLibraries}'s dedupe
 * (the most complete pinout wins). Null for a built-in board with no source part.
 */
export function boardPartFor(
  libraries: { parts?: PartDefinition[] }[],
  boardId: string
): PartDefinition | null {
  let best: { part: PartDefinition; pads: number } | null = null
  for (const lib of libraries ?? []) {
    for (const part of lib.parts ?? []) {
      if (!isBoardPart(part) || partToBoardDefinition(part).id !== boardId) continue
      const pads = (part.headers ?? []).reduce((n, h) => n + (h.pins?.length ?? 0), 0)
      if (pads > 0 && (!best || pads > best.pads)) best = { part, pads }
    }
  }
  return best?.part ?? null
}

/**
 * The board list for the selector: boards sourced from the parts libraries (the
 * standard + user board parts) win by id, then any Board-Creator boards, then the
 * hardcoded built-ins fill the gaps — so a library board REPLACES its built-in
 * namesake (e.g. `pico2w`) while bundled boards without a library equivalent (the
 * Pimoroni Tiny / Plus) stay available. Never empty. Pure.
 */
export function resolveBoards(
  libraries: { parts?: PartDefinition[] }[],
  userBoards?: BoardDefinition[]
): BoardDefinition[] {
  const byId = new Map<string, BoardDefinition>()
  for (const b of [...boardsFromLibraries(libraries), ...(userBoards ?? []), ...BUILTIN_BOARDS]) {
    if (!byId.has(b.id)) byId.set(b.id, b)
  }
  return [...byId.values()]
}

// --- Driver install (#184) --------------------------------------------------

/** A placed part that declares MicroPython driver file(s) to install (#184). */
export interface PartDriverNeed {
  /** Stable key (`<libraryId>:<partId>`) — dedup + React list key. */
  key: string
  /** The library the part comes from. */
  libraryId: string
  /** The part id within that library. */
  partId: string
  /** Display label for the prompt (the part's name, else its id). */
  label: string
  /** The resolved part definition. */
  part: PartDefinition
  /** The driver files it needs on the board (non-empty). */
  drivers: DriverFile[]
}

/**
 * Which placed parts on the breadboard declare drivers that need installing
 * (#184). Resolves each `robot.parts` entry against the installed libraries and
 * keeps those whose part defines a non-empty `drivers` list. Deduped by
 * `<lib>:<part>` (the same part placed twice prompts once). Pure + DOM-free, so
 * the Board View banner and the tests share one source of truth.
 */
export function placedPartsNeedingDrivers(
  robot: { parts?: RobotPart[] } | null | undefined,
  libraries: { id: string; parts?: PartDefinition[] }[]
): PartDriverNeed[] {
  const out: PartDriverNeed[] = []
  const seen = new Set<string>()
  for (const rp of robot?.parts ?? []) {
    const key = `${rp.lib}:${rp.part}`
    if (seen.has(key)) continue
    const part = libraries.find((l) => l.id === rp.lib)?.parts?.find((p) => p.id === rp.part)
    if (!part || !part.drivers || part.drivers.length === 0) continue
    seen.add(key)
    out.push({
      key,
      libraryId: rp.lib,
      partId: rp.part,
      label: part.name || rp.part,
      part,
      drivers: part.drivers
    })
  }
  return out
}

/** How a driver's {@link DriverFile.source} is installed (#184).
 *  `module` = a `module:<id>` reference into the modules catalog (#638). */
export type DriverInstallMethod = 'mip' | 'copy' | 'module'

/** The catalog id in a `module:<id>` driver source (empty when not that form). */
export function driverModuleId(source: string): string {
  const s = String(source ?? '').trim()
  return /^module:/i.test(s) ? s.slice(s.indexOf(':') + 1).trim() : ''
}

/**
 * Classify a driver source into its install mechanism (#184). A `github:` /
 * `gitlab:` / `pypi:` spec, or a bare micropython-lib package name (no scheme,
 * no slash, no file extension), installs via `mip`; everything else — an
 * `http(s)://` URL or a bundled / relative file path — is copied to its target.
 * Pure.
 */
export function driverInstallMethod(source: string): DriverInstallMethod {
  const s = String(source ?? '').trim()
  // `module:<id>` — a driver from the MODULES CATALOG (#638). Lets a part require
  // a driver that Snakie already ships without copying the .py into every part
  // folder that needs it; six Grove parts share four drivers.
  if (/^module:/i.test(s)) return 'module'
  if (/^(github|gitlab|pypi):/i.test(s)) return 'mip'
  const hasScheme = /:\/\//.test(s)
  const isBareName = !hasScheme && !s.includes('/') && !/\.(py|mpy)$/i.test(s)
  return isBareName ? 'mip' : 'copy'
}

/**
 * The on-device folder(s) a copied driver's {@link DriverFile.target} needs,
 * ordered shallowest→deepest so each can be `os.mkdir`'d in turn (MicroPython has
 * no recursive mkdir). e.g. `"lib/drivers/x.py"` → `["lib", "lib/drivers"]`,
 * `"/lib/x.py"` → `["/lib"]`, a root-level `"x.py"` → `[]`. Pure.
 */
export function driverDeviceDirs(target: string): string[] {
  const norm = String(target ?? '').trim().replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  if (slash <= 0) return [] // no folder, or only a leading "/"
  const dir = norm.slice(0, slash)
  const abs = dir.startsWith('/')
  const segs = dir.split('/').filter((s) => s !== '')
  const dirs: string[] = []
  let acc = ''
  for (const seg of segs) {
    acc = acc === '' ? (abs ? `/${seg}` : seg) : `${acc}/${seg}`
    dirs.push(acc)
  }
  return dirs
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

// --- The single layer hierarchy (#…) ----------------------------------------
// One tree for everything the Part Editor can select, so a Grove connector and
// its contacts (or a servo header's S/V/G trio) sit together and move together.
//
// Shape of the tree, decided deliberately:
//   * GROUPS sit at the top level and may mix kinds — that is the whole point.
//     A nested group appears inside its parent.
//   * UNGROUPED items fall into kind BUCKETS (Components / Pins / Mounting
//     holes). Without them a 78-pad board buries its three interesting rows in
//     a wall of pins; with them, the servo2040 reads as 18 servo-header groups
//     plus a short bucket of loose I/O.
// The rule is positional, not clever: grouped ⇒ top level, ungrouped ⇒ bucket.

/** Every kind of thing that can appear as a leaf in the hierarchy. */
export type HierItemKind = OrderedItemKind | 'pin' | 'hole' | 'mount'

/** A leaf's identity: its kind plus its index in that kind's array. Pins use the
 *  FLAT index across headers (the same one endpoints and `resolvedPins` use). */
export interface HierItem {
  kind: HierItemKind
  index: number
}

export type LayerBucket = 'components' | 'pins' | 'holes' | 'mounts'

export interface LayerNode {
  /** Stable key for React and for remembering which rows are collapsed. */
  id: string
  kind: 'group' | 'bucket' | 'item'
  label: string
  children: LayerNode[]
  /** Leaf nodes only — what a click selects. */
  item?: HierItem
  /** Group nodes only. */
  groupId?: string
  /** Bucket nodes only. */
  bucket?: LayerBucket
  /** EFFECTIVE state, with the group ancestry resolved — what the canvas obeys. */
  hidden: boolean
  locked: boolean
  /** The node's OWN flag — what its eye/lock toggle writes. Differs from the
   *  effective state whenever an ancestor group is hidden or locked, which is how
   *  the row shows "hidden because the group is" without clobbering its own flag. */
  ownHidden: boolean
  ownLocked: boolean
}

const BUCKET_LABEL: Record<LayerBucket, string> = {
  components: 'Components',
  pins: 'Pins',
  holes: 'Mounting holes',
  mounts: 'Footprints'
}

/** Every leaf in the part, with the flags and label the tree needs. */
function hierLeaves(part: PartDefinition): { node: LayerNode; group?: string }[] {
  const out: { node: LayerNode; group?: string }[] = []
  const push = (kind: HierItemKind, index: number, label: string, flags: PartItemFlags): void => {
    out.push({
      group: flags.group,
      node: {
        id: `${kind}:${index}`,
        kind: 'item',
        label,
        children: [],
        item: { kind, index },
        hidden: itemHidden(part.groups, flags),
        locked: itemLocked(part.groups, flags),
        ownHidden: !!flags.hidden,
        ownLocked: !!flags.locked
      }
    })
  }
  // Components, in their existing paint order so the tree matches the canvas.
  for (const it of orderedItems(part)) {
    if (it.kind === 'shape') {
      const s = (part.shapes ?? [])[it.index]
      push('shape', it.index, s?.label || s?.kind || 'Shape', s ?? {})
    } else if (it.kind === 'label') {
      const l = (part.labels ?? [])[it.index]
      push('label', it.index, l?.text || 'Label', l ?? {})
    } else if (it.kind === 'button') {
      const b = (part.buttons ?? [])[it.index]
      push('button', it.index, b?.label || 'Button', b ?? {})
    } else if (it.kind === 'led') {
      const l = (part.onboardLeds ?? [])[it.index]
      push('led', it.index, l?.label || l?.kind || 'LED', l ?? {})
    } else if (it.kind === 'connector') {
      const c = (part.connectors ?? [])[it.index]
      push('connector', it.index, c?.label || c?.kind?.toUpperCase() || 'Connector', c ?? {})
    }
  }
  // Skip pins imprinted from a footprint (#166) — they belong to their mount, not
  // the loose Pins bucket, and would otherwise bury it under a carrier's 14+ pads.
  resolvedPins(part).forEach((rp, i) => {
    if (rp.pin.derived) return
    push('pin', i, rp.pin.name || `Pin ${i + 1}`, rp.pin)
  })
  ;(part.mountingHoles ?? []).forEach((h, i) => push('hole', i, `Hole ${i + 1}`, h))
  ;(part.mounts ?? []).forEach((m, i) => push('mount', i, m.label || m.footprint || `Footprint ${i + 1}`, {}))
  return out
}

/**
 * Build the Part Editor's single layer hierarchy.
 *
 * Groups come first (they are the structure worth seeing), then the buckets of
 * whatever is left. An EMPTY bucket is omitted; an empty group is not, because a
 * group with nothing in it is a thing the user is mid-way through filling.
 */
export function partLayerTree(part: PartDefinition): LayerNode[] {
  const leaves = hierLeaves(part)
  const registry = part.groups ?? []
  // An item may reference a group id that was never written to the `groups`
  // registry — the servo2040's 18 servo-header trios are authored exactly that
  // way, with `group: servo-1` on the pins and no registry at all. Synthesise
  // those, or each header scatters into the pin bucket and the tree becomes the
  // wall of 78 rows the buckets exist to prevent. First-seen order, so headers
  // list in board order.
  const registered = new Set(registry.map((g) => g.id))
  const synthesised: PartGroup[] = []
  for (const l of leaves) {
    if (l.group && !registered.has(l.group) && !synthesised.some((g) => g.id === l.group)) {
      synthesised.push({ id: l.group })
    }
  }
  const groups: PartGroup[] = [...registry, ...synthesised]

  const groupNode = (g: PartGroup): LayerNode => {
    const flags: PartItemFlags = { group: g.parent, hidden: g.hidden, locked: g.locked }
    return {
      id: `group:${g.id}`,
      kind: 'group',
      label: g.name || g.id,
      groupId: g.id,
      children: [
        ...groups.filter((c) => c.parent === g.id).map(groupNode),
        ...leaves.filter((l) => l.group === g.id).map((l) => l.node)
      ],
      hidden: itemHidden(groups, flags),
      locked: itemLocked(groups, flags),
      ownHidden: !!g.hidden,
      ownLocked: !!g.locked
    }
  }

  // A group whose `parent` doesn't exist would otherwise vanish from the tree —
  // treat it as top-level rather than losing it and everything inside it.
  const known = new Set(groups.map((g) => g.id))
  const roots = groups.filter((g) => !g.parent || !known.has(g.parent))

  const bucketOf = (k: HierItemKind): LayerBucket =>
    k === 'pin' ? 'pins' : k === 'hole' ? 'holes' : k === 'mount' ? 'mounts' : 'components'

  const buckets: LayerNode[] = (['components', 'pins', 'holes', 'mounts'] as LayerBucket[])
    .map((b): LayerNode => {
      const kids = leaves
        .filter((l) => !l.group || !known.has(l.group))
        .filter((l) => bucketOf(l.node.item!.kind) === b)
        .map((l) => l.node)
      return {
        id: `bucket:${b}`,
        kind: 'bucket',
        label: BUCKET_LABEL[b],
        bucket: b,
        children: kids,
        // A bucket is a view, not a thing — it has no flags of its own. It reads
        // as hidden/locked only when everything inside it is.
        hidden: kids.length > 0 && kids.every((k) => k.hidden),
        locked: kids.length > 0 && kids.every((k) => k.locked),
        ownHidden: false,
        ownLocked: false
      }
    })
    .filter((b) => b.children.length > 0)

  return [...roots.map(groupNode), ...buckets]
}

/** Map a hierarchy leaf back to the pin's (header, pin) indices — `HierItem`
 *  carries the FLAT pin index, but the part stores pins per header. */
export function pinAt(part: PartDefinition, flatIndex: number): { hi: number; pi: number } | null {
  const rp = resolvedPins(part)[flatIndex]
  return rp ? { hi: rp.hi, pi: rp.pi } : null
}

/**
 * Set `hidden` or `locked` on one item, returning the fields to patch.
 *
 * Writes the item's OWN flag only — never a group's, and never its siblings'. A
 * row that reads as hidden because its group is stays untouched, so un-hiding the
 * group brings back exactly what was showing before.
 */
export function withItemFlag(
  part: PartDefinition,
  item: HierItem,
  flag: 'hidden' | 'locked',
  value: boolean
): Partial<PartDefinition> {
  const set = <T extends object>(arr: T[] | undefined, index: number): T[] =>
    (arr ?? []).map((el, i) => (i === index ? { ...el, [flag]: value || undefined } : el))
  switch (item.kind) {
    case 'shape':
      return { shapes: set(part.shapes, item.index) }
    case 'label':
      return { labels: set(part.labels, item.index) }
    case 'button':
      return { buttons: set(part.buttons, item.index) }
    case 'led':
      return { onboardLeds: set(part.onboardLeds, item.index) }
    case 'connector':
      return { connectors: set(part.connectors, item.index) }
    case 'hole':
      return { mountingHoles: set(part.mountingHoles, item.index) }
    case 'mount':
      // Footprint mounts (#166) have no per-item hidden/locked flag — the whole
      // Footprints layer toggles them — so there's nothing to write.
      return {}
    case 'pin': {
      const at = pinAt(part, item.index)
      if (!at) return {}
      return {
        headers: (part.headers ?? []).map((h, hi) =>
          hi === at.hi ? { ...h, pins: set(h.pins, at.pi) } : h
        )
      }
    }
  }
}

/**
 * Set `hidden`/`locked` on a GROUP. A group id referenced by items but absent
 * from the registry (the servo2040's headers) is registered on the way, so the
 * flag has somewhere to live instead of being silently discarded.
 */
export function withGroupFlag(
  part: PartDefinition,
  groupId: string,
  flag: 'hidden' | 'locked',
  value: boolean
): Partial<PartDefinition> {
  const groups = part.groups ?? []
  const known = groups.some((g) => g.id === groupId)
  const next = known
    ? groups.map((g) => (g.id === groupId ? { ...g, [flag]: value || undefined } : g))
    : [...groups, { id: groupId, [flag]: value || undefined }]
  return { groups: next }
}


/**
 * Name (or rename) a group.
 *
 * Registers the group first if it isn't in the registry. Groups can exist purely
 * as an id referenced by items — the servo2040 carries `group: servo-1` on its
 * pins and no `groups:` block at all — and mapping over the registry would
 * silently drop the new name for exactly those. An empty name clears back to the
 * id rather than storing `""`.
 */
export function withGroupName(part: PartDefinition, groupId: string, name: string): Partial<PartDefinition> {
  const clean = name.trim()
  const groups = part.groups ?? []
  return {
    groups: groups.some((g) => g.id === groupId)
      ? groups.map((g) => (g.id === groupId ? { ...g, name: clean || undefined } : g))
      : [...groups, { id: groupId, name: clean || undefined }]
  }
}

/** The bundled Standard library's id (mirrors `STANDARD_LIBRARY_ID` in main). */
export const STANDARD_LIB_ID = 'snakie-standard'
/** The auto-created library a user's own parts are saved into. */
export const LOCAL_LIB_ID = 'my-parts'

/**
 * The libraries offered as SAVE TARGETS in the Part Editor (#633).
 *
 * The bundled Standard library is a developer target, not a user one. Saving into
 * it edits the copy the seeder manages, which strands that part on an old schema
 * with no way back — the whole of #643. A regular user should be writing to their
 * own library, so Standard is filtered out of the picker for them.
 *
 * The CURRENT target always survives the filter, even when it would otherwise be
 * hidden: a select whose value isn't among its options renders blank, and an
 * in-place edit of a bundled part (opened by a developer, or from an older
 * session) must still show honestly where it is about to be written.
 *
 * `my-parts` is always offered, even before it exists on disk — the first save
 * auto-provisions it.
 */
export function saveTargets(
  libraries: { id: string; name: string }[],
  currentLibId: string,
  isDev: boolean
): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  const seen = new Set<string>()
  const add = (id: string, name: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, name })
  }
  const known = new Map(libraries.map((l) => [l.id, l.name]))
  add(LOCAL_LIB_ID, known.get(LOCAL_LIB_ID) ?? 'My Parts')
  for (const lib of libraries) {
    if (lib.id === STANDARD_LIB_ID && !isDev) continue
    add(lib.id, lib.name)
  }
  // Never let the picker misreport where a save is going.
  add(currentLibId, known.get(currentLibId) ?? currentLibId)
  return out
}
