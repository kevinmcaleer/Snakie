/**
 * PART DETAILS (#748) — what the full-sized part details view SHOWS, as pure data.
 * =============================================================================
 *
 * A catalog card has room for a picture, a name and one truncated line. Everything
 * else a part knows — who makes it, how big it is, what driver it installs and from
 * where, its help page, its 3-D model — is derived HERE, DOM-free, so the rules can
 * be unit-tested instead of being tangled into JSX:
 *
 *  - a spec row exists only when it has a VALUE (an empty `dl` row is worse than no
 *    row: it says the part declares something and then refuses to say what);
 *  - a section exists only when it has CONTENT — the issue's "simply absent when it
 *    doesn't [have a mesh], rather than an empty frame", generalised to every panel;
 *  - a mesh resolves to a real, in-folder path or to nothing at all, so the 3-D tab
 *    can never appear over a file the viewer will fail to open.
 *
 * Deliberately NOT shared with `PartsPanel`'s docked detail pane. The two have
 * genuinely different jobs — a 260 px authoring rail (edit / duplicate / promote /
 * reset-to-bundled, on the part you are working on) versus a full-screen reading
 * page — and the thing worth sharing between them is the DATA, which is this module,
 * not a component with a `compact` flag deciding which of a dozen sections to drop.
 */
import { driverInstallMethod, driverModuleId, type DriverInstallMethod } from './part-editor.util'
import { installPathFor, moduleById, type ModuleDef } from '../../../shared/modules-catalog'
import { parsePartHelp, type PartHelpMeta } from './part-help-meta'
import { isExternalMeshRef, meshKind, resolveMeshPath } from './robot-mesh'
import type { PartDefinition, PartPin, PartPinType } from '../../../shared/part'

/** Trim a maybe-string down to a non-empty value, or `undefined`. */
function text(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? undefined : s
}

/** A measurement with at most `dp` decimals and no trailing zeros (25.40 ⇒ `25.4`). */
function num(v: number, dp = 2): string {
  return String(Number(v.toFixed(dp)))
}

/** Only an http(s) address is a link we can hand to the user's browser — a `mip`
 *  spec (`github:org/repo`) is an install source, not somewhere to navigate. */
const HTTP_URL = /^https?:\/\//i

// --- Spec table ------------------------------------------------------------

/** One row of the spec table: a label and the value that earned it its row. */
export interface PartSpecRow {
  label: string
  value: string
}

/** How a `package` code reads when there is room to spell it out. */
const PACKAGE_LABELS: Record<string, string> = {
  THT: 'Through-hole (THT)',
  SMD: 'Surface-mount (SMD)'
}

/** The part's real size, in millimetres (`25.4 × 17.8 mm`). Absent unless the part
 *  declares usable dimensions — a 0-width board is not a measurement. */
export function formatDimensions(part: PartDefinition): string | undefined {
  const d = part.dimensions
  if (!d) return undefined
  const { width, height } = d
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width <= 0 || height <= 0) return undefined
  return `${num(width)} × ${num(height)} mm`
}

/** The part's mass in grams (`9 g`), where known. Grams throughout — a library part
 *  is a servo or a breakout, and `1200 g` reads clearer than a unit that changes. */
export function formatMass(part: PartDefinition): string | undefined {
  const g = part.mass_g
  if (typeof g !== 'number' || !Number.isFinite(g) || g <= 0) return undefined
  return `${num(g, 1)} g`
}

/** The 7-bit I²C address(es) the part answers on, as hex (`0x76, 0x77`). */
export function formatI2cAddresses(part: PartDefinition): string | undefined {
  const addrs = (part.i2cAddresses ?? []).filter(
    (a) => typeof a === 'number' && Number.isFinite(a) && a >= 0
  )
  if (addrs.length === 0) return undefined
  return addrs.map((a) => `0x${Math.trunc(a).toString(16).padStart(2, '0')}`).join(', ')
}

/**
 * The part's spec table: every header/physical field that HAS a value, in a fixed
 * reading order, with the author's own `properties` key/values appended (they are
 * extra spec rows by definition, and the full-screen view is where there is room
 * for them).
 */
