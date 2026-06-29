---
name: build-part-from-image
description: >-
  Build a Snakie part (parts.yml) from a product page or part image + pinout.
  Use when the user points at a product/datasheet page or a photo/pinout diagram
  of an electronic part (sensor, board, driver, IC, display, …) and wants it
  turned into a Snakie Parts Library part — extracting pins from the pinout and
  drawing the key components with the Part Editor's shapes & text tools. Part of
  epic #191 (Standard library updates).
---

# Build a Snakie part from an image

Turn a product page / part image (with a pinout) into a valid Snakie part folder
(`parts.yml` + optional `image`). Aim for a part that looks right in the Part
Editor and the Board View and whose pins resolve correctly — **not** a
pixel-faithful PCB.

## Inputs

One or more of:
- a **product / datasheet URL** (use WebFetch to read it),
- a **part image** (read it to see the silkscreen, connectors, mounting holes),
- a **pinout** (a labelled diagram, or a text pin table).

If a pinout diagram is available, prefer it for pin positions; otherwise use the
text pin description and lay pins out evenly along the edges.

## Two ways to draw the board — prefer the photo

**A. Background photo (the life-like path — strongly preferred).** If you can get a
**clean, top-down** product photo (board flat, filling the frame, plain
background), use it as the board background. The silk text, the MCU, the
connectors and the buttons are all *in the photo*, so you **don't draw any
shapes** — you only overlay the **pads** (positioned over the photo's real pads)
so the board is still wireable. This is what makes a part look real. See
**Background photo** below.

**B. Shapes + text (fallback).** Only when no clean top-down photo exists, draw
the board from `shapes` + `labels`:
- ✅ the **outline** at real dimensions, the **defining components** (a grey rect
  for the MCU/IC, the USB/JST/header connectors, a display glass), **mounting
  holes**, and the **pads** with their labels.
- ❌ **No copper traces or ground pours** (they make the board unreadable).
- ❌ Skip minutiae — not every SMD resistor/cap needs a shape.

## Background photo

1. **Source** a clean top-down image — a product-gallery photo on a plain
   background, or a top-down board render. Avoid angled/in-hand shots.
2. **Download** it (`curl -fsSL <url> -o raw.jpg`) and **look at it** (read the
   image) to confirm it's usable and to read the *real* layout.
3. **Crop to the board** so it fills the frame with little margin — e.g.
   `sips -c <h> <w> raw.jpg --out image.jpg` (centered), or ImageMagick
   `convert raw.jpg -fuzz 6% -trim +repage image.jpg`. Read the crop to confirm.
4. **Place** `image.jpg` (or `.png`) in the part folder and reference it:
   ```yaml
   image: image.jpg
   imageLayer: { x: 0, y: 0, w: 1, h: 1 }   # fills the outline
   ```
   Set the part `aspect` (and `dimensions`) to the board's **real** aspect so the
   photo isn't stretched (it's drawn with `preserveAspectRatio: none`).
5. **Overlay the pads** over the photo's pads: read the cropped image and set each
   pin's `x`/`y` (0..1) to sit on its real pad. No `shapes`/`labels` needed.

```{warning}
The photo must be one you have the right to redistribute. Product photos are
copyrighted — fine for your own local library, but replace it with your own or a
licensed/official image before publishing a part to the shared/Standard library.
```

## Match the REAL board, don't assume

Verify every visible detail against the photo/datasheet — colour, orientation, and
**which pins are on which edge**. (Example: the Pimoroni Tiny 2350 is **black**
with **5V/3V3/A3–A0 on the left** and **GP0–GP7 on the right** — guessing would
get the colour and the whole pin layout wrong.)

## Steps

1. **Identify** the part: `name`, `manufacturer`, `partNumber`, real
   `dimensions` (width × height in **mm** — from the datasheet), and its
   **category** (set `family`; see categories below).
2. **Extract pins** from the pinout: for each pin capture its `label` (silk
   name), board `number` (and `gpio` for MCUs), electrical `type`
   (`io`/`pwr`/`gnd`/`other`), `capabilities`, and which **edge** it's on. Use
   `x`/`y` (0..1, fraction of the outline) for real positions when the pinout
   shows them; else spread pins evenly along their `edge`.
