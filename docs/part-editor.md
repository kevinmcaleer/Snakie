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

### Breadboard view — the layered canvas

The Breadboard view is an interactive, **layered canvas**. Bottom → top:

1. **Board shape** — a **rectangle** (with an adjustable corner radius) or a
   **polygon**. Set the shape + PCB colour + physical **dimensions** (width ×
   height mm) in the left inspector's **Board** section.
2. **Image layer** — the board photo is its **own layer**, not stretched to the
   outline. Upload it, then drag it (and its corner handles) on the canvas to
   line it up with the real board; an **opacity** slider helps you trace over it.
3. **Components on top** — **pins**, **mounting holes** and **text labels**, each
   **free-placed** by dragging it anywhere on the board.

#### Toolbar

A toolbar above the canvas selects the active tool:

- **Select** — click an object (or the image) to select it; drag to move it;
  drag the image's corner handles to resize it.
- **Pan** — drag to pan the canvas; the scroll-wheel zooms. **Fit** resets it.
- **Shape** — drag the polygon's vertices, or click the board to add one.
- **Pin** / **Hole** / **Text** — click the board to drop a pin, mounting hole
  or label at that point.

#### Inspector

Whatever you select shows its editable fields in the left **inspector**:

- **Pin** — board pin number, GPIO/signal **name**, **type** (power · ground ·
  **IO** · other), for IO pins a **GPIO number** + **capabilities** (digital,
  pwm, adc, spi, i2c), **castellated or regular**, and its x/y.
- **Mounting hole** — x/y + millimetre diameter.
- **Label** — text, x/y, font size.
- **Image layer** — x/y/w/h + opacity.

A **Delete** button on the inspector removes the selected object.

#### Grid & snap

The toolbar's **Grid** toggle draws the part's pin-spacing grid (0.1″ / 2.54 mm
by default) behind the board, and **Snap** snaps placed/dragged objects to it for
accurate alignment with the real board.

## Footprint vs life-like

The toolbar's **Life-like / Footprint** toggle simply shows or hides the image
layer on the *same* canvas:

- **Life-like** — the full-colour board (image layer + shape + components).
- **Footprint** — the engineering view: the board outline + the **pads / pin
  holes**, mounting holes and labels, with the photo hidden. "The footprint
  mirrors the life-like, just without the image."

> Coming next: image **crop** and **magic-wand background removal** (so you can
> knock out a plain backdrop and make the photo match the real board exactly).

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
board **shape** + polygon, **free-placed pins** (with x/y), mounting holes,
labels, the image filename and its **image-layer** placement. See
[parts-library.md](parts-library.md#a-part--partsyml) for the on-disk format.

## See also

- [Parts Library](parts-library.md) — the storage format & community registry.
- [Board View](board.md) — the live view authored parts render into.
- The editor lives in `src/renderer/src/components/PartEditor.tsx`; the pure
  helpers (blank/normalise/validate, board projection, grid snap) in
  `part-editor.util.ts`; the footprint + schematic renderers in
  `PartFootprint.tsx` / `PartSchematicView.tsx`.
