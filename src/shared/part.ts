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
 */
export type PartPinShape = 'square' | 'round' | 'castellated' | 'header'

/** Which edge of the board outline a pin/header sits on. */
export type PartEdge = 'left' | 'right' | 'top' | 'bottom'

/** One physical pin/pad on the part. */
export interface PartPin {
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
  /** How the pad is drawn (square / round / castellated / header). */
  shape?: PartPinShape
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
 * A physical connector on the board drawn as a placed body — e.g. a **QWIIC** /
 * **STEMMA QT** 4-pin JST-SH I2C socket, or a generic **jst** header. Its
 * {@link pins} are full {@link PartPin}s, so a QWIIC's SDA/SCL carry a GPIO +
 * `i2c` capability/signal/bus just like any other pin, alongside 3V3 / GND.
 */
export interface PartConnector {
  /** Paint/click z-order among components (higher = on top). Absent ⇒ legacy
   *  category default; set explicitly when reordered in the Layers panel. */
  z?: number
  /** `qwiic` (STEMMA QT — a 4-pin JST-SH I2C socket) or a generic `jst` header. */
  kind: 'qwiic' | 'jst'
  /** Silk label (defaults to `"QWIIC"` / `"JST"`). */
  label?: string
  /** Normalised 0..1 position of the connector body within the outline. */
  x: number
  y: number
  /** The connector's contacts, in order — full pins (GND/3V3/SDA/SCL for QWIIC). */
  pins: PartPin[]
}

/** A mounting hole, positioned in normalised 0..1 coords within the outline. */
export interface MountingHole {
  /** Normalised X within the board outline (0 = left edge, 1 = right edge). */
  x: number
  /** Normalised Y within the board outline (0 = top edge, 1 = bottom edge). */
  y: number
  /** Hole diameter in millimetres (e.g. `2.0` for M2, `3.0` for M3). */
  diameter: number
}

/** A push-button on the board, positioned in normalised 0..1 coords. */
export interface PartButton {
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
 */
export interface OnboardLed {
  /** Paint/click z-order among components (higher = on top). Absent ⇒ legacy
   *  category default; set explicitly when reordered in the Layers panel. */
  z?: number
  kind: 'single' | 'rgb' | 'neopixel'
  /** Silk label (defaults to `"LED"` / `"RGB"` / `"NeoPixel"`). */
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
  kind: ComponentShapeKind
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
  text: string
  x: number
  y: number
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
  /** Physical connectors (QWIIC / STEMMA QT / JST) drawn on the board. */
  connectors?: PartConnector[]
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
