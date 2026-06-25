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
  type PartDefinition,
  type PartHeader,
  type PartPin,
  type PartPinCapability,
  type PartPinType,
  type PartPackage
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
export const CAPABILITIES: PartPinCapability[] = ['digital', 'pwm', 'adc', 'spi', 'i2c']

/** Human labels for each capability. */
export const CAPABILITY_LABEL: Record<PartPinCapability, string> = {
  digital: 'Digital',
  pwm: 'PWM',
  adc: 'ADC',
  spi: 'SPI',
  i2c: 'I²C'
}

/** Package types, in UI order. */
export const PACKAGES: PartPackage[] = ['THT', 'SMD']

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
  return out
}

/**
 * Normalise + minimally clean a working {@link PartDefinition} into a canonical,
 * round-trippable form. Pure: returns a NEW object, never throws. Optional
 * fields are only set when they carry content (so the YAML round-trip — which
 * prunes empties — deep-equals this result).
 */
export function normalisePart(part: PartDefinition): PartDefinition {
  const headers: PartHeader[] = (Array.isArray(part.headers) ? part.headers : [])
    .map((h) => ({
      edge: PART_EDGES.includes(h.edge) ? h.edge : 'left',
      pins: (Array.isArray(h.pins) ? h.pins : []).map(normalisePin).filter((p) => p.name !== '')
    }))
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
  set('ledLabel', text(part.ledLabel))
  // `image` is the relative filename; keep it. `imageData` (the runtime data URL)
  // is preserved for previews but is NOT part of the round-trip-comparable shape.
  set('image', text(part.image))
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
