/**
 * Shared Board-View definition types.
 *
 * Imported by the renderer (the SVG drawer + built-in registry), the preload
 * (the `board.listUserBoards()` DTO) and the main process (which reads the user
 * JSON files off disk). Kept dependency-free so all three layers can use it
 * without pulling in React, Node or Electron.
 *
 * A {@link BoardDefinition} is the data a user authors (as JSON) to teach the
 * Board View how to draw a board and where its GPIO pins live — see
 * `docs/board.md` for the authoring guide (kept IN SYNC with this file).
 */

/**
 * The electrical role of a pad. Only `gpio` pads are matched against parsed
 * `Pin(...)` tokens and can be highlighted as "used"; `gnd`/`vcc` are power
 * rails (never wired) and are drawn in a distinct colour; `other` is any
 * non-GPIO signal (e.g. `RUN`, `EN`, `ADC_VREF`). Absent ⇒ treated as `gpio`.
 */
export type BoardPadType = 'gpio' | 'gnd' | 'vcc' | 'other'

/** One header pad: a numeric GPIO (if any) plus the silk-screen label text. */
export interface BoardPad {
  /** The numeric GPIO this pad breaks out, matched against numeric `Pin(n)`. */
  gpio?: number
  /** The silk text drawn on/next to the pad (e.g. `"GP0"`, `"3V3"`, `"IO34"`). */
  label: string
  /**
   * The human pin NAME (distinct from the silk `label`): e.g. label `"GP0"` with
   * name `"UART0 TX"`, or label `"3V3"` with name `"3.3V Out"`. Optional; purely
   * informational metadata authored in the creator — the renderer matches on
   * `label`/`gpio`, not `name`.
   */
  name?: string
  /**
   * The pad's electrical role (defaults to `'gpio'` when absent). Power pads
   * (`gnd`/`vcc`) are drawn in a distinct colour and are never wired/highlighted
   * by the pin parser (only `gpio` pads with a numeric `gpio`/`label` match).
   */
  type?: BoardPadType
}

/** A run of pads laid evenly along one edge of the board, in array order. */
export interface BoardHeader {
  /** Which edge the pads sit on (drives vertical vs horizontal layout). */
  edge: 'left' | 'right' | 'top' | 'bottom'
  /** The pads, spaced evenly from the start of the edge to its end. */
  pins: BoardPad[]
}

/** A decorative on-board component drawn as a labelled rounded rect. */
export interface BoardFeature {
  /** Silk text drawn on the feature (e.g. `"RP2350"`, `"CYW43439"`). */
  label: string
  /** Visual style of the rect (picks fill/stroke). */
  kind: 'mcu' | 'wifi' | 'usb' | 'chip' | 'led'
  /** Normalised 0..1 position/size WITHIN the board outline (x,y = top-left). */
  x: number
  y: number
  w: number
  h: number
}

/** A full, drawable board: outline, decorations and the broken-out headers. */
export interface BoardDefinition {
  /** Unique id (a user file with the same id overrides a built-in). */
  id: string
  /** Display name shown in the selector. */
  name: string
  /** MCU sub-label shown beside the name (e.g. `"RP2350"`). */
  mcu: string
  /** PCB fill colour (any CSS colour). */
  pcbColor: string
  /** width / height ratio of the board outline; drives the drawn proportions. */
  aspect: number
  /** Onboard-LED pin token (label or gpio, e.g. `"LED"` or `"25"`); matched
   * against parsed pins to light the onboard-LED dot. */
  ledLabel?: string
  /** Decorative chips/cans drawn as labelled rects. */
  features?: BoardFeature[]
  /** The castellated pads / pin headers around the board. */
  headers: BoardHeader[]
  /**
   * An optional board photo/SVG, stored as a self-contained **data URL**
   * (`data:image/...;base64,...`), drawn as the board background behind the
   * features + pads. Authored via the Board Creator's image upload; stored
   * verbatim so it round-trips (re-loading the board re-loads the image).
   */
  image?: string
}
