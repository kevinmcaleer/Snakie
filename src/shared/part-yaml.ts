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
  ComponentShape,
  ComponentShapeKind,
  DriverFile,
  OnboardLed,
  PartConnector,
  PartDefinition,
  PartEdge,
  PartFeature,
  PartHeader,
  PartLabel,
  PartLibrary,
  PartPin,
  PartPinBuses,
  PartPinCapability,
  PartPinShape,
  PartPinSignals,
  PartPinType,
  SchematicPin,
  TextAlign
} from './part'

const PIN_TYPES: PartPinType[] = ['pwr', 'gnd', 'io', 'other']
const CAPABILITIES: PartPinCapability[] = ['digital', 'pwm', 'adc', 'spi', 'i2c', 'uart']
const SPI_SIGNALS = ['RX', 'CSn', 'SCK', 'TX']

/** Coerce a raw `signals` map from YAML into a clean {@link PartPinSignals}. */
function coerceSignals(raw: unknown): PartPinSignals | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: PartPinSignals = {}
  const i2c = String(r.i2c ?? '').toUpperCase()
  if (i2c === 'SDA' || i2c === 'SCL') out.i2c = i2c
  const spi = String(r.spi ?? '')
  const spiMatch = SPI_SIGNALS.find((s) => s.toLowerCase() === spi.toLowerCase())
  if (spiMatch) out.spi = spiMatch as PartPinSignals['spi']
  const uart = String(r.uart ?? '').toUpperCase()
  if (uart === 'TX' || uart === 'RX') out.uart = uart
  const pwm = String(r.pwm ?? '').toUpperCase()
  if (pwm === 'A' || pwm === 'B') out.pwm = pwm
  return Object.keys(out).length ? out : undefined
}

/** Coerce a raw `buses` map from YAML into a clean {@link PartPinBuses}. */
function coerceBuses(raw: unknown): PartPinBuses | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: PartPinBuses = {}
  for (const k of ['i2c', 'spi', 'uart', 'adc'] as const) {
    const n = num(r[k])
    if (n !== undefined) out[k] = n
  }
  return Object.keys(out).length ? out : undefined
}
const PIN_SHAPES: PartPinShape[] = ['square', 'round', 'castellated', 'header']
const SHAPE_KINDS: ComponentShapeKind[] = ['rect', 'circle', 'polygon']
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

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

/** Coerce a horizontal text alignment, ignoring anything unrecognised. */
function textAlign(v: unknown): TextAlign | undefined {
  const s = str(v)
  return s === 'left' || s === 'center' || s === 'right' ? s : undefined
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
    const signals = coerceSignals(r.signals)
    if (signals) pin.signals = signals
    const buses = coerceBuses(r.buses)
    if (buses) pin.buses = buses
  }
  const label = str(r.label)
  if (label && label !== name) pin.label = label
  if (r.castellated === true) pin.castellated = true
  if (PIN_SHAPES.includes(r.shape as PartPinShape)) pin.shape = r.shape as PartPinShape
  const rotation = num(r.rotation)
  if (rotation !== undefined) pin.rotation = rotation
  const x = num(r.x)
  const y = num(r.y)
  if (x !== undefined) pin.x = x
  if (y !== undefined) pin.y = y
  if (r.labelOffset && typeof r.labelOffset === 'object') {
    const lo = r.labelOffset as Record<string, unknown>
    const lx = num(lo.x)
    const ly = num(lo.y)
    if (lx !== undefined && ly !== undefined) pin.labelOffset = { x: lx, y: ly }
  }
  return pin
}

