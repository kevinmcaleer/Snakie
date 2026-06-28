# Robot definition file & Wiring (#128 / #139 / #140)

A project's **robot definition** records the parts you've placed and the
pin-to-pin wiring between them, as a human-readable **`robot.yml`** in the project
folder (so it sits next to your code and version-controls cleanly). It's authored
right in the Board Viewer's **Breadboard** and **Schematic** views and consumed by
the documentation views.

## Where it lives

`robot.yml` is written in the **open project folder** (the folder the file
browser is rooted at). With no folder open it falls back to
`<userData>/robot.yml` so the feature still works.

## The file

```yaml
name: Line Follower            # optional project name
board: pico2w                  # the microcontroller (a board id)
boardX: 40                     # canvas placement of the MCU box
boardY: 30
parts:
  - id: dist1                  # unique instance id; wires reference "<id>.<Pin>"
    lib: snakie-basics         # the library it came from
    part: vl53l0x              # the part id within that library
    label: Distance            # optional; defaults to the part name
    x: 320                     # canvas placement
    y: 30
connections:
  - id: dist1.SDA__board.GP4
    from: dist1.SDA            # "<partId>.<Pin>" or "board.<Pin>" for the MCU
    to: board.GP4
    net: signal               # vcc | gnd | signal — drives the wire colour
    color: '#4ea1ff'          # optional explicit colour (signal wires get one)
```

Wire endpoints are `"<partId>.<PinName>"`, or `"board.<PinName>"` for the
microcontroller.

## Wiring in the Board View

Open the **Board View** window and switch its view-type tabs (top-left) from
**Node graph** to **Breadboard** or **Schematic** — both place the board + parts on
one canvas and let you wire them. (Node graph stays as the code-parsed pin-usage
view.)

- **Choose a microcontroller** from the board picker — it is drawn as its real
  PCB (Breadboard) or a generic IC-block symbol (Schematic); each part is drawn
  with its real Part-Editor footprint (Breadboard) or schematic symbol
  (Schematic), every pin a connectable dot.
- **Combine view**: both views also **highlight + label the board pins your code
  uses** (the node-graph data), so the pins your program drives and the parts you
  wire appear together.
- **Add parts** from the **library dock** on the right (a part's **+ Add to
  project** button); they appear on the canvas. Collapse the dock with the **›**
  to give the canvas the whole window; reopen it from the **Library** tab.
- **Move** a component by dragging its body (committed on drop); **pan** the
  canvas by dragging empty space and **zoom** with the scroll-wheel (**Fit**
  resets the view). Remove a placed part with the **✕** on its body.
- **Wire pins**: drag from a pin's dot to another pin's dot. Wires are
  **auto-routed around components** (with a margin between parallel runs): a
  rounded **noodle** in Breadboard, **orthogonal** (right-angle) lines in Schematic.
- **Schematic conventions**: the MCU is an IC block with **power on top**, a
  **single combined GND at the bottom** (the board's multiple grounds show as one
  terminal in Schematic but remain individual pads in Breadboard), signals on the
  sides, and plain pin stubs (no bubbles).
- Both views **auto-zoom-to-fit** as you switch view, change board, or add a part.
- The **Breadboard ↔ Schematic** toggle never breaks a wire — pin identity is the
  fixed flattened-header index, so connections survive switching representation.

### Wire colours

- **Power** (a `pwr`/`vcc` pin) wires are **red**.
- **Ground** wires are **white** (the canvas mat is dark).
- **Signal** wires get a distinct palette colour; pick any colour per wire from
  the **Colour** swatch in the connections table.

### Connections table

Beneath the canvas, every wire is listed (from · to · net · colour), with a
colour picker and a delete button — the same data that lives in `robot.yml`.

## Generated documentation (BOM + pinouts)

The Board View can turn a project into two portable **Markdown** documents you can
paste straight into a README — from the **Export** menu on the zoom toolbar:

- **BOM (Markdown)** — a Bill of Materials. The microcontroller is listed first,
  then every placed part **grouped by type with a quantity**. Columns: Qty · Part ·
  Description · Manufacturer · Family · Part #, filled from each part's `parts.yml`
  (missing fields show `—`). Saved as `<project>-bom.md`.
- **Pinouts (Markdown)** — a generated pin-assignment table. Wires that touch the
  board become **MCU-pin-first** rows (sorted GPIO-number first, then named pins
  like `3V3`/`GND`) with columns MCU Pin · Part · Part Pin · Net; any part↔part
  wires follow under an **Other connections** table. Saved as `<project>-pinouts.md`.

Both are generated purely from `robot.yml` + the resolved library parts
(`src/shared/robot-docs.ts`), so they always match what's on the canvas.

## See also

- [Parts Library](parts-library.md) / [Part Editor](part-editor.md) — where the
  parts you place come from.
- The shape lives in `src/shared/robot.ts`; the YAML in `src/shared/robot-yaml.ts`.
