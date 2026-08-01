/**
 * Shared **Part** definition types — the data model for the Parts Library
 * (#129) and the Part Editor (#130).
 *
 * A {@link PartDefinition} is the portable, community-authored description of a
 * single hardware component (a microcontroller board, a sensor breakout, a
 * motor driver, …). It is the in-memory shape; on disk it is serialised to a
 * human-readable `parts.yml` (see `src/shared/part-yaml.ts`) inside the part's
 * own folder, alongside its image/footprint assets — modelled on Fusion 360's
 * electronics libraries (many libraries, each holding many parts).
 *
 * Kept dependency-free (no React/Node/Electron/yaml) so the renderer (the
 * editor + library panel), the preload (the `parts.*` DTOs) and the main
 * process (disk IO) can all import it. The YAML (de)serialisation lives in the
 * sibling `part-yaml.ts`; the pure registry/version logic in `part-registry.ts`.
 *
 * A Part is a **superset of a {@link BoardDefinition}** (the existing Board View
 * model): it adds a manufacturer/family/tags/package/voltage/part# header, a
 * physical board polygon + dimensions, mounting holes, buttons, per-pin physical
 * metadata (board pin number, castellated vs regular, IO capabilities) and a
 * schematic symbol. `partToBoardDefinition()` (in `part-editor.util.ts`) projects
 * a Part back onto a BoardDefinition so the Board View's renderer draws it for
 * free.
 */

/**
 * Electrical role of a pin. Mirrors the epic's wording (pwr / gnd / io) plus an
 * `other` escape hatch for non-GPIO signals (RUN, EN, ADC_VREF, …). Only `io`
 * pins carry {@link PartPinCapability | capabilities} and a `gpio` number.
 */
export type PartPinType = 'pwr' | 'gnd' | 'io' | 'other'

/**
 * What an `io` pin can do, per the Part Editor spec. A pin may have several
 * (e.g. a pin that is digital + pwm + adc). Authored as checkboxes in the editor.
 */
export type PartPinCapability = 'digital' | 'pwm' | 'adc' | 'spi' | 'i2c' | 'uart'

/**
 * The specific signal a capability pin carries, when the part designates one:
 *  - **i2c**  → `SDA` or `SCL`
 *  - **spi**  → `RX` (MISO) / `CSn` (chip-select) / `SCK` / `TX` (MOSI)
 *  - **uart** → `TX` or `RX`
 *  - **pwm**  → the `A` or `B` output channel
 * Only the entries matching the pin's {@link PartPin.capabilities} are meaningful;
 * authored via the per-capability dropdowns in the pin inspector.
 */
export interface PartPinSignals {
  i2c?: 'SDA' | 'SCL'
  spi?: 'RX' | 'CSn' | 'SCK' | 'TX'
  uart?: 'TX' | 'RX'
  pwm?: 'A' | 'B'
}

/**
 * The peripheral bus / instance number a capability pin belongs to, when the part
 * exposes more than one: i2c, spi and uart carry a bus id (e.g. `I2C0`, `SPI1`,
 * `UART0`) and adc carries its channel number (e.g. `ADC0`). Set per-capability
 * in the pin inspector alongside {@link PartPinSignals}.
 */
export interface PartPinBuses {
  i2c?: number
  spi?: number
  uart?: number
  adc?: number
}

/** How the part is mounted: through-hole vs surface-mount. */
export type PartPackage = 'THT' | 'SMD'

/**
 * How a pin/pad is drawn:
 *  - `square`     — a solid square SMD-style pad (default)
 *  - `round`      — a solid round pad
 *  - `castellated`— a castellated edge pad (the plated half-moon look)
 *  - `header`     — a through-hole header pad: a copper annular ring with the
 *                   drill hole showing (where pin headers are soldered)
 *  - `octagonal`  — an octagonal header pad with a SQUARE pin/hole, the classic
 *                   look of servo / DuPont-style 0.1" headers (Signal/V+/GND rows)
 *  - `smd`        — a surface-mount pad that does NOT pass through the board. The
 *                   only rectangular pad with no drill: `square` is a through-hole
 *                   pad that punches one. This is what a XIAO's underside array is.
 *  - `pogo`       — a sprung contact on a CARRIER that presses against a seated
 *                   board's pad rather than being soldered to it. The XIAO
 *                   Expansion Base reaches the XIAO's underside battery pads this
 *                   way. Drawn as a contact, not copper, because it isn't one.
 */
export type PartPinShape =
  | 'square'
  | 'round'
  | 'castellated'
  | 'header'
  | 'octagonal'
  | 'smd'
  | 'pogo'

/**
 * Every pad shape, in picker order. ONE list — the parts.yml parser and the Part
 * Editor's normaliser both validate against it. They used to keep their own
 * copies, which drifted: `octagonal` was missing from the parser's, so an
 * octagonal pad was silently downgraded on every save/load round-trip.
 */
export const PART_PIN_SHAPES: readonly PartPinShape[] = [
  'square',
  'round',
  'smd',
  'castellated',
  'header',
  'octagonal',
  'pogo'
]

/**
 * Does this pad go THROUGH the board? A castellated half-hole, a header ring, an
 * octagonal servo pad and a plain `square` all drill; `round` and `smd` sit on the
 * surface.
 *
 * It matters for the two-faced view (#636): a through pad is ONE pad you can see
 * (and solder) from either side, so it shows on both faces — mirrored on the rear,
 * like a mounting hole. A XIAO's 14 castellations are exactly this, which is why
 * its underside array needs no pins of its own; duplicating them as rear pads
 * would invent 14 nets the board doesn't have.
 */
export function padPassesThrough(shape?: PartPinShape): boolean {
  const sh = shape ?? 'square'
  return sh === 'square' || sh === 'castellated' || sh === 'header' || sh === 'octagonal'
}

/** Validate a pad `shape` off untrusted YAML/JSON (unknown ⇒ undefined). */
export function coercePinShape(v: unknown): PartPinShape | undefined {
  return PART_PIN_SHAPES.includes(v as PartPinShape) ? (v as PartPinShape) : undefined
}

/** Which edge of the board outline a pin/header sits on. */
export type PartEdge = 'left' | 'right' | 'top' | 'bottom'

