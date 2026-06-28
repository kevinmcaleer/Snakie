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
  /** Silk label (e.g. `"BOOT"`, `"RESET"`, `"USR"`). */
  label: string
  /** Normalised X within the board outline. */
  x: number
  /** Normalised Y within the board outline. */
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
}

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
  /** Onboard-LED pin token (name/gpio, e.g. `"LED"` or `"25"`). */
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

  // --- Schematic (Part Editor, #130) ---------------------------------------
  /** Optional schematic symbol (line-drawing) for the schematic view. */
  schematic?: PartSchematic

  // --- Code library (#166) -------------------------------------------------
  /** A MicroPython driver/library linked to this part. */
  library?: PartLibraryLink

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
