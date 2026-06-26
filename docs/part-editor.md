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

The Breadboard view is an interactive, **layered canvas**, managed from a
**Layers panel** (top → bottom is the draw order):

1. **Components** — labelled **rectangles** (chips/parts) + **text labels**.
2. **Pins** — free-placed pads (you **can't drop a pin inside a mounting hole**).
3. **Mounting holes** — these **cut through** the PCB *and* the image (a real
   cutout), with a plating ring.
4. **PCB** (bottom) — the board outline (**rectangle** with corner radius, or
   **polygon**) **and the board image**, which sits on this layer and is
   **clipped to the outline**.

Each layer has a **visibility toggle** (the eye checkbox) and a count. Hiding the
PCB image gives you the footprint view (pads & holes only).

#### Adding & editing

- The **Layers panel** drives adding: **＋Pin**, **＋Hole**, **＋Rect**, **＋Text**
  arm a tool — then click the board to drop that object. The **PCB** row has the
  **shape** selector (Rectangle / Polygon), **Edit shape** (drag polygon
  vertices), and **＋Image** (upload a board photo onto the PCB).
- The toolbar above the canvas has **Select** (click an object — or the image —
  to select; drag to move; drag the image's corner handles to resize), **Pan**
  (drag to pan, scroll to zoom), and **Fit** (reset the view).
- The **inspector** below the Layers panel edits whatever is selected, with a
  **Delete** button.

#### Inspector

Whatever you select shows its editable fields in the left **inspector**:

- **Pin** — board pin number, GPIO/signal **name**, **type** (power · ground ·
  **IO** · other), for IO pins a **GPIO number** + **capabilities** (digital,
  pwm, adc, spi, i2c), **castellated or regular**, and its x/y.
- **Mounting hole** — x/y + millimetre diameter.
- **Component** — label, kind, x/y/w/h.
- **Label** — text, x/y, font size.
- **Image layer** — x/y/w/h + opacity.

A **Delete** button on the inspector removes the selected object.

#### Grid & snap

The toolbar's **Grid** toggle draws the part's pin-spacing grid (0.1″ / 2.54 mm
by default) behind the board, and **Snap** snaps placed/dragged objects to it for
accurate alignment with the real board.

## Footprint vs life-like

Hide the **PCB image** layer (its eye in the Layers panel) to get the footprint
view — the same canvas with the photo off:

- **Life-like** — the full-colour board (PCB + image + holes + pins + components).
- **Footprint** — the board outline + the **pads / pin holes** + mounting holes +
  components, with the photo hidden. "The footprint mirrors the life-like, just
  without the image."

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