/** One physical pin/pad on the part. */
export interface PartPin {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Paint/click z-order in the single item hierarchy (higher = on top).
   *  Absent ⇒ the legacy per-kind default. */
  z?: number
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  /** Physical board pin number (1-based silk numbering), if the part prints one. */
  number?: number
  /** GPIO number this pin breaks out — matched against `Pin(n)` when rendered. */
  gpio?: number
  /** GPIO / signal name (e.g. `"GP0"`, `"SDA"`, `"VBUS"`). The primary label. */
  name: string
  /** Optional alternate silk text, when the printed label differs from `name`. */
  label?: string
  /** Electrical role (pwr / gnd / io / other). */
  type: PartPinType
  /** For `io` pins: what the pin supports. Ignored for non-io pins. */
  capabilities?: PartPinCapability[]
  /** Per-capability signal designation (e.g. i2c → SDA/SCL, spi → SCK). Only the
   *  entries for the pin's {@link capabilities} apply. */
  signals?: PartPinSignals
  /** Per-capability bus / instance / channel number (e.g. I2C0, SPI1, ADC2). */
  buses?: PartPinBuses
  /** Manual offset for this pin's label annotation (number box + label + chips),
   *  as a fraction of the board box (dragged in the Part Editor). Absent ⇒ the
   *  default position at the board edge. Lets labels be hand-placed off the board. */
  labelOffset?: { x: number; y: number }
  /**
   * Whether this pad is a castellated edge pad. Legacy flag — superseded by
   * {@link shape}` === 'castellated'`; still read for backward compatibility.
   */
  castellated?: boolean
  /** How the pad is drawn (square / round / castellated / header / octagonal). */
  shape?: PartPinShape
  /** Suppress this pin's silk annotation (number box + label + capability chips)
   *  while keeping the pad + its electrical role. Used for the repeated V+/GND pins
   *  of a servo/DuPont header block, where labelling every one is noise — only the
   *  signal pins are labelled and the power/ground rows read from a shared legend. */
  labelHidden?: boolean
  /** Group id tying this pin to the others of one servo/DuPont **header block** (its
   *  Signal/V+/GND trio). Pins sharing a `group` move + delete as a unit and collapse
   *  to one row in the pin list. Absent ⇒ a standalone pin. */
  group?: string
  /** Imprinted from a carrier MOUNT's footprint (#166): the {@link PartMount.id}
   *  this pin was stamped from. Such pins are the footprint's actual pads (correct
   *  type + position), copied from a reference board — read-only + moving rigidly
   *  with their mount block. They give the carrier real, wireable pins to bond a
   *  seated board onto, instead of an abstract socket. Absent ⇒ an authored pin. */
  derived?: string
  /**
   * Castellation outward direction in degrees: 0 = right, 90 = down, 180 = left,
   * 270 = up. Absent ⇒ derived from the pin's side (left/right by x). Only affects
   * `castellated` pads — the rotate/flip controls in the pin inspector set it.
   */
  rotation?: number
  /**
   * Absolute position on the board canvas, normalised `0..1` (0,0 = top-left).
   * The Part Editor uses **free placement**: this is the source of truth for
   * where the pad is drawn. Legacy parts authored as edge-based headers (with no
   * position) are migrated to a position derived from their edge + order on load.
   */
  x?: number
  y?: number
}

/** A run of pins laid evenly along one edge of the board, in array order. */
export interface PartHeader {
  /** Which edge the pins sit on (left/right ⇒ vertical, top/bottom ⇒ horizontal). */
  edge: PartEdge
  /** The pins, spaced evenly from the start of the edge to its end. */
  pins: PartPin[]
}

/**
 * The physical family of a connector housing. Each kind has its own pitch, shell
 * colour and keying, so a board's sockets read as the real thing:
 *  - `qwiic`  — QWIIC / STEMMA QT: a 4-pin JST-SH 1.0 mm I2C socket (black shell)
 *  - `jst`    — a generic JST-PH 2.0 mm header
 *  - `grove`  — Seeed's 4-pin 2.0 mm keyed socket (white shell). Its {@link
 *               PartConnector.variant} says which of the four standard signal
 *               sets the port carries.
 *  - `dupont` — a 0.1" (2.54 mm) male header block a DuPont / servo lead pushes
 *               onto. **Oriented**: contact 1 is the marked end, so a 3-way servo
 *               block reads Signal · V+ · GND in a fixed order and a lead plugged
 *               the wrong way round is a mistake we can show rather than allow.
 */
export type PartConnectorKind = 'qwiic' | 'jst' | 'grove' | 'dupont' | 'terminal'

/** Every connector kind, in picker order (the first is the default). */
export const PART_CONNECTOR_KINDS: readonly PartConnectorKind[] = [
  'qwiic',
  'jst',
  'grove',
  'dupont',
  'terminal'
]

/** Terminal counts a screw-terminal block is allowed to have (#662). Two is the
 *  smallest block sold; the upper bound just stops a slip in the number field
 *  generating hundreds of contacts. */
export const TERMINAL_MIN = 2
export const TERMINAL_MAX = 24

/**
 * Which standard signal set a **Grove** socket carries. Grove ports are all the
 * same 4-pin housing wired four different ways — the silk on a Seeed board says
 * which — so the variant drives the default label and contact names:
 *  - `i2c`     — SCL · SDA · VCC · GND
 *  - `uart`    — RX · TX · VCC · GND
 *  - `digital` — D(n) · D(n+1) · VCC · GND
 *  - `analog`  — A(n) · A(n+1) · VCC · GND
 */
export type GroveVariant = 'i2c' | 'uart' | 'digital' | 'analog'

/**
 * Which **JST family** a `jst` connector is (#668). They are the same idea in a
 * range of pitches, and the pitch is what decides whether a lead physically fits:
 * a PH plug will not enter an XH socket. Naming the family is therefore what lets
 * the board draw the housing life-size AND refuse a lead that couldn't seat.
 *
 *  - `sh` 1.00 mm — the QWIIC / STEMMA QT housing
 *  - `gh` 1.25 mm — common on LiPo/battery leads
 *  - `zh` 1.50 mm
 *  - `ph` 2.00 mm — the classic hobby battery/JST lead (the default)
 *  - `xh` 2.50 mm — balance leads, bigger battery packs
 *  - `vh` 3.96 mm — high current
 */
export type JstFamily = 'sh' | 'gh' | 'zh' | 'ph' | 'xh' | 'vh'

/** Every JST family, in picker order. */
export const JST_FAMILIES: readonly JstFamily[] = ['sh', 'gh', 'zh', 'ph', 'xh', 'vh']

/**
 * The flavour of a connector's housing. One field rather than a per-kind pile of
 * near-identical ones: `variant` has always meant "which flavour of this
 * housing", and Grove's wiring and JST's pitch are the same question asked of
 * different kinds. Validated PER KIND — see {@link coerceConnectorVariant}.
 */
export type ConnectorVariant = GroveVariant | JstFamily

/** Every Grove variant, in picker order (the first is the default). */
export const GROVE_VARIANTS: readonly GroveVariant[] = ['i2c', 'uart', 'digital', 'analog']

/** Validate a connector `kind` off untrusted YAML/JSON. Both the parts.yml parser
 *  and the Part Editor's normaliser go through here, so adding a kind above is the
 *  only edit needed — neither whitelist can silently downgrade it to `qwiic`. */
export function coerceConnectorKind(v: unknown): PartConnectorKind {
  return PART_CONNECTOR_KINDS.includes(v as PartConnectorKind) ? (v as PartConnectorKind) : 'qwiic'
}

/** Validate a Grove `variant` off untrusted YAML/JSON (absent/unknown ⇒ undefined). */
export function coerceGroveVariant(v: unknown): GroveVariant | undefined {
  return GROVE_VARIANTS.includes(v as GroveVariant) ? (v as GroveVariant) : undefined
}

/** Validate a JST `variant` off untrusted YAML/JSON (absent/unknown ⇒ undefined). */
export function coerceJstFamily(v: unknown): JstFamily | undefined {
  return JST_FAMILIES.includes(v as JstFamily) ? (v as JstFamily) : undefined
}

/**
 * Validate a connector `variant` for the kind that carries it. A variant only
 * means something on `grove` and `jst`; anything else drops it rather than
 * carrying a value no renderer reads.
 */