export function partSpecRows(part: PartDefinition): PartSpecRow[] {
  const pkg = text(part.package)
  const spacing = part.pinSpacing
  const rows: [string, string | undefined][] = [
    ['Manufacturer', text(part.manufacturer)],
    ['Part #', text(part.partNumber)],
    ['Family', text(part.family)],
    ['Package', pkg ? (PACKAGE_LABELS[pkg] ?? pkg) : undefined],
    ['Voltage', text(part.voltage)],
    ['Dimensions', formatDimensions(part)],
    ['Mass', formatMass(part)],
    [
      'Pin spacing',
      typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0
        ? `${num(spacing)} mm`
        : undefined
    ],
    ['I²C address', formatI2cAddresses(part)],
    ['Version', text(part.version)]
  ]
  for (const [k, v] of Object.entries(part.properties ?? {})) rows.push([text(k) ?? '', text(v)])
  const out: PartSpecRow[] = []
  for (const [label, value] of rows) {
    if (!label || !value) continue
    out.push({ label, value })
  }
  return out
}

/** The part's tags, trimmed + de-duped, in author order. */
export function partTagList(part: PartDefinition): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of part.tags ?? []) {
    const t = text(raw)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

// --- Drivers ---------------------------------------------------------------

/** One driver the part installs: what it is, how it gets there, and where it lands. */
export interface PartDriverRow {
  /** Stable react key (index + source: the same source may legitimately repeat). */
  key: string
  /** Human label — the author's, else the catalog module's name, else the source. */
  label: string
  source: string
  method: DriverInstallMethod
  /** Where it lands on the board; derived from the catalog for `module:` sources. */
  target: string
  /** One line saying what installing it does, and from where. */
  summary: string
}

/** The device default when a driver names no install folder (mirrors `mip`'s). */
const DEFAULT_LIB = '/lib'

function driverSummary(
  method: DriverInstallMethod,
  source: string,
  target: string,
  def: ModuleDef | undefined,
  moduleId: string
): string {
  if (method === 'module') {
    // A catalog module may be a bundled stub (then `target` is its real install
    // path) or an upstream `mip` spec (then the ordinary module install decides),
    // so name the module and let the path fill in when there is one to give.
    return def
      ? `Installs the “${def.name}” module → ${target || DEFAULT_LIB}`
      : `Unknown module “${moduleId}” — nothing to install`
  }
  if (method === 'mip') return `Downloads the ${source} package → ${target || DEFAULT_LIB}`
  if (HTTP_URL.test(source)) return `Downloads ${source} → ${target || DEFAULT_LIB}`
  return `Copies ${source} (shipped with the part) → ${target || DEFAULT_LIB}`
}

/**
 * What this part installs on the board, and from where (#184 / #638). A blank
 * source is dropped; an unknown `module:` id is KEPT and says so, because hiding it
 * would leave a part looking driver-free when its author meant otherwise.
 */
export function partDriverRows(part: PartDefinition): PartDriverRow[] {
  const out: PartDriverRow[] = []
  ;(part.drivers ?? []).forEach((d, i) => {
    const source = text(d?.source)
    if (!source) return
    const method = driverInstallMethod(source)
    const moduleId = driverModuleId(source)
    const def = moduleId ? moduleById(moduleId) : undefined
    const target =
      (method === 'module' ? (def ? installPathFor(def) : undefined) : text(d.target)) ?? ''
    out.push({
      key: `${i}:${source}`,
      label: text(d.label) ?? def?.name ?? source,
      source,
      method,
      target,
      summary: driverSummary(method, source, target, def, moduleId)
    })
  })
  return out
}

/** The Python module the part's code is imported as (`import vl53l0x`), if linked. */
export function partCodeModule(part: PartDefinition): string | undefined {
  return text(part.library?.module)
}

/** An external page about the part — its library docs/source and any detailed guide
 *  named in the help file's front matter. */
export interface PartDocLink {
  label: string
  href: string
}

/** Every external page worth offering, de-duped. http(s) only. */
export function partDocLinks(part: PartDefinition): PartDocLink[] {
  const candidates: PartDocLink[] = [
    { label: 'Library docs', href: text(part.library?.docs) ?? '' },
    { label: 'Library source', href: text(part.library?.url) ?? '' },
    { label: 'Detailed guide', href: text(partHelpDoc(part)?.guideUrl) ?? '' }
  ]
  const seen = new Set<string>()
  const out: PartDocLink[] = []
  for (const c of candidates) {
    if (!HTTP_URL.test(c.href) || seen.has(c.href)) continue
    seen.add(c.href)
    out.push(c)
  }
  return out
}

// --- "Works with" ----------------------------------------------------------

/** An optional module this part can use, resolved against the modules catalog. */
export interface PartSuggestion {
  module: ModuleDef
  /** What it unlocks on THIS part, falling back to the module's own description. */
  unlocks: string
}

/**
 * The part's `suggests` (#638), resolved + de-duped. A suggestion whose id isn't in
 * the modules catalog is DROPPED — the same rule the docked pane uses, for the same
 * reason: a typo'd id can only render a row promising something Snakie can't deliver.
 */
export function resolveSuggestedModules(part: PartDefinition): PartSuggestion[] {
  const seen = new Set<string>()
  const out: PartSuggestion[] = []
  for (const s of part.suggests ?? []) {
    const def = moduleById(text(s?.module) ?? '')
    if (!def || seen.has(def.id)) continue
    seen.add(def.id)
    out.push({ module: def, unlocks: text(s.unlocks) ?? def.description })
  }
  return out
}

// --- Help ------------------------------------------------------------------

/** The part's bundled help (#207), front matter parsed off. `null` when the part
 *  ships no help document at all. */
export function partHelpDoc(part: PartDefinition): PartHelpMeta | null {
  const raw = text(part.helpText)
  return raw ? parsePartHelp(raw) : null
}

/** The help PROSE to render — front matter stripped. `''` for a part with no help,
 *  and for a help file that is nothing but front matter (a guide link is a link,
 *  not an article: rendering it would leave an empty panel under a heading). */
export function partHelpBody(part: PartDefinition): string {
  return partHelpDoc(part)?.body.trim() ?? ''
}

// --- 3-D mesh --------------------------------------------------------------

/** A part's 3-D model, resolved to something the mesh loader can actually open. */
export interface PartMeshRef {
  /** Absolute path with POSIX separators (node accepts those on Windows too). */
  path: string
  kind: 'stl' | 'dae'
}

/**
 * Resolve a part's `mesh` to an absolute path inside its own part folder, or `null`
 * when there is nothing to show. `null` covers, deliberately, every case where a
 * 3-D tab would open onto a failure:
 *
 *  - the part declares no mesh;
 *  - the file is a kind the loader can't parse (`.obj`, `.glb`);
 *  - there is no parts folder — the WEB build has no filesystem and reports `''`;
 *  - the reference escapes the part's own folder (absolute, or via `..`). `mesh` is
 *    documented as a relative filename WITHIN the part folder, and a part is
 *    community-authored data: `mesh: ../../../../secrets` must resolve to nothing
 *    rather than to a file read.
 */
export function partMeshRef(
  part: PartDefinition,
  opts: { partsFolder: string; libraryId: string }
): PartMeshRef | null {
  const ref = text(part.mesh)
  if (!ref) return null
  const kind = meshKind(ref)
  if (!kind) return null
  const folder = text(opts.partsFolder)
  const libraryId = text(opts.libraryId)
  const partId = text(part.id)
  if (!folder || !libraryId || !partId) return null
  const baseDir = resolveMeshPath(`${folder}/${libraryId}/${partId}`, '.')
  // Covers absolute refs and `..` escapes in one check — the same rule the Robot
  // View uses to decide a mesh has left the project it belongs to.
  if (isExternalMeshRef(ref, baseDir)) return null
  return { path: resolveMeshPath(baseDir, ref), kind }
}

// --- What the view renders -------------------------------------------------

/** The stage's preview modes, in tab order. */
export type PartPreviewMode = 'board' | 'schematic' | 'model'

/**
 * Which previews the part can offer. Board + schematic always (both are derived
 * from the pins, so every part has one); the 3-D model only when its mesh resolved
 * — the issue's "absent when it doesn't [have one], rather than an empty frame".
 */
export function partPreviewModes(hasMesh: boolean): PartPreviewMode[] {
  return hasMesh ? ['board', 'schematic', 'model'] : ['board', 'schematic']
}

/** A panel of the details page. */
export type PartDetailSection = 'specs' | 'tags' | 'drivers' | 'works-with' | 'links' | 'help'

/** Which panels have something to say for this part, in page order. Anything not
 *  listed renders nothing at all, rather than an empty heading. */
export function partDetailSections(part: PartDefinition): PartDetailSection[] {
  const out: PartDetailSection[] = []
  if (partSpecRows(part).length > 0) out.push('specs')
  if (partTagList(part).length > 0) out.push('tags')
  if (partDriverRows(part).length > 0 || partCodeModule(part)) out.push('drivers')
  if (resolveSuggestedModules(part).length > 0) out.push('works-with')
  if (partDocLinks(part).length > 0) out.push('links')
  if (partHelpBody(part)) out.push('help')
  return out
}

// --- The pinout readout (#934) ----------------------------------------------

/** One pad, said in words. */
export interface PinoutReading {
  /** The silk name, e.g. `GP4` — always present, it is the pin's primary label. */
  name: string
  /** `Pin 6`, or null where the part prints no number. */
  number: string | null
  /** The electrical role in the reader's words, e.g. `Ground`. */
  role: string
  /** One phrase per capability, e.g. `I2C0 SDA`, `PWM 2A`, `ADC0`. */
  functions: string[]
}

const PIN_ROLE: Record<PartPinType, string> = {
  pwr: 'Power',
  gnd: 'Ground',
  io: 'I/O',
  other: 'Other'
}

/**
 * What a pad does, for the hover readout.
 *
 * The board already draws every pin's capability chips, so this is not there to
 * repeat them — it is there because a 40-pin Pico draws eighty chips at once and
 * the question is always about ONE pad. Hovering says which.
 *
 * A capability with a bus number is named with it (`I2C0 SDA`, not `I2C SDA`),
 * because "which I2C" is the thing that decides whether two devices can share a
 * bus, and it is the part of the answer a pinout diagram usually makes you count
 * across the board to find. Every such number is one the PART author wrote down;
 * none is inferred here — with the single, chip-gated exception below.
 *
 * `mcu` is the part's chip, and it buys exactly one thing: the PWM SLICE. On an
 * RP2040/RP2350 the slice is fixed by the GPIO number and it is the fact that
 * matters (two pads on one slice cannot run different duty cycles), so it is
 * worth deriving. It is derived for NO other chip: an ESP32 routes PWM through a
 * matrix and an nRF52 through four instances, and "PWM 2A" on either would be a
 * number this function made up. Given no chip, nothing is derived.
 */
export function pinoutReading(pin: PartPin, mcu?: string): PinoutReading {
  // The two families whose slice mapping is fixed by the GPIO number.
  const slices = /^rp2[0-9]{3}$/i.test((mcu ?? '').trim())
  const caps = pin.type === 'io' ? (pin.capabilities ?? []) : []
  const functions: string[] = []
  for (const c of caps) {
    switch (c) {
      case 'i2c':
      case 'spi':
      case 'uart': {
        const bus = pin.buses?.[c]
        const sig = pin.signals?.[c]
        const name = `${c.toUpperCase()}${bus != null ? bus : ''}`
        functions.push(sig ? `${name} ${sig}` : name)
        break
      }
      case 'pwm': {
        // The channel alone is still worth saying — `PWM B` tells you which half
        // of a slice the pad is, which is the half that collides.
        const sig = pin.signals?.pwm
        // RP2040/RP2350: slice = (gpio / 2) mod 8, per the datasheet's PWM table.
        const slice = slices && pin.gpio != null ? Math.floor((pin.gpio % 16) / 2) : null
        functions.push(slice != null && sig ? `PWM ${slice}${sig}` : sig ? `PWM ${sig}` : 'PWM')
        break
      }
      case 'adc': {
        const ch = pin.buses?.adc
        functions.push(ch != null ? `ADC${ch}` : 'ADC')
        break
      }
      default:
        functions.push(c.toUpperCase())
    }
  }
  return {
    name: pin.label || pin.name,
    number: pin.number != null ? `Pin ${pin.number}` : null,
    role: PIN_ROLE[pin.type] ?? 'Other',
    functions
  }
}
