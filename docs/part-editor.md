# Part Editor — author parts (#130)

The **Part Editor** is a visual editor for authoring a part: it writes the exact
`parts.yml` (+ image asset) the [Parts Library](parts-library.md) stores, so the
community can grow the library without hand-editing YAML. It exists to let you
build an **accurate representation of a part** for the [Board Viewer](board.md).

## Opening it

From the **Parts** view in the activity bar:

- **+ New part** — start a blank part (saved into your local **My Parts** library).
- A part's **Edit** button — re-open a saved part for editing.

The editor fills the window. **Done** closes it (your last save is kept; saving is
explicit). The YAML is the round-trippable source of truth, so re-opening a saved
part restores it exactly.

## The two views

A toggle in the title bar flips between the two views the recommended authoring
flow uses — **start in Schematic** (define the pins), then move to **Breadboard**
(the physical design).

### Schematic view

A simple **line-drawing symbol**: a labelled box with the pins projecting from its
four sides. The **pad ↔ pin table** lets you place each pin on a side of the
symbol (and order it); the symbol updates live. When you haven't customised it,
the symbol is derived from your headers (a `left`-edge header → the symbol's left
side), so a part drawn in the breadboard view gets a sensible schematic for free.

### Breadboard view

The physical design, authored in scrollable sections with a **live preview** on
the right:

- **Part** — name, description, manufacturer, family, tags, voltage, part #,
  version. The name becomes the saved folder id (shown as `…/parts.yml`).
- **Physical** — package (**THT / SMD**), **pin spacing** (mm), **dimensions**
  (width × height mm), PCB colour, MCU/chip, onboard-LED pin.
- **Image** — upload a photo/SVG of the board (ideally pins in a **vertical
  arrangement**, per the spec). Stored as an asset beside `parts.yml`.
- **Headers & pins** — a header is a row of pins along one edge (`left`/`right`
  run vertically, `top`/`bottom` horizontally). Each pin has:
  - a **board pin number**, a **GPIO / signal name**,
  - a **type**: power · ground · **IO** · other,
  - for **IO** pins: a **GPIO number** + **capabilities** (digital, pwm, adc,
    spi, i2c) as checkboxes,
  - **castellated or regular** (an edge pad vs a header hole).
- **Mounting holes** — positioned (normalised x/y) with a millimetre diameter.
- **Buttons** — a label at a position.
- **Properties** — arbitrary key/value spec rows.

#### Grid snap

The **Snap positions to 2.54 mm grid** checkbox snaps mounting-hole and button
positions to the part's pin-spacing grid (0.1″ headers by default), and shows the
grid behind the footprint preview — for accurate placement against the real
board.

## Footprint vs life-like preview

The breadboard preview toggles between:

- **Footprint** — the engineering view: the board outline (your polygon, or a
  rounded rect), pin **pads** laid along their edges (castellated vs regular,
  coloured by role, numbered + named), **mounting holes** (rings) and **buttons**.
- **Life-like** — the full-colour rendering, drawn by the **Board View** renderer
  (your image, PCB colour, features and labelled pads) — so what you author is
  exactly what the Board Viewer will show.

## Output

**Save** writes the part to its library:

```
<userData>/parts/<libraryId>/<partId>/parts.yml   # + image.png|jpg|svg
```

The **Library** dropdown in the title bar picks the target (defaults to your
local **My Parts** library, auto-created on first save). Saving validates the
part (it needs a name and at least one pin) and warns if the id collides with
another part in the same library.

The fields written are the full Parts Library schema — name, manufacturer,
family, tags, package, pin spacing, user key/values, voltage, part #, dimensions,
polygon, pins, mounting holes, buttons and the image filename. See
[parts-library.md](parts-library.md#a-part--partsyml) for the on-disk format.

## See also

- [Parts Library](parts-library.md) — the storage format & community registry.
- [Board View](board.md) — the live view authored parts render into.
- The editor lives in `src/renderer/src/components/PartEditor.tsx`; the pure
  helpers (blank/normalise/validate, board projection, grid snap) in
  `part-editor.util.ts`; the footprint + schematic renderers in
  `PartFootprint.tsx` / `PartSchematicView.tsx`.