export function coerceConnectorVariant(
  kind: PartConnectorKind,
  v: unknown
): ConnectorVariant | undefined {
  if (kind === 'grove') return coerceGroveVariant(v)
  if (kind === 'jst') return coerceJstFamily(v)
  return undefined
}

/**
 * Validate a {@link GroupHousing} off untrusted YAML / editor state (#673).
 *
 * ONE coercer, called by both `parts.yml` and the editor's normaliser — the pair
 * that has drifted before and silently dropped fields on save.
 */
export function coerceGroupHousing(raw: unknown): GroupHousing | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const x = Number(r.x)
  const y = Number(r.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const kind = coerceConnectorKind(r.kind)
  const out: GroupHousing = {
    kind,
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  }
  const variant = coerceConnectorVariant(kind, r.variant)
  if (variant) out.variant = variant
  const rot = Number(r.rotation)
  if (Number.isFinite(rot)) {
    const q = (((Math.round(rot / 90) * 90) % 360) + 360) % 360
    if (q) out.rotation = q
  }
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  if (label) out.label = label
  return out
}

/**
 * A physical connector on the board drawn as a placed body — e.g. a **QWIIC** /
 * **STEMMA QT** 4-pin JST-SH I2C socket, a **Grove** port, a **DuPont** / servo
 * header block, or a generic **jst** header. Its {@link pins} are full
 * {@link PartPin}s, so a QWIIC's SDA/SCL carry a GPIO + `i2c`
 * capability/signal/bus just like any other pin, alongside 3V3 / GND.
 *
 * **Contact order is the orientation.** `pins[0]` is contact 1 — the end the
 * housing's key/pin-1 marker sits at — so a cable can be seated the right way
 * round rather than merely joined pin-to-pin.
 */
