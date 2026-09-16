import * as Blockly from 'blockly/core'
// `RegistrableField` is the registry's own contract type and is not on the
// `blockly/core` barrel, so it comes from the module that declares it.
import type { RegistrableField } from 'blockly/core/field_registry'

/**
 * THE PEN COLOUR FIELD (#1013, epic #1007).
 * =============================================================================
 *
 * A swatch you pick a colour from, on the block face. The issue calls this
 * "half of why Scratch feels good", and it is right: a child choosing a pen
 * colour should SEE the colour, not type its name into a text field and find out
 * whether they spelled it correctly by running the program.
 *
 * A FIXED PALETTE OF NAMED COLOURS, not an arbitrary picker. `turtle.py` takes a
 * CSS colour — a name or a hex string — so either would run. Names win, for one
 * reason that is the whole epic in miniature: the generated line reads
 * `turtle.pencolor("red")`, which is a line a learner can read, remember and
 * later type. A picker generates `turtle.pencolor("#c83c3c")`, and a mirror full
 * of hex is a mirror nobody learns from. Twelve colours is also a *choice a
 * child can make* — a 16-million-colour picker is a decision, not a choice.
 *
 * NOT `field_colour`: Blockly 13 moved it out of core into a separate plugin, so
 * using it would mean a new dependency for a worse answer (a hex picker). This
 * is a `FieldDropdown` whose options are SVG swatches, which core has always
 * rendered — on the block face and in the menu alike.
 *
 * The swatches are inline `data:` SVG, which the app's `img-src 'self' data:`
 * CSP already allows. We learned that one the hard way in #1009, when Blockly
 * fetched its own sprites from a CDN and the canvas came up bare.
 */

/** One pickable pen colour. */
export interface PenColour {
  /** What the generated code passes to `pencolor` — a CSS colour name. */
  name: string
  /** The hex the swatch is drawn in. Must be what a browser renders `name` as. */
  hex: string
}

/**
 * The palette.
 *
 * DRAWN ON BLACK, which is what picks these: the Turtle instrument is a dark
 * phosphor screen like every other Snakie instrument, so the library's default
 * pen is `white` rather than the `black` CPython turtle uses on paper. A muted
 * or dark colour that looks fine in a picker is invisible there, so every entry
 * here is a colour that reads on a dark canvas.
 *
 * `white` leads because it is the library's default: the first colour in the
 * list is the one the block shows before anybody chooses, and that should be the
 * colour the turtle is already drawing in.
 */
export const PEN_COLOURS: readonly PenColour[] = Object.freeze([
  { name: 'white', hex: '#ffffff' },
  { name: 'red', hex: '#ff0000' },
  { name: 'orange', hex: '#ffa500' },
  { name: 'yellow', hex: '#ffff00' },
  { name: 'lime', hex: '#00ff00' },
  { name: 'green', hex: '#008000' },
  { name: 'cyan', hex: '#00ffff' },
  { name: 'deepskyblue', hex: '#00bfff' },
  { name: 'blue', hex: '#0000ff' },
  { name: 'magenta', hex: '#ff00ff' },
  { name: 'hotpink', hex: '#ff69b4' },
  { name: 'gray', hex: '#808080' }
])

/** The default — `turtle.py`'s own default pen colour. */
export const DEFAULT_PEN_COLOUR = PEN_COLOURS[0].name

/** Swatch edge, in px. Big enough to read as a colour, small enough to sit inline. */
const SWATCH = 18

/**
 * One swatch, as an inline SVG `data:` URI.
 *
 * A rounded rect in the colour with a translucent white outline, so `white`
 * still has an edge against a light block and `gray` still has one against a
 * dark one. Not URL-encoded beyond `#`, which is the only character here that
 * would terminate the URI early.
 */
function swatchUri(hex: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SWATCH}" height="${SWATCH}">` +
    `<rect x="1" y="1" width="${SWATCH - 2}" height="${SWATCH - 2}" rx="3" ` +
    `fill="${hex}" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}`
}

/**
 * The dropdown options: a swatch per colour, with the colour NAME as its `alt`.
 *
 * `alt` is not decoration. It is what a screen reader announces, what Blockly
 * falls back to when an image can't load, and what {@link FieldPenColour.getText}
 * returns — so the colour always has a spoken name even though the field is a
 * picture.
 */
function colourOptions(): Blockly.MenuOption[] {
  return PEN_COLOURS.map((c) => [
    { src: swatchUri(c.hex), width: SWATCH, height: SWATCH, alt: c.name },
    c.name
  ])
}

/** The name JSON definitions use. */
export const FIELD_COLOUR_TYPE = 'field_snakie_colour'

/**
 * A pen colour, shown as a swatch.
 *
 * LIKE {@link ../pin-field FieldPin}, IT NEVER REJECTS A VALUE. A file that says
 * `turquoise` — hand-edited, or written by a later Snakie with a bigger palette —
 * keeps saying `turquoise`, rather than being silently reset to the first colour
 * in the list. The swatch falls back to drawing the value directly, which works
 * for any CSS colour the browser knows and is exactly what the turtle will draw.
 */
export class FieldPenColour extends Blockly.FieldDropdown {
  constructor(value?: string) {
    super(colourOptions())
    if (value !== undefined) this.setValue(value)
  }

  /** Blockly's JSON hook: `{ type: 'field_snakie_colour', colour: 'red' }`. */
  static override fromJson(options: Blockly.FieldDropdownFromJsonConfig): FieldPenColour {
    const { colour } = options as unknown as { colour?: string }
    return new FieldPenColour(colour)
  }

  /** Accept any colour, including one outside the palette. See the class note. */
  protected override doClassValidation_(value?: string): string | null {
    return value === undefined || value === null ? null : String(value)
  }

  /** The colour's NAME — what a screen reader says and what the code will pass. */
  override getText(): string {
    return String(this.getValue() ?? '')
  }
}

/**
 * Register the field type so JSON block definitions can name it.
 *
 * Idempotent: Blockly throws on a duplicate registration, and the palette this
 * belongs to can be installed more than once (a hot reload, a test suite).
 */
export function installColourField(): void {
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, FIELD_COLOUR_TYPE)) return
  Blockly.fieldRegistry.register(FIELD_COLOUR_TYPE, FieldPenColour as unknown as RegistrableField)
}