/** Coerce one raw component-shape object from YAML into a {@link ComponentShape}. */
function coerceShape(raw: unknown): ComponentShape | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = (SHAPE_KINDS.includes(r.kind as ComponentShapeKind) ? r.kind : 'rect') as ComponentShapeKind
  const x = num(r.x)
  const y = num(r.y)
  if (x === undefined || y === undefined) return null
  const shape: ComponentShape = { kind, x, y }
  const label = str(r.label)
  if (label) shape.label = label
  const fill = str(r.fill)
  if (fill) shape.fill = fill
  const stroke = str(r.stroke)
  if (stroke) shape.stroke = stroke
  const sw = num(r.strokeWidth)
  if (sw !== undefined) shape.strokeWidth = sw
  const w = num(r.w)
  const h = num(r.h)
  if (w !== undefined) shape.w = w
  if (h !== undefined) shape.h = h
  const rad = num(r.r)
  if (rad !== undefined) shape.r = rad
  if (Array.isArray(r.points)) {
    const pts = r.points
      .map((p) => {
        const pr = p as Record<string, unknown>
        const px = num(pr?.x)
        const py = num(pr?.y)
        return px !== undefined && py !== undefined ? { x: px, y: py } : null
      })
      .filter((p): p is { x: number; y: number } => p !== null)
    if (pts.length >= 3) shape.points = pts
  }
  const z = num(r.z)
  if (z !== undefined) shape.z = z
  const rotation = num(r.rotation)
  if (rotation) shape.rotation = ((((Math.round(rotation / 90) * 90) % 360) + 360) % 360) || undefined
  const cornerRadius = num(r.cornerRadius)
  if (cornerRadius !== undefined) shape.cornerRadius = Math.max(0, cornerRadius)
  // Shape-label text styling.
  const lfs = num(r.labelFontSize)
  if (lfs !== undefined) shape.labelFontSize = lfs
  if (bool(r.labelBold)) shape.labelBold = true
  if (bool(r.labelItalic)) shape.labelItalic = true
  if (bool(r.labelUnderline)) shape.labelUnderline = true
  const la = textAlign(r.labelAlign)
  if (la) shape.labelAlign = la
  if (bool(r.labelWrap)) shape.labelWrap = true
  const lc = str(r.labelColor)
  if (lc) shape.labelColor = lc
  return shape
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

/** Coerce one raw driver entry from YAML into a {@link DriverFile} (or null). */
function coerceDriver(raw: unknown): DriverFile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const source = str(r.source)
  const target = str(r.target)
  if (source === undefined || target === undefined) return null
  const driver: DriverFile = { source, target }
  const label = str(r.label)
  if (label !== undefined) driver.label = label
  return driver
}

/** Serialise a {@link DriverFile} to a tidy plain object for YAML. */
function driverToObj(d: DriverFile): Record<string, unknown> {
  const out: Record<string, unknown> = { source: d.source, target: d.target }
  if (d.label) out.label = d.label
  return out
}