export interface PartConnector {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Group id — items sharing it form a group and move/rotate/delete as one
   *  rigid unit (#627). A group may mix kinds: a Grove connector and its contacts
   *  belong together, so they travel together. */
  group?: string
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  /** Paint/click z-order among components (higher = on top). Absent ⇒ legacy
   *  category default; set explicitly when reordered in the Layers panel. */
  z?: number
  /** The connector family — see {@link PartConnectorKind}. */
  kind: PartConnectorKind
  /** For `grove`: which signal set the port carries. Ignored by other kinds. */
  variant?: ConnectorVariant
  /** Silk label (defaults to the kind's name — `"QWIIC"` / `"GROVE"` / …). */
  label?: string
  /** Normalised 0..1 position of the connector body within the outline. */
  x: number
  y: number
  /** The connector's contacts, in order — full pins (GND/3V3/SDA/SCL for QWIIC). */
  pins: PartPin[]
  /** Manual label placement — a fraction of the board box, set by dragging the
   *  connector's silk label in the Part Editor. Absent ⇒ default (below the body). */
  labelOffset?: { x: number; y: number }
  /** Silk-label rotation in degrees (0/90/180/270); e.g. 270 to read bottom-to-top. */
  labelRotation?: number
  /** Body rotation in degrees (0/90/180/270) — turns the connector body, its pins
   *  and its silk label together. */
  rotation?: number
}

/**
 * A socket on a **carrier** board that another board plugs into — the female
 * header block on a XIAO expansion base, or the Pico socket on a Pico Explorer.
 *
 * Mating is by **footprint name**, not geometry: the mount accepts any part whose
 * {@link PartDefinition.footprint} equals this {@link footprint}, so a XIAO RP2350
 * and a XIAO RP2040 both seat in a XIAO carrier without either part knowing about
 * the other. Once seated, the two boards' **same-named pins are bonded** — the
 * seated board's `D4` *is* the carrier's `D4` — which is what lets a Grove port on
 * the carrier resolve to a GPIO on the MCU above it. Carriers that rename pins can
 * override individual bonds with {@link pinMap}.
 */
export interface PartMount {
  /** Unique id within this part; a placed instance references it as `mount`. */
  id: string
  /** The footprint family this socket accepts (e.g. `xiao`, `pico`). A label/handle
   *  only — actual dock compatibility is STRUCTURAL (the imprinted pins' signature),
   *  so a board whose pins match this mount's can seat even without the same tag. */
  footprint: string
  /** The reference board this footprint was imprinted from (#166), for the editor's
   *  "re-sync from source". The imprinted pins live in the carrier's headers, flagged
   *  {@link PartPin.derived} = this mount's {@link id}. */
  ref?: { lib: string; part: string }
  /** Normalised 0..1 centre of the SEATED board within this board's outline. */
  x: number
  y: number
  /** Rotation of the seated board, in degrees (0/90/180/270). */
  rotation?: number
  /** Optional silk label for the socket (e.g. `XIAO`). */
  label?: string
  /** Bond overrides for a carrier whose own pin names differ from the seated
   *  board's: seated pin name → this board's pin name. Anything not listed still
   *  bonds by matching name. */
  pinMap?: Record<string, string>
}

/**
 * The rear face's artwork (#636). Only the picture lives here — the pins, pads,
 * connectors and components that are ON the rear are ordinary items carrying
 * `side: rear`, so there is ONE list of each kind rather than two parallel
 * schemas to keep in step (and one set of whitelists, one set of layer rows, one
 * selection model).
 *
 * The rear shares the front's `dimensions`: it's the same board.
 */
export interface PartRear {
  /** Relative filename of the rear photo, alongside `parts.yml`. */
  image?: string
  /** Runtime-only inlined data URL, exactly like {@link PartDefinition.imageData}
   *  — read by the main process, never written back to `parts.yml`. */
  imageData?: string
  /** Where the rear photo sits on the board canvas, normalised 0..1. */
  imageLayer?: ImageLayer
}

/** A mounting hole, positioned in normalised 0..1 coords within the outline. */
export interface MountingHole {
  /** Paint/click z-order in the single item hierarchy (higher = on top).
   *  Absent ⇒ the legacy per-kind default. */
  z?: number
  /** Group id — items sharing it form a group and move/rotate/delete as one
   *  rigid unit (#627). A group may mix kinds: a Grove connector and its contacts
   *  belong together, so they travel together. */
  group?: string
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  /** Normalised X within the board outline (0 = left edge, 1 = right edge). */
  x: number
  /** Normalised Y within the board outline (0 = top edge, 1 = bottom edge). */
  y: number
  /** Hole diameter in millimetres (e.g. `2.0` for M2, `3.0` for M3). */
  diameter: number
}

/** A push-button on the board, positioned in normalised 0..1 coords. */
export interface PartButton {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Group id — items sharing it form a group and move/rotate/delete as one
   *  rigid unit (#627). A group may mix kinds: a Grove connector and its contacts
   *  belong together, so they travel together. */
  group?: string
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  /** Paint/click z-order among components (higher = on top). Absent ⇒ legacy
   *  category default; set explicitly when reordered in the Layers panel. */
  z?: number
  /** Silk label (e.g. `"BOOT"`, `"RESET"`, `"USR"`). */
  label: string
  /** Normalised X within the board outline. */
  x: number
  /** Normalised Y within the board outline. */
  y: number
}

/**
 * An onboard indicator LED tied to GPIO(s), drawn on the board:
 *  - `single`   — one LED on a single GPIO (e.g. the Pico's onboard LED on GP25).
 *  - `rgb`      — an analog RGB LED whose R/G/B channels are on three GPIOs (e.g.
 *                 the Pimoroni Tiny 2350's RGB on GP18/19/20).
 *  - `neopixel` — an addressable WS2812/SK6812 pixel driven over a single DATA
 *                 line ({@link gpio}); some boards gate its supply with a
 *                 power-enable GPIO ({@link power}, e.g. the Seeed XIAO RP2350's
 *                 DATA GP22 + POWER GP23). The power pin is optional.
 *  - `power`    — a supply indicator, sitting across the part's own power rail.
 *                 The odd one out: nothing DRIVES it, so it has no GPIO, and the
 *                 Board View lights it from the solved supply instead (#698).
 *
 * `power` is a declared kind rather than something inferred from a missing GPIO,
 * because the bundled library proves that inference wrong: `grove-led-bar` has ten
 * GPIO-less `single` LEDs driven by the bar's own chip, and the XIAO RP2350 has one
 * that is really its user LED. Only the author knows which LED is the indicator.
 */
export interface OnboardLed {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Group id — items sharing it form a group and move/rotate/delete as one
   *  rigid unit (#627). A group may mix kinds: a Grove connector and its contacts
   *  belong together, so they travel together. */
  group?: string
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  /** Paint/click z-order among components (higher = on top). Absent ⇒ legacy
   *  category default; set explicitly when reordered in the Layers panel. */
  z?: number
  kind: 'single' | 'rgb' | 'neopixel' | 'power'
  /** Silk label (defaults to `"LED"` / `"RGB"` / `"NeoPixel"` / `"PWR"`). */
  label?: string
  /** GPIO driving a `single` LED, or the DATA line of a `neopixel`. */
  gpio?: number
  /** Optional power-enable GPIO for a `neopixel` (drive high to power it). */
  power?: number
  /** R/G/B channel GPIOs for an `rgb` LED. */
  rgb?: { r?: number; g?: number; b?: number }
  /** Body colour for a `single` LED (any CSS colour; default green). */
  color?: string
  /** Normalised 0..1 position within the board outline. */
  x: number
  y: number
  /** Physical footprint of the LED package in mm (square). Scales the glyph to the
   *  board's real size (e.g. a 1.5mm pixel). Absent ⇒ legacy fixed on-screen size. */
  sizeMm?: number
  /** Manual label placement — a fraction of the board box, set by dragging the
   *  LED's silk label in the Part Editor. Absent ⇒ default (below the body). */
  labelOffset?: { x: number; y: number }
  /** Silk-label rotation in degrees (0/90/180/270). */
  labelRotation?: number
}

/** A vertex of the physical board outline, in normalised 0..1 coords. */
export interface PolygonPoint {
  x: number
  y: number
}

/** The board outline kind. `rect` (default) uses the dimensions/aspect; `polygon`
 *  uses the {@link PartDefinition.polygon} points (so any shape can be authored). */
export type BoardShapeKind = 'rect' | 'polygon'

/** The board's outline shape. Absent ⇒ a plain rounded rectangle. */
export interface PartShape {
  kind: BoardShapeKind
  /** Corner radius for `rect`, normalised to the smaller board side (0..0.5). */
  cornerRadius?: number
}

/**
 * The board photo placed as its OWN layer on the canvas (not stretched to fit the
 * outline). Position/size are normalised `0..1` relative to the board box, so the
 * image stays put when the canvas resizes. The pixels live in
 * {@link PartDefinition.image} / `imageData`; this is just the placement.
 */
export interface ImageLayer {
  x: number
  y: number
  w: number
  h: number
  /** 0..1 layer opacity (default 1). */
  opacity?: number
  /** Rotation in degrees (default 0). */
  rotation?: number
}

/** The kind of a component shape drawn on the board. */
export type ComponentShapeKind = 'rect' | 'circle' | 'polygon'

/**
 * A component drawn on the board as a coloured shape — a rectangle, circle or
 * polygon (for irregular parts). Positions/sizes are normalised `0..1`; the
 * colours are author-controlled (fill, outline, outline width). This is the
 * "components" layer the Part Editor authors via the toolbar's Shapes dropdown.
 */
export interface ComponentShape {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  kind: ComponentShapeKind
  /** Group id — items sharing it form a group (move/rotate/delete together, #627). */
  group?: string
  /** Optional label drawn centred on the shape. */
  label?: string
  /** Fill colour (any CSS colour). */
  fill?: string
  /** Outline colour. */
  stroke?: string
  /** Outline width in canvas (viewBox) units. */
  strokeWidth?: number
  /** Top-left (rect) / centre (circle) / bounding ref (polygon), normalised. */
  x: number
  y: number
  /** Rectangle size (normalised), when `kind === 'rect'`. */
  w?: number
  h?: number
  /** Circle radius as a fraction of the board width, when `kind === 'circle'`. */
  r?: number
  /** Polygon vertices (normalised), when `kind === 'polygon'`. */
  points?: PolygonPoint[]
  /** Draw order within the Components layer; higher = drawn later (on top of
   *  lower-z shapes AND labels). Absent ⇒ legacy order (its array index, below
   *  labels). Lets components be stacked from the editor's Components list. */
  z?: number
  /** Clockwise rotation in degrees (0/90/180/270), about the shape's centre. */
  rotation?: number
  /** Rectangle corner radius in canvas (viewBox) units; `0` = sharp corners.
   *  Absent ⇒ the legacy default (3). Only meaningful when `kind === 'rect'`. */
  cornerRadius?: number
  /** Styling for the shape's `label` caption (font size in viewBox units, weight,
   *  slant, underline, alignment, and whether it wraps to the shape's width). */
  labelFontSize?: number
  labelBold?: boolean
  labelItalic?: boolean
  labelUnderline?: boolean
  labelAlign?: TextAlign
  labelWrap?: boolean
  /** Colour of the shape's `label` caption (any CSS colour). */
  labelColor?: string
}

/** Horizontal text alignment for labels. */
export type TextAlign = 'left' | 'center' | 'right'

/** A free-floating text label placed on the board canvas (normalised 0..1). */
export interface PartLabel {
  /** Which face of the board this sits on (#636). Absent ⇒ front. */
  side?: PartSide
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  text: string
  x: number
  y: number
  /** Group id — items sharing it form a group (move/rotate/delete together, #627). */
  group?: string
  /** Font size in SVG user units (the canvas viewBox is ~420 wide). */
  fontSize?: number
  /** Draw order within the Components layer (see {@link ComponentShape.z}). */
  z?: number
  /** Clockwise rotation in degrees (0/90/180/270), about the label's position. */
  rotation?: number
  /** Inline text styling. */
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** Horizontal alignment (multi-line); default `center`. */
  align?: TextAlign
  /** Text colour (any CSS colour); defaults to the theme text colour. */
  color?: string
}

/**
 * A decorative on-board component (chip/can/connector) drawn as a labelled
 * rounded rect — same concept as the Board View's `BoardFeature`.
 */
export interface PartFeature {
  /** Silk text drawn on the feature (e.g. `"RP2350"`, `"USB-C"`). */
  label: string
  /** Visual style. */
  kind: 'mcu' | 'wifi' | 'usb' | 'chip' | 'led'
  /** Normalised 0..1 position/size WITHIN the board outline (x,y = top-left). */
  x: number
  y: number
  w: number
  h: number
}

/** One pin of the schematic symbol (a line-drawing terminal + its pad link). */
export interface SchematicPin {
  /** Which physical pin this terminal maps to (by `name`). The pad ↔ pin link. */
  pin: string
  /** Which side of the symbol box this terminal sticks out of. */
  side: PartEdge
  /** Order along that side (0-based, top→bottom / left→right). */
  order: number
}

/** An optional schematic symbol: a simple labelled box with pin terminals. */
export interface PartSchematic {
  /** Symbol box aspect (w/h); defaults sensibly when absent. */
  aspect?: number
  /** The terminals, each linked to a physical pin by name. */
  pins: SchematicPin[]
}

/**
 * The behavioural model a part uses in the Circuit Sim DC solver (epic #597).
 * `passive` (default when absent) means the part has no electrical behaviour of
 * its own — a mechanical/decorative part, or one whose pins just pass through.
 */
export type ElectricalModel =
  | 'source' //   supplies a voltage (battery pack, bench PSU, a wall adapter)
  | 'resistor' // fixed resistance between two pins
  | 'led' //      light-emitting diode (forward-voltage drop + current → brightness)
  | 'diode' //    plain diode (forward-voltage drop, one-way)
  | 'switch' //   button / switch (open or closed between two pins)
  | 'consumer' // a current sink with a typical + stall draw (servo, motor, sensor)
  | 'potentiometer' // a 3-pin variable divider: track VCC↔GND, a draggable wiper tap
  | 'regulator' // an on-board LDO/buck: input rail in, a fixed regulated rail out
  | 'passive' //  no electrical model (wires-through / mechanical / decorative)

/**
 * Electrical metadata for a part (epic #597, issue #600) — the parameters the
 * netlist/ERC/solver read to give a part real behaviour. Every field is optional
 * so a part declares only what its {@link model} needs; the block is authored in
 * `parts.yml` alongside the geometry and round-trips like the rest of the sidecar.
 *
 * Units are explicit in the field names (volts, ohms, amps, milliamp-hours) so a
 * hand-authored file is unambiguous. Sized up-front (sources + consumers) so the
 * power-input parts (#602) and consequence engine (#607) don't need re-authoring.
 */
export interface PartElectrical {
  /** The behavioural model (defaults to `passive` when absent). */
  model: ElectricalModel
  /** Forward voltage drop in **volts** — `led` / `diode`. */
  vf?: number
  /** Fixed resistance in **ohms** — `resistor`, a `source`'s internal resistance, or
   *  a `potentiometer`'s full track resistance. */
  resistanceOhms?: number
  /** The wiper pin NAME of a `potentiometer` (the divider tap between the two
   *  terminals). Its 0..1 position is interactive state, not part metadata. */
  wiper?: string
  /** Nominal supply voltage in **volts** — `source` (a battery's nominal, a PSU's
   *  default set-point). */
  supplyV?: number
  /** Adjustable supply range `[min, max]` in **volts** — an adjustable `source`
   *  (bench PSU). Absent ⇒ a fixed supply at {@link supplyV}. */
  supplyRange?: [number, number]
  /** Rated maximum current in **amps** before the part is damaged — the threshold
   *  the consequence engine (#607) trips "magic smoke" at. */
  maxCurrentA?: number
  /** Battery capacity in **milliamp-hours** — a `source` battery; feeds the
   *  battery-life estimate (#607). */
  capacityMah?: number
  /**
   * The supply range this part is DESIGNED to run at, `[min, max]` volts (#687).
   *
   * Deliberately not {@link supplyRange}, which means "the range an adjustable
   * SOURCE can be set to" — the opposite direction. This is what the part needs
   * FROM a supply, so the ERC can say a 3.3 V-only breakout is sitting on a 5 V
   * rail. Without it the sim knows a servo draws 100 mA and has no idea it wants
   * 4.8–6 V, which is the commonest way to destroy a part.
   *
   * The free-text {@link PartDefinition.voltage} stays as the human description
   * ("2.3–5.5V"); this is the machine-readable pair. Absent ⇒ no check.
   */
  operatingV?: [number, number]
  /** Typical steady current draw in **amps** — a `consumer` (a sensor's quiescent
   *  draw, a servo's idle). */
  currentDrawA?: number
  /** Peak / stall current draw in **amps** — a `consumer` under load (a servo
   *  stalled, a motor started); the worst-case figure for the power budget (#607). */
  stallCurrentA?: number
  /** The pin NAMES that carry the part's terminals, so the solver knows which pad
   *  is which without guessing. `positive`/`negative` for a 2-terminal source or
   *  passive; absent ⇒ inferred from pin roles (pwr/gnd). */
  terminals?: { positive?: string; negative?: string }
  /** The rail LABEL a `regulator` draws from (e.g. `VBUS`, `VSYS`, `VIN`) — the
   *  netlist bonds a board's like-named power pads into one rail, so this names the
   *  whole input net. The regulator only regulates when this rail is powered. */
  inputRail?: string
  /** The rail LABEL a `regulator` drives (e.g. `3V3`) — held at {@link outputV}
   *  relative to ground, with the load current pulled back from {@link inputRail}
   *  (so a board's on-board regulator makes its 3V3 pins actually source current). */
  outputRail?: string
  /** The regulated output voltage in **volts** — a `regulator` (e.g. `3.3`). */
  outputV?: number
  /** Dropout in **volts** — a `regulator` needs `input ≥ outputV + dropoutV` to
   *  hold regulation (informational for now; the consequence engine #607 uses it). */
  dropoutV?: number
}

/**
 * A group of items in the Part Editor (#627). Items reference it by their `group`
 * id; this registry names it and records nesting via {@link parent} (a group whose
 * `parent` is another group's id is nested inside it). A group can therefore hold
 * both loose items (their `group` = this id) and sub-groups (their `parent` = this id).
 */
/**
 * The flags every item in the Part Editor's single layer hierarchy carries.
 *
 * Pins, mounting holes, shapes, labels, buttons, LEDs and connectors are all
 * *items*: each can sit in a group (mixing kinds freely — a Grove connector and
 * its contacts belong together), and each can be hidden or locked on its own.
 */
export interface PartItemFlags {
  group?: string
  hidden?: boolean
  locked?: boolean
  side?: PartSide
}

/**
 * Which face of the board something is on (#636). Absent ⇒ `front`, so every
 * part authored before rear support is a front-only board and reads unchanged.
 *
 * Mounting holes deliberately carry NO side: a hole goes through the board, so
 * it belongs to both faces — it's just MIRRORED when the rear is shown, which is
 * how it looks when you physically turn the board over.
 */
export type PartSide = 'front' | 'rear'

/** Every side, in flip order. */
export const PART_SIDES: readonly PartSide[] = ['front', 'rear']

/** Validate a `side` off untrusted YAML/JSON. Anything unrecognised is front. */
export function coerceSide(v: unknown): PartSide | undefined {
  return v === 'rear' ? 'rear' : undefined
}

/** The side an item sits on — the default made explicit. */
export function itemSide(item: PartItemFlags): PartSide {
  return item.side === 'rear' ? 'rear' : 'front'
}

/**
 * Whether a part has a rear worth showing — either rear artwork, or at least one
 * item placed on the rear. Drives the flip control: hidden in the Parts Library
 * for a single-sided part, always available while authoring one.
 */
/**
 * Is there a rear PHOTO to show — as opposed to merely a rear face?
 *
 * Distinct from {@link partHasRear} on purpose. That is true for a board with
 * rear pins and no picture, which is right for offering a flip in the EDITOR
 * (you have to get to the back to author it) and wrong for the catalogue's
 * hover-flip, where turning the board over would reveal a blank face and read as
 * the image failing to load.
 */
export function partHasRearImage(part: PartDefinition): boolean {
  return !!(part.rear?.imageData || part.rear?.image)
}

export function partHasRear(part: PartDefinition): boolean {
  if (part.rear?.image || part.rear?.imageData) return true
  const onRear = (xs: PartItemFlags[] | undefined): boolean => (xs ?? []).some((x) => x.side === 'rear')
  return (
    (part.headers ?? []).some((h) => onRear(h.pins)) ||
    onRear(part.connectors) ||
    onRear(part.buttons) ||
    onRear(part.onboardLeds) ||
    onRear(part.shapes) ||
    onRear(part.labels)
  )
}

/** Mirror a normalised x. Viewing the rear flips the board left-to-right, so
 *  anything shared between the faces (mounting holes, the outline) has to mirror
 *  or it won't line up with the real board in your hand. */
export function mirrorX(x: number): number {
  return 1 - x
}

/**
 * Mirror a pin's outward direction horizontally, for a through pad seen from the
 * FAR side of the board (#688).
 *
 * `rotation` is which way a pad faces — 0 right, 90 down, 180 left, 270 up — and
 * a castellation's half-hole is cut on that side. Flip the board over and a pad
 * that ran off the left edge now runs off the right, so the direction has to flip
 * with it. Vertical directions are unchanged: mirroring in x leaves up as up.
 *
 * Absent stays absent, so a pad with no explicit direction keeps falling back to
 * "the nearer edge" — which already mirrors, because its x does.
 */
export function mirrorRotationX(deg?: number): number | undefined {
  if (deg === undefined || !Number.isFinite(deg)) return undefined
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360
  return r === 0 ? 180 : r === 180 ? 0 : r
}

/**
 * A group's ancestry, innermost first. Tolerates a cycle (only reachable by hand-
 * editing parts.yml) by stopping rather than looping forever, and a dangling
 * `parent` by stopping at the last group that exists.
 */
export function groupChain(groups: PartGroup[] | undefined, id: string | undefined): PartGroup[] {
  const out: PartGroup[] = []
  const seen = new Set<string>()
  let cur = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const g = (groups ?? []).find((x) => x.id === cur)
    if (!g) break
    out.push(g)
    cur = g.parent
  }
  return out
}

/**
 * Whether an item is EFFECTIVELY hidden — its own flag, or any group above it.
 * Hiding a group hides everything inside it without touching the members' own
 * flags, so un-hiding the group restores exactly what was showing before.
 */
export function itemHidden(groups: PartGroup[] | undefined, item: PartItemFlags): boolean {
  return !!item.hidden || groupChain(groups, item.group).some((g) => g.hidden)
}

/** Whether an item is EFFECTIVELY locked — its own flag, or any group above it. */
export function itemLocked(groups: PartGroup[] | undefined, item: PartItemFlags): boolean {
  return !!item.locked || groupChain(groups, item.group).some((g) => g.locked)
}

/**
 * The housing a group of pins sits in (#673) — what turns a set of pads into a
 * connector: a QWIIC socket, a Grove port, a JST shell, a servo header, a screw
 * terminal block.
 *
 * The pins stay ordinary pins in `headers[]`. That is not only the simpler model
 * — it is the only migration-safe one. A wiring endpoint is
 * `"<key>.<pinName>#<index>"` where the **index into the flattened pin list is
 * authoritative** (see `shared/netlist.ts`), so moving pins between arrays
 * silently rewires every saved design that uses the part. Naming the group they
 * are already in moves nothing.
 *
 * Contact ORDER is the group's member order, and it is load-bearing: a lead pairs
 * two housings contact-for-contact by position, which is what makes it land the
 * right way round however it is dragged.
 */
export interface GroupHousing {
  kind: PartConnectorKind
  /** Grove wiring / JST family — validated per kind, as on a connector. */
  variant?: ConnectorVariant
  /** Normalised 0..1 centre of the housing on the board. */
  x: number
  y: number
  /** Body rotation in degrees (0/90/180/270). */
  rotation?: number
  /** Silk label; absent ⇒ the kind's default name. */
  label?: string
}

/** One net joined inside a part — the pins a PCB trace ties together (#695). */
export interface PartRail {
  /** What the net is, for the ERC's explanation (`V+`, `MOTOR`, `VBAT`). */
  name: string
  /** The pin NAMES joined. Fewer than two is not a net and is dropped. */
  pins: string[]
}

export interface PartGroup {
  /** Hidden in the editor and on the rendered part. Independent of any group's
   *  own flag — see {@link itemHidden}, which is what callers should ask. */
  hidden?: boolean
  /** Locked: can't be selected, moved, restyled or deleted. Same ancestor rule
   *  as {@link hidden} — ask {@link itemLocked}, not this field. */
  locked?: boolean
  id: string
  name?: string
  /** The id of the group this one is nested inside, if any. */
  parent?: string
  /** Makes this group a CONNECTOR: its member pins are the contacts (#673). */
  housing?: GroupHousing
}

/**
 * A full, portable Part. The fields above the geometry line are the `parts.yml`
 * header the epic spells out (name, manufacturer, family, tags, package, pin
 * spacing, user key/values, voltage, part #); below it is everything the Board
 * Viewer needs to draw an accurate footprint + life-like representation.
 */
export interface PartDefinition {
  // --- Identity & catalogue metadata (the parts.yml header) ----------------
  /** Unique id within its library; the part's folder name. */
  id: string
  /** Display name (e.g. `"Raspberry Pi Pico 2 W"`). */
  name: string
  /** One-line / short description. */
  description?: string
  /** Manufacturer (e.g. `"Raspberry Pi"`, `"Pimoroni"`). */
  manufacturer?: string
  /** Family / category (e.g. `"Microcontroller"`, `"Sensor"`, `"Motor Driver"`). */
  family?: string
  /** Free-text tags for search/filter (e.g. `["rp2350", "wifi"]`). */
  tags?: string[]
  /** Through-hole vs surface-mount. */
  package?: PartPackage
  /** Pin spacing/pitch in millimetres (header standard is `2.54`). */
  pinSpacing?: number
  /** Operating voltage, free text (e.g. `"3.3V"`, `"3.3–5V"`). */
  voltage?: string
  /** Manufacturer part number (e.g. `"SC0918"`). */
  partNumber?: string
  /** User-defined key/value list (arbitrary extra spec rows). */
  properties?: Record<string, string>
  /** Semantic version of THIS part (`MAJOR.MINOR.PATCH`); drives update checks. */
  version?: string

