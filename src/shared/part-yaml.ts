/**
 * `parts.yml` / `library.yml` (de)serialisation for the Parts Library (#129).
 *
 * A part is stored on disk as a **human-readable, hand-editable YAML file** in
 * its own folder (the epic's explicit requirement). This module is the single
 * place that converts between the on-disk YAML text and the in-memory
 * {@link PartDefinition} / {@link PartLibrary} shapes — used by the main process
 * (disk IO), the Part Editor (preview / import-paste) and the tests.
 *
 * It is intentionally tolerant on the way IN (coerces / defaults dodgy fields so
 * a hand-edited file still loads) and tidy on the way OUT (drops empty/undefined
 * fields, and NEVER writes the runtime-only `imageData` blob — the file keeps the
 * relative `image` filename so it stays small and diff-friendly).
 *
 * Depends only on the `yaml` package (a normal dependency available to all
 * layers); no React/Node/Electron.
 */

import { parse, stringify } from 'yaml'
import type {
  PartDefinition,
  PartHeader,
  PartLibrary,
  PartPin,
  PartPinCapability,
  PartPinType
} from './part'

const PIN_TYPES: PartPinType[] = ['pwr', 'gnd', 'io', 'other']
const CAPABILITIES: PartPinCapability[] = ['digital', 'pwm', 'adc', 'spi', 'i2c']
const EDGES = ['left', 'right', 'top', 'bottom'] as const

/** Drop `undefined`/`null`, empty strings, empty arrays + empty objects. */
function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    out[k] = v
  }
  return out as Partial<T>
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map((x) => String(x).trim()).filter((x) => x !== '')
  return out.length ? out : undefined
}

/** Coerce one raw pin object from YAML into a clean {@link PartPin}. */
function coercePin(raw: unknown): PartPin | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type: PartPinType = PIN_TYPES.includes(r.type as PartPinType)
    ? (r.type as PartPinType)
    : 'io'
  const name = str(r.name) ?? str(r.label) ?? ''
  if (!name) return null
  const pin: PartPin = { name, type }
  const number = num(r.number)
  if (number !== undefined) pin.number = number
  if (type === 'io') {
    const gpio = num(r.gpio)
    if (gpio !== undefined) pin.gpio = gpio
    if (Array.isArray(r.capabilities)) {
      const caps = (r.capabilities as unknown[])
        .map((c) => String(c).trim().toLowerCase())
        .filter((c): c is PartPinCapability => CAPABILITIES.includes(c as PartPinCapability))
      if (caps.length) pin.capabilities = caps
    }
  }
  const label = str(r.label)
  if (label && label !== name) pin.label = label
  if (r.castellated === true) pin.castellated = true
  return pin
}

/** Coerce one raw header object from YAML into a clean {@link PartHeader}. */
function coerceHeader(raw: unknown): PartHeader | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const edge = EDGES.includes(r.edge as (typeof EDGES)[number])
    ? (r.edge as PartHeader['edge'])
    : 'left'
  const pins = Array.isArray(r.pins)
    ? r.pins.map(coercePin).filter((p): p is PartPin => p !== null)
    : []
  if (pins.length === 0) return null
  return { edge, pins }
}

/** Serialise a {@link PartPin} to a tidy plain object for YAML. */
function pinToObj(p: PartPin): Record<string, unknown> {
  const out: Record<string, unknown> = { name: p.name, type: p.type }
  if (p.number !== undefined) out.number = p.number
  if (p.type === 'io' && p.gpio !== undefined) out.gpio = p.gpio
  if (p.type === 'io' && p.capabilities?.length) out.capabilities = p.capabilities
  if (p.label && p.label !== p.name) out.label = p.label
  if (p.castellated) out.castellated = true
  return out
}

/**
 * Serialise a {@link PartDefinition} to `parts.yml` text. Strips the runtime-only
 * `imageData` and any empty fields; keeps the relative `image` filename verbatim.
 */
export function partToYaml(part: PartDefinition): string {
  const obj = pruneEmpty({
    id: part.id,
    name: part.name,
    description: part.description,
    manufacturer: part.manufacturer,
    family: part.family,
    tags: part.tags,
    package: part.package,
    pinSpacing: part.pinSpacing,
    voltage: part.voltage,
    partNumber: part.partNumber,
    properties: part.properties,
    version: part.version,
    mcu: part.mcu,
    pcbColor: part.pcbColor,
    aspect: part.aspect,
    dimensions: part.dimensions,
    polygon: part.polygon,
    headers: part.headers?.map((h) => ({ edge: h.edge, pins: h.pins.map(pinToObj) })),
    mountingHoles: part.mountingHoles,
    buttons: part.buttons,
    features: part.features,
    ledLabel: part.ledLabel,
    // NB: `image` (the filename) is kept; `imageData` (the inlined blob) is NOT.
    image: part.image,
    schematic: part.schematic
  })
  return stringify(obj, { lineWidth: 0 })
}

