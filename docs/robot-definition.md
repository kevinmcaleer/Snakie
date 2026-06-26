# Robot definition file & Wiring (#128 / #139 / #140)

A project's **robot definition** records the parts you've placed and the
pin-to-pin wiring between them, as a human-readable **`robot.yml`** in the project
folder (so it sits next to your code and version-controls cleanly). It's authored
in the Board Viewer's **Wiring** mode and consumed by the documentation views.

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

## Wiring mode

Open the **Board View** window and click the **wiring** button in its title bar.

- **Choose a microcontroller** from the picker — its pins appear as a box.
- **Add parts** from the **Parts** mode (a part's **+ Add to project** button);
  they appear as boxes on the canvas.
- **Move** a box by dragging it; **pan** the canvas by dragging empty space and
  **zoom** with the scroll-wheel (**Fit** resets the view).
- **Wire pins**: drag from a pin's dot to another pin's dot. The wire is a
  node-RED-style **noodle** (bezier) that routes between the facing sides.

### Wire colours

- **Power** (a `pwr`/`vcc` pin) wires are **red**.
- **Ground** wires are **white** (the canvas mat is dark).
- **Signal** wires get a distinct palette colour; pick any colour per wire from
  the **Colour** swatch in the connections table.

### Connections table

Beneath the canvas, every wire is listed (from · to · net · colour), with a
colour picker and a delete button — the same data that lives in `robot.yml`.

## See also

- [Parts Library](parts-library.md) / [Part Editor](part-editor.md) — where the
  parts you place come from.
- The shape lives in `src/shared/robot.ts`; the YAML in `src/shared/robot-yaml.ts`.