  // --- Geometry & rendering ------------------------------------------------
  /** MCU sub-label, when the part is a board (e.g. `"RP2350"`). */
  mcu?: string
  /** PCB fill colour (any CSS colour). */
  pcbColor?: string
  /** width / height of the outline; drives the drawn proportions. */
  aspect?: number
  /** Physical board size in millimetres (informational + footprint scale). */
  dimensions?: { width: number; height: number }
  /**
   * Physical board outline as a polygon of normalised 0..1 points. Used when
   * {@link shape}`.kind === 'polygon'`. Absent / `rect` ⇒ a rounded rectangle of
   * `aspect` is drawn. Authored for non-rectangular boards.
   */
  polygon?: PolygonPoint[]
  /** The board outline kind (rect | polygon). Absent ⇒ rect. */
  shape?: PartShape

  // --- Pins, holes, buttons, decorations -----------------------------------
  /** The pin headers around the board (preferably vertical per the spec). */
  headers: PartHeader[]
  /** Mounting holes, positioned within the outline. */
  mountingHoles?: MountingHole[]
  /** Push-buttons on the board. */
  buttons?: PartButton[]
  /** Decorative chips/cans/connectors drawn as labelled rects (legacy; the Part
   *  Editor migrates these into {@link shapes} for editing). */
  features?: PartFeature[]
  /** Component shapes (rect / circle / polygon) drawn on the board. */
  shapes?: ComponentShape[]
  /** Free-floating text labels placed on the board canvas. */
  labels?: PartLabel[]
  /** Onboard indicator LEDs (single or RGB) tied to GPIO(s), drawn on the board. */
  onboardLeds?: OnboardLed[]
  /** Physical connectors (QWIIC / STEMMA QT / Grove / DuPont / JST) drawn on the
   *  board. */
  connectors?: PartConnector[]
  /**
   * The header footprint this board **plugs into** — the shape of its pin headers
   * as a family name (`xiao`, `pico`, `feather`). A board with a footprint can be
   * seated in any carrier that declares a {@link PartMount} accepting it, so a
   * XIAO RP2350 and a XIAO RP2040 both drop into a XIAO expansion base without
   * either part knowing about the other. Absent ⇒ the board doesn't stack.
   */
  footprint?: string
  /** Sockets on THIS board that accept another board on top (a carrier / shield
   *  base — the XIAO expansion board, a Pico Explorer). Absent ⇒ nothing stacks
   *  onto it. */
  mounts?: PartMount[]
  /**
   * Nets joined INSIDE the part — pins the PCB wires together (#695).
   *
   * A distribution board passes power through rather than consuming it: a
   * PCA9685's `V+` terminal feeds all sixteen servo headers, and the trace doing
   * that is invisible to the netlist. Without it the terminal is wired to a
   * battery and every servo on the headers still reads as unpowered.
   *
   * The board's own like-named rails are bonded automatically, but that rule is
   * NOT extended to parts on purpose: an opto-isolated driver has two grounds that
   * must stay apart, and bonding by name would silently join the isolated side to
   * the logic side — the exact fault the ERC exists to catch. So a part says which
   * of its pins are joined, and says nothing by default.
   */
  rails?: PartRail[]
  /** Groups (#627): items carry a `group` id; this registry names them + records
   *  nesting (`parent`), so a group can hold items AND sub-groups. Membership is
   *  the `group` id on items (robust to reorder), not index refs. */
  groups?: PartGroup[]
  /** Onboard-LED pin token (name/gpio, e.g. `"LED"` or `"25"`). Legacy hint. */
  ledLabel?: string