/**
 * Parse `parts.yml` text into a {@link PartDefinition}. Tolerant: coerces/defaults
 * fields so a hand-edited file still loads. Throws only on syntactically invalid
 * YAML; a structurally-empty doc yields a minimal part with the given/`""` id.
 */
export function partFromYaml(text: string): PartDefinition {
  const raw = (parse(text) ?? {}) as Record<string, unknown>
  const headers = Array.isArray(raw.headers)
    ? raw.headers.map(coerceHeader).filter((h): h is PartHeader => h !== null)
    : []

  const part: PartDefinition = {
    id: str(raw.id) ?? '',
    name: str(raw.name) ?? str(raw.id) ?? 'Untitled Part',
    headers
  }

  const assign = <K extends keyof PartDefinition>(key: K, value: PartDefinition[K] | undefined): void => {
    if (value !== undefined) part[key] = value
  }

  assign('description', str(raw.description))
  assign('manufacturer', str(raw.manufacturer))
  assign('family', str(raw.family))
  assign('tags', strArray(raw.tags))
  if (raw.package === 'THT' || raw.package === 'SMD') part.package = raw.package
  assign('pinSpacing', num(raw.pinSpacing))
  assign('voltage', str(raw.voltage))
  assign('partNumber', str(raw.partNumber))
  if (raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties)) {
    const props: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.properties as Record<string, unknown>)) {
      const sv = str(v)
      if (sv !== undefined) props[k] = sv
    }
    if (Object.keys(props).length) part.properties = props
  }
  assign('version', str(raw.version))
  assign('mcu', str(raw.mcu))
  assign('pcbColor', str(raw.pcbColor))
  assign('aspect', num(raw.aspect))
  if (raw.dimensions && typeof raw.dimensions === 'object') {
    const d = raw.dimensions as Record<string, unknown>
    const width = num(d.width)
    const height = num(d.height)
    if (width !== undefined && height !== undefined) part.dimensions = { width, height }
  }
  if (Array.isArray(raw.polygon)) {
    const pts = raw.polygon
      .map((p) => {
        const x = num((p as Record<string, unknown>)?.x)
        const y = num((p as Record<string, unknown>)?.y)
        return x !== undefined && y !== undefined ? { x, y } : null
      })
      .filter((p): p is { x: number; y: number } => p !== null)
    if (pts.length >= 3) part.polygon = pts
  }
  if (Array.isArray(raw.mountingHoles)) {
    const holes = raw.mountingHoles
      .map((h) => {
        const x = num((h as Record<string, unknown>)?.x)
        const y = num((h as Record<string, unknown>)?.y)
        const diameter = num((h as Record<string, unknown>)?.diameter)
        return x !== undefined && y !== undefined
          ? { x, y, diameter: diameter ?? 2 }
          : null
      })
      .filter((h): h is { x: number; y: number; diameter: number } => h !== null)
    if (holes.length) part.mountingHoles = holes
  }
  if (Array.isArray(raw.buttons)) {
    const btns = raw.buttons
      .map((b) => {
        const label = str((b as Record<string, unknown>)?.label) ?? ''
        const x = num((b as Record<string, unknown>)?.x)
        const y = num((b as Record<string, unknown>)?.y)
        return x !== undefined && y !== undefined ? { label, x, y } : null
      })
      .filter((b): b is { label: string; x: number; y: number } => b !== null)
    if (btns.length) part.buttons = btns
  }
  if (Array.isArray(raw.features)) {
    part.features = raw.features as PartDefinition['features']
  }
  assign('ledLabel', str(raw.ledLabel))
  assign('image', str(raw.image))
  if (raw.schematic && typeof raw.schematic === 'object') {
    part.schematic = raw.schematic as PartDefinition['schematic']
  }

  return part
}

/** Serialise a {@link PartLibrary} manifest to `library.yml` text. */
export function libraryToYaml(lib: PartLibrary): string {
  const obj = pruneEmpty({
    id: lib.id,
    name: lib.name,
    description: lib.description,
    author: lib.author,
    homepage: lib.homepage,
    version: lib.version
  })
  return stringify(obj, { lineWidth: 0 })
}

/** Parse `library.yml` text into a {@link PartLibrary} manifest. */
export function libraryFromYaml(text: string): PartLibrary {
  const raw = (parse(text) ?? {}) as Record<string, unknown>
  const lib: PartLibrary = {
    id: str(raw.id) ?? '',
    name: str(raw.name) ?? str(raw.id) ?? 'Untitled Library'
  }
  if (str(raw.description)) lib.description = str(raw.description)
  if (str(raw.author)) lib.author = str(raw.author)
  if (str(raw.homepage)) lib.homepage = str(raw.homepage)
  if (str(raw.version)) lib.version = str(raw.version)
  return lib
}