3. **Draw the board.** Preferably embed a cropped top-down **photo** + overlay the
   pads (see *Background photo*). Only if no clean photo exists, lay out
   `shapes` (grey `rect` for chips/connectors) + `labels` + `mountingHoles`.
4. **Pick a category** for `family` so it lands in the right section (#193):
   `Microcontroller`, `Computer`, `Sensor`, `Input`, `Output`, `Motor`,
   `Display`, `Communication`, `Power`, `IC`.
5. **Version** with `version: 0.1.0` for a new part; when **regenerating/editing**
   an existing part, bump the PATCH (`0.1.0 → 0.1.1`) so the update check (#172/#194)
   sees the change.
6. **Write** the part folder: `parts.yml` (+ `image.jpg` if used) into a library
   (`my-parts/<id>/` for the user's library; a maintainer can later **promote** it
   to the Standard library, #192). For a part added to the bundled Standard
   library, also copy it into the running install's
   `<userData>/parts/snakie-standard/<id>/` (or restart) so it shows immediately.
7. **Verify**: it parses as YAML, pin `number`s are unique, coordinates are within
   0..1, `type`/`capabilities`/`shape` use the allowed values below, and — ideally
   — **render it** (open the Board View / Part Editor, or a Playwright capture) to
   confirm the photo + pads line up. Tweak pad `x`/`y` to match.

## `parts.yml` shape (the fields you'll write)

Pins use `name` (the silk name), not `label`.

```yaml
id: vl53l0x                 # kebab-case, unique within the library
name: VL53L0X ToF
manufacturer: STMicroelectronics
partNumber: VL53L0X
family: Sensor              # the category (see step 4)
description: Time-of-flight distance sensor breakout
version: 0.1.0
dimensions: { width: 21, height: 13 }   # mm; sets the real footprint + aspect
aspect: 1.6                 # width/height — match the board so a photo isn't stretched
pinSpacing: 2.54            # mm between header pins (default 2.54)
pcbColor: '#0f5a2e'
# Life-like background photo (preferred). With this, omit `shapes`/`labels` — the
# silk + components are in the photo — and just position the pads over it.
image: image.jpg
imageLayer: { x: 0, y: 0, w: 1, h: 1 }
headers:
  - edge: left             # left | right | top | bottom
    pins:
      - { number: 1, name: VIN, type: pwr, x: 0.08, y: 0.20 }
      - { number: 2, name: GND, type: gnd, x: 0.08, y: 0.40 }
      - { number: 3, name: SDA, type: io, capabilities: [i2c], x: 0.08, y: 0.60, shape: castellated }
      - { number: 4, name: SCL, type: io, capabilities: [i2c], x: 0.08, y: 0.80, shape: castellated }
# Only when there is NO photo, draw the board instead:
# shapes:
#   - { kind: rect, x: 0.35, y: 0.30, w: 0.3, h: 0.4, fill: '#1c2227', label: VL53L0X }
# labels:
#   - { text: ToF, x: 0.5, y: 0.9, fontSize: 10 }
```

Allowed values:
- pin `type`: `io` · `pwr` · `gnd` · `other`
- pin `capabilities`: `digital` · `pwm` · `adc` · `i2c` · `spi` · `uart`
- pad `shape`: `round` · `square` · `castellated` · `header`
- shape `kind`: `rect` · `circle` · `polygon`
- For an **MCU board** (so it appears in the Board View's board picker) set
  `family: Microcontroller` and give each GPIO pin its `gpio` number.

## References

- The schema + behaviour: `docs/parts-library.md`, `docs/part-editor.md`,
  `src/shared/part.ts`, and the snakie.org docs `reference/parts-yml`.
- The target part wishlist to work through: [`docs/common-parts.md`](../../../docs/common-parts.md) (#199).
- After authoring, a maintainer promotes the part into the **Standard library**
  and **Publishes** it (developer mode) so users get it via the update check.