  // --- Assets --------------------------------------------------------------
  /**
   * The board image asset. On disk this is a **relative filename** within the
   * part folder (e.g. `"image.png"`); when the main process lists parts it
   * inlines the bytes into {@link imageData} so the renderer can draw it without
   * filesystem access. The Part Editor authors a data URL and the main process
   * writes it back out to the file on save.
   */
  image?: string
  /**
   * Populated by the main process on read: the part image as a self-contained
   * data URL (`data:image/png;base64,…`). NOT written to `parts.yml` (the file
   * keeps the relative `image` filename). Undefined when there is no image.
   */
  imageData?: string
  /**
   * Where the {@link image} sits on the board canvas (its own layer), normalised
   * `0..1`. Absent ⇒ the image covers the whole board box (the legacy "fit"
   * behaviour). Authored by dragging/resizing the image in the Part Editor.
   */
  imageLayer?: ImageLayer
  /** The board's REAR face (#636) — its own photo, sharing the front's
   *  dimensions. Absent ⇒ a single-sided part, which is nearly all of them. */
  rear?: PartRear

  // --- Bundled help / docs -------------------------------------------------
  /**
   * A bundled mini-help document (plain **markdown**) shipped alongside the part
   * so it works offline. On disk this is a **relative filename** within the part
   * folder (e.g. `"help.md"`); the main process inlines its text into
   * {@link helpText} on read so the renderer needs no filesystem access. When a
   * part is placed on the breadboard its help stacks in the Board View's help
   * drawer. The Part Editor authors the markdown and the main process writes it
   * back out to the file on save.
   */
  help?: string
  /**
   * Populated by the main process on read: the bundled {@link help} document's
   * raw markdown text. NOT written to `parts.yml` (the file keeps the relative
   * `help` filename). Undefined when there is no help document.
   */
  helpText?: string