/** Serialise a {@link PartPin} to a tidy plain object for YAML. */
function pinToObj(p: PartPin): Record<string, unknown> {
  const out: Record<string, unknown> = { name: p.name, type: p.type }
  if (p.number !== undefined) out.number = p.number
  if (p.type === 'io' && p.gpio !== undefined) out.gpio = p.gpio
  if (p.type === 'io' && p.capabilities?.length) out.capabilities = p.capabilities
  if (p.type === 'io' && p.signals && Object.keys(p.signals).length) out.signals = p.signals
  if (p.type === 'io' && p.buses && Object.keys(p.buses).length) out.buses = p.buses
  if (p.label && p.label !== p.name) out.label = p.label
  if (p.castellated) out.castellated = true
  if (p.shape) out.shape = p.shape
  if (p.rotation !== undefined) out.rotation = p.rotation
  if (p.x !== undefined) out.x = p.x
  if (p.y !== undefined) out.y = p.y
  if (p.labelOffset) out.labelOffset = { x: p.labelOffset.x, y: p.labelOffset.y }
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
    shape: part.shape,
    headers: part.headers?.map((h) => ({ edge: h.edge, pins: h.pins.map(pinToObj) })),
    mountingHoles: part.mountingHoles,
    buttons: part.buttons,
    features: part.features,
    shapes: part.shapes,
    labels: part.labels,
    onboardLeds: part.onboardLeds,
    connectors: part.connectors?.map((c) => ({
      kind: c.kind,
      label: c.label,
      x: c.x,
      y: c.y,
      pins: c.pins.map(pinToObj)
    })),
    ledLabel: part.ledLabel,
    // NB: `image` (the filename) is kept; `imageData` (the inlined blob) is NOT.
    image: part.image,
    imageLayer: part.imageLayer,
    // NB: `help` (the filename) is kept; `helpText` (the inlined markdown) is NOT.
    help: part.help,
    // The linked mesh is a relative filename (never a blob), like `image`/`help`.
    mesh: part.mesh,
    meshUnits: part.meshUnits,
    meshScale: part.meshScale,
    schematic: part.schematic,
    i2cAddresses: part.i2cAddresses,
    library: part.library,
    drivers: part.drivers?.map(driverToObj),
    layerVisibility: part.layerVisibility
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
  if (raw.shape && typeof raw.shape === 'object') {
    const s = raw.shape as Record<string, unknown>
    const kind = s.kind === 'polygon' ? 'polygon' : 'rect'
    part.shape = { kind }
    const cr = num(s.cornerRadius)
    if (cr !== undefined) part.shape.cornerRadius = cr
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
    const KINDS = ['mcu', 'wifi', 'usb', 'chip', 'led']
    const features = raw.features
      .map((f): PartFeature | null => {
        if (!f || typeof f !== 'object') return null
        const r = f as Record<string, unknown>
        const x = num(r.x)
        const y = num(r.y)
        const w = num(r.w)
        const h = num(r.h)
        if (x === undefined || y === undefined || w === undefined || h === undefined) return null
        const kind = (KINDS.includes(r.kind as string) ? r.kind : 'chip') as PartFeature['kind']
        return { label: str(r.label) ?? '', kind, x, y, w, h }
      })
      .filter((f): f is PartFeature => f !== null)
    if (features.length) part.features = features
  }
  if (Array.isArray(raw.shapes)) {
    const shapes = raw.shapes.map(coerceShape).filter((s): s is ComponentShape => s !== null)
    if (shapes.length) part.shapes = shapes
  }
  if (Array.isArray(raw.labels)) {
    const labels = raw.labels
      .map((l) => {
        const rec = l as Record<string, unknown>
        const text = str(rec?.text)
        const x = num(rec?.x)
        const y = num(rec?.y)
        if (text === undefined || x === undefined || y === undefined) return null
        const out: PartLabel = { text, x, y }
        const fs = num(rec?.fontSize)
        if (fs !== undefined) out.fontSize = fs
        const z = num(rec?.z)
        if (z !== undefined) out.z = z
        const rot = num(rec?.rotation)
        if (rot) out.rotation = ((((Math.round(rot / 90) * 90) % 360) + 360) % 360) || undefined
        if (bool(rec?.bold)) out.bold = true
        if (bool(rec?.italic)) out.italic = true
        if (bool(rec?.underline)) out.underline = true
        const al = textAlign(rec?.align)
        if (al) out.align = al
        const col = str(rec?.color)
        if (col) out.color = col
        return out
      })
      .filter((l): l is PartLabel => l !== null)
    if (labels.length) part.labels = labels
  }
  if (Array.isArray(raw.onboardLeds)) {
    const leds = raw.onboardLeds
      .map((l): OnboardLed | null => {
        if (!l || typeof l !== 'object') return null
        const r = l as Record<string, unknown>
        const x = num(r.x)
        const y = num(r.y)
        if (x === undefined || y === undefined) return null
        const kind: OnboardLed['kind'] =
          r.kind === 'rgb' ? 'rgb' : r.kind === 'neopixel' ? 'neopixel' : 'single'
        const led: OnboardLed = { kind, x, y }
        const label = str(r.label)
        if (label) led.label = label
        if (kind === 'rgb') {
          if (r.rgb && typeof r.rgb === 'object') {
            const rc = r.rgb as Record<string, unknown>
            const obj: { r?: number; g?: number; b?: number } = {}
            const rr = num(rc.r)
            const gg = num(rc.g)
            const bb = num(rc.b)
            if (rr !== undefined) obj.r = rr
            if (gg !== undefined) obj.g = gg
            if (bb !== undefined) obj.b = bb
            if (Object.keys(obj).length) led.rgb = obj
          }
        } else {
          const g = num(r.gpio)
          if (g !== undefined) led.gpio = g
          if (kind === 'neopixel') {
            const p = num(r.power)
            if (p !== undefined) led.power = p
          } else {
            const col = str(r.color)
            if (col) led.color = col
          }
        }
        return led
      })
      .filter((l): l is OnboardLed => l !== null)
    if (leds.length) part.onboardLeds = leds
  }
  if (Array.isArray(raw.connectors)) {
    const connectors = raw.connectors
      .map((c): PartConnector | null => {
        if (!c || typeof c !== 'object') return null
        const r = c as Record<string, unknown>
        const x = num(r.x)
        const y = num(r.y)
        if (x === undefined || y === undefined) return null
        const kind: PartConnector['kind'] = r.kind === 'jst' ? 'jst' : 'qwiic'
        const pins = Array.isArray(r.pins)
          ? r.pins.map(coercePin).filter((p): p is PartPin => p !== null)
          : []
        const conn: PartConnector = { kind, x, y, pins }
        const label = str(r.label)
        if (label) conn.label = label
        return conn
      })
      .filter((c): c is PartConnector => c !== null)
    if (connectors.length) part.connectors = connectors
  }
  assign('ledLabel', str(raw.ledLabel))
  assign('image', str(raw.image))
  assign('help', str(raw.help))
  assign('mesh', str(raw.mesh))
  const meshUnits = str(raw.meshUnits)
  if (meshUnits === 'mm' || meshUnits === 'm') assign('meshUnits', meshUnits)
  assign('meshScale', num(raw.meshScale))
  if (raw.imageLayer && typeof raw.imageLayer === 'object') {
    const il = raw.imageLayer as Record<string, unknown>
    const x = num(il.x)
    const y = num(il.y)
    const w = num(il.w)
    const h = num(il.h)
    if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
      part.imageLayer = { x, y, w, h }
      const op = num(il.opacity)
      const rot = num(il.rotation)
      if (op !== undefined) part.imageLayer.opacity = op
      if (rot !== undefined) part.imageLayer.rotation = rot
    }
  }
  if (raw.schematic && typeof raw.schematic === 'object' && !Array.isArray(raw.schematic)) {
    const s = raw.schematic as Record<string, unknown>
    if (Array.isArray(s.pins)) {
      const pins = s.pins
        .map((sp): SchematicPin | null => {
          if (!sp || typeof sp !== 'object') return null
          const r = sp as Record<string, unknown>
          const pin = str(r.pin)
          if (pin === undefined) return null
          const side = EDGES.includes(r.side as PartEdge) ? (r.side as PartEdge) : 'left'
          return { pin, side, order: num(r.order) ?? 0 }
        })
        .filter((p): p is SchematicPin => p !== null)
      if (pins.length) {
        part.schematic = { pins }
        const aspect = num(s.aspect)
        if (aspect !== undefined) part.schematic.aspect = aspect
      }
    }
  }

  // I²C address list (#214): accepts numbers or hex strings ("0x76"), 7-bit range.
  if (Array.isArray(raw.i2cAddresses)) {
    const addrs = raw.i2cAddresses
      .map((a) => (typeof a === 'string' ? Number(a) : (a as number)))
      .filter((a): a is number => Number.isInteger(a) && a >= 0 && a <= 0x7f)
    if (addrs.length) part.i2cAddresses = addrs
  }

  if (raw.library && typeof raw.library === 'object' && !Array.isArray(raw.library)) {
    const l = raw.library as Record<string, unknown>
    const lib: NonNullable<PartDefinition['library']> = {}
    const mod = str(l.module)
    const url = str(l.url)
    const docs = str(l.docs)
    if (mod !== undefined) lib.module = mod
    if (url !== undefined) lib.url = url
    if (docs !== undefined) lib.docs = docs
    if (Object.keys(lib).length) part.library = lib
  }

  if (Array.isArray(raw.drivers)) {
    const drivers = raw.drivers.map(coerceDriver).filter((d): d is DriverFile => d !== null)
    if (drivers.length) part.drivers = drivers
  }

  if (raw.layerVisibility && typeof raw.layerVisibility === 'object' && !Array.isArray(raw.layerVisibility)) {
    const lv = raw.layerVisibility as Record<string, unknown>
    const out: NonNullable<PartDefinition['layerVisibility']> = {}
    for (const key of ['pcb', 'image', 'holes', 'pins', 'components'] as const) {
      const b = bool(lv[key])
      if (b !== undefined) out[key] = b
    }
    if (Object.keys(out).length) part.layerVisibility = out
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