  // --- Schematic (Part Editor, #130) ---------------------------------------
  /** Optional schematic symbol (line-drawing) for the schematic view. */
  schematic?: PartSchematic

  // --- I²C identity (#214) --------------------------------------------------
  /**
   * The I²C address(es) this part can answer on (7-bit, e.g. `[0x76, 0x77]` for
   * a BME280 with its ADDR strap). The I²C-detect instrument uses these to match
   * a found bus address back to library parts and offer to add them to the
   * project. Absent ⇒ the part isn't matched by address.
   */
  i2cAddresses?: number[]

  // --- Code library (#166) -------------------------------------------------
  /** A MicroPython driver/library linked to this part. */
  library?: PartLibraryLink

  // --- Drivers to install on the board (#184) ------------------------------
  /**
   * MicroPython driver file(s) this part needs on the board to work. When the
   * part is placed on the breadboard (Board View), Snakie prompts to install
   * these onto the connected device — copying explicit files into place (creating
   * folders as needed) or `mip`-installing a spec. Absent / empty ⇒ no driver.
   */
  drivers?: DriverFile[]

  /**
   * Modules that CAN be used with this part, and what each one unlocks (#638).
   *
   * Distinct from {@link drivers} on purpose. `drivers` means "this part does not
   * work without these", and placing the part prompts to install them. A carrier
   * like the XIAO Expansion Base instead has a *menu* of optional peripherals —
   * an OLED, an RTC, a microSD slot — and pushing all of their drivers at someone
   * who only wanted the Grove ports would be wrong. These are shown in the part's
   * detail pane as "Works with", each installable on its own.
   */
  suggests?: SuggestedModule[]

  // --- 3-D mesh (Robot View, #406) -----------------------------------------
  /**
   * A 3-D mesh (STL) linked to this part. On disk this is a **relative filename**
   * within the part folder (e.g. `"model.stl"`). Unlike `image`/`help` it is NOT
   * inlined into the renderer; when the part is dropped onto a design the main
   * process copies the file into the project URDF's `meshes/` folder and it's
   * added as a loose link in the 3-D Robot View. Absent ⇒ no mesh.
   */
  mesh?: string
  /**
   * The units the linked {@link mesh} is authored in, so it loads at a sane size in
   * the URDF world (which is metres; STLs are commonly millimetres). `'mm'` ⇒ a
   * 0.001 scale. Absent ⇒ fall back to a bounding-box heuristic on import.
   */
  meshUnits?: 'mm' | 'm'
  /**
   * An explicit uniform scale for the linked {@link mesh}, overriding
   * {@link meshUnits}. Absent ⇒ use `meshUnits` (or the bbox heuristic).
   */
  meshScale?: number

  // --- Mass / centre of mass (#554, epic #535 §1) --------------------------
  /**
   * Real mass in **grams**, for the heavy off-the-shelf parts (servos, motors,
   * batteries, boards) whose weight can't be estimated from a print — a printed
   * link estimates its mass from mesh volume, but an SG90 is 9 g of gearbox no
   * volume estimate can reach. Populated for bundled library parts where known.
   * Absent ⇒ the link falls back to a volume estimate (or a manual override).
   *
   * When a part is placed, this flows into the URDF `<mass>` (converted to kg)
   * and thence into `skeleton.json`'s `mass_g`.
   */
  mass_g?: number
  /**
   * Centre of mass in the part's own frame, **millimetres**, for lopsided parts
   * whose real CoM isn't the mesh/body centroid (a geared motor's mass sits over
   * its gearbox, not its centre). Absent ⇒ use the computed centroid.
   */
  com_xyz?: [number, number, number]
  /**
   * Ground-contact points in the part's own frame, **millimetres** (#569, epic
   * #535 §2) — the feet/wheels of a part that touch the floor. Authored once on
   * the part so they travel with it across projects; applied to a placed part's
   * URDF link (the robot-level per-link `contacts` in `robot.yml`, #557, override
   * where a link needs bespoke points). Absent ⇒ the part isn't a foot/wheel.
   */
  contacts?: [number, number, number][]

  /**
   * Electrical behaviour for the Circuit Sim (epic #597, #600). Absent ⇒ the part
   * is electrically `passive` (no source/load/model) — it still appears in the
   * netlist as connection points, it just has no I–V behaviour of its own.
   */
  electrical?: PartElectrical

  // --- Editor display state (persisted) ------------------------------------
  /**
   * Which layers are shown when the part is drawn (Part Editor, Parts Library
   * preview and Board View). A key set to `false` hides that layer everywhere —
   * e.g. hide the traced PCB `image` in the finished part while keeping its bytes
   * for later refinement. Absent keys default to visible.
   */
  layerVisibility?: PartLayerVisibility
}

/** Per-layer visibility persisted with a part (absent key ⇒ visible). */
export interface PartLayerVisibility {
  /** The PCB body (outline + fill). Off for parts with no board, e.g. a motor. */
  pcb?: boolean
  /** The uploaded board photo (separate from the PCB body). */
  image?: boolean
  holes?: boolean
  pins?: boolean
  components?: boolean
}

/**
 * A MicroPython library/module linked to a part (#166): the import name, where to
 * install it from, and where its docs live. Lets Snakie offer to install the
 * driver when the part is added to a project, and check a project's imports.
 */
export interface PartLibraryLink {
  /** The import/module name the code uses (e.g. `"vl53l0x"`). */
  module?: string
  /** Where to install it from — a `mip` spec, package name, or git/file URL. */
  url?: string
  /** URL of the library's docs / README. */
  docs?: string
}

/**
 * A MicroPython driver FILE a part needs on the board (#184). The Board View
 * offers to install these when the part is placed on the breadboard.
 *
 * The {@link source} decides the install mechanism (see `driverInstallMethod`):
 *  - a `github:`/`gitlab:`/`pypi:` spec, or a bare micropython-lib package name,
 *    is installed with `mip` — and {@link target} is then the **install folder**
 *    (e.g. `"lib"`; omit for the device default `/lib`);
 *  - an `http(s)://` URL, or a bare filename shipped alongside the part in its
 *    library folder, is **copied** verbatim — and {@link target} is then the full
 *    destination **path** on the board (folder + filename, e.g. `"lib/vl53l0x.py"`).
 *    Any intermediate folders are created.
 */
/**
 * An OPTIONAL module this part can use, naming what it unlocks (#638).
 *
 * `module` is a {@link ./modules-catalog}.MODULES id, so the detail pane can show
 * its real name/description and reuse the ordinary module install path (including
 * the "already installed" probe) rather than restating any of it here.
 */
export interface SuggestedModule {
  /** A `MODULES` catalog id, e.g. `ssd1306`. */
  module: string
  /** What this module gets you on THIS part, e.g. `the 0.96" OLED`. */
  unlocks?: string
}

export interface DriverFile {
  /** Where the driver comes from: a `mip` spec, a URL, or a bundled filename. */
  source: string
  /** Where it lands on the board — an install folder (mip) or a full path (copy). */
  target: string
  /** Optional human label shown in the install prompt (defaults to the source). */
  label?: string
}

/**
 * A lightweight summary of a part, returned when listing a library so the
 * panel can render the catalogue without shipping every image/asset. The full
 * {@link PartDefinition} is fetched on demand (or included inline for small
 * libraries — the main process returns whichever is convenient).
 */
export interface PartSummary {
  id: string
  name: string
  description?: string
  manufacturer?: string
  family?: string
  tags?: string[]
  version?: string
  /** Whether the part has an image asset (so the panel can show a thumb badge). */
  hasImage?: boolean
}

/**
 * A library: a named collection of parts living in one folder, with its own
 * `library.yml` manifest. Mirrors a Fusion 360 electronics library.
 */
export interface PartLibrary {
  /** Unique library id; the library's folder name. */
  id: string
  /** Display name. */
  name: string
  /** Short description. */
  description?: string
  /** Author / maintainer. */
  author?: string
  /** Homepage / source repo URL. */
  homepage?: string
  /** Semantic version of the whole library; drives update checks vs the registry. */
  version?: string
  /**
   * Whether the library was installed from the community registry (vs authored
   * locally by the user). Registry libraries are update-checked; local ones are
   * the user's own. Populated by the main process on read.
   */
  source?: 'local' | 'registry'
}

/** A library plus its parts — what `parts:listLibraries` returns per library. */
export interface PartLibraryWithParts extends PartLibrary {
  parts: PartDefinition[]
}

// --- Community registry (#129) ---------------------------------------------

/** One approved library in the master registry (the GitHub-hosted index). */
export interface RegistryEntry {
  /** Library id (matches the installed `library.yml` id). */
  id: string
  /** Display name. */
  name: string
  /** Short description. */
  description?: string
  /** Author / maintainer. */
  author?: string
  /** Git repository URL to clone/download the library from. */
  repo: string
  /** Latest published semantic version. */
  version: string
  /** Optional tags for browsing the registry. */
  tags?: string[]
}

/** The master registry document fetched from the index repo. */
export interface PartRegistry {
  /** Registry schema version (for forward-compat). */
  schema?: number
  /** The approved libraries. */
  libraries: RegistryEntry[]
}

/**
 * The update status of one installed library vs the registry: whether a newer
 * version is available, plus both versions for the UI to show.
 */
export interface LibraryUpdate {
  id: string
  name: string
  /** The installed version (or `null` if unversioned). */
  installed: string | null
  /** The registry's latest version. */
  available: string
  /** True when `available` is strictly newer than `installed`. */
  updateAvailable: boolean
}

/** The default community registry index URL (raw GitHub). Override-able later. */
export const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/kevinmcaleer/snakie-parts/main/registry.json'

/** The standard 0.1" header pitch, in millimetres (grid-snap default). */
export const STANDARD_PIN_SPACING_MM = 2.54
